import type { SpineEntry } from "./spine-buffer";
import type { TrackProjection } from "./flow-geometry";

export type SpineTrackView = {
  columnCount: number;
  columnStep: number;
  contentColumns: number;
  extent: number;
};

type AppliedSpineChange<View> = {
  added: readonly SpineEntry<View>[];
  removed: readonly SpineEntry<View>[];
};

type TrackPlacement<View> = {
  entry: SpineEntry<View>;
  physicalStart: number;
};

type SpineTrackLayout<View> = {
  placements: readonly TrackPlacement<View>[];
};

type PaginatedLayoutOptions = {
  breakBefore?: (index: number) => boolean;
};

/** Owns logical spine positions and their projection onto the scroll track. */
export class SpineTrack<View extends SpineTrackView> {
  #leadingRemainder = 0;
  #contentExtent = 0;
  #physicalExtent = 0;

  get contentExtent() {
    return this.#contentExtent;
  }

  get physicalExtent() {
    return this.#physicalExtent;
  }

  reset() {
    this.#leadingRemainder = 0;
    this.#contentExtent = 0;
    this.#physicalExtent = 0;
  }

  updateForChange(
    change: AppliedSpineChange<View>,
    activeIndex: number | undefined,
    projection: TrackProjection,
  ) {
    if (projection.kind !== "paginated" || activeIndex === undefined) return;
    const extentBefore = (entries: readonly SpineEntry<View>[]) => entries
      .filter((entry) => entry.index < activeIndex)
      .reduce((sum, entry) => sum + entry.extent, 0);
    this.#leadingRemainder = pageRemainder(
      this.#leadingRemainder
        + extentBefore(change.removed)
        - extentBefore(change.added),
      projection.viewportSize,
    );
  }

  layout(
    entries: readonly SpineEntry<View>[],
    projection: Exclude<TrackProjection, { kind: "single" }>,
    options: PaginatedLayoutOptions = {},
  ): SpineTrackLayout<View> {
    const { viewportSize } = projection;
    if (!entries.length) {
      this.#contentExtent = 0;
      this.#physicalExtent = viewportSize;
      return { placements: [] };
    }

    if (projection.kind === "scrolled") {
      let start = 0;
      const placements = entries.map((entry) => {
        entry.start = start;
        entry.extent = Math.max(1, entry.view.extent);
        start += entry.extent;
        return { entry, physicalStart: entry.start };
      });
      this.#contentExtent = start;
      this.#physicalExtent = Math.max(start + viewportSize, viewportSize);
      return { placements };
    }

    const { columnCount, columnStep } = entries[0]!.view;
    const pageSize = columnCount * columnStep || viewportSize;
    const leading = pageSize + this.#leadingRemainder;
    let columnStart = 0;
    const placements = entries.map((entry) => {
      if (options.breakBefore?.(entry.index) && pageSize > 0) {
        const physicalStart = leading + columnStart * columnStep;
        const remainder = pageRemainder(physicalStart, pageSize);
        if (remainder) columnStart += (pageSize - remainder) / columnStep;
      }
      entry.start = columnStart * columnStep;
      entry.extent = Math.max(1, entry.view.extent);
      columnStart += entry.view.contentColumns;
      return { entry, physicalStart: leading + entry.start };
    });
    this.#contentExtent = columnStart * columnStep;
    const pages = pageSize > 0
      ? Math.ceil((leading + this.#contentExtent) / pageSize) + 1
      : 0;
    this.#physicalExtent = pages * pageSize;
    return { placements };
  }

  entryOffset(
    entry: SpineEntry<View> | undefined,
    projection: TrackProjection,
  ) {
    if (projection.kind === "single") return 0;
    return (projection.kind === "scrolled" ? 0
      : projection.viewportSize + this.#leadingRemainder)
      + (entry?.start ?? 0);
  }

  viewportRange(
    first: SpineEntry<View> | undefined,
    start: number,
    end: number,
    projection: TrackProjection,
  ) {
    const origin = first ? this.entryOffset(first, projection) - first.start : 0;
    return {
      start: Math.max(0, start - origin),
      end: Math.max(0, end - origin),
    };
  }
}

function pageRemainder(value: number, pageSize: number) {
  if (!(pageSize > 0)) return 0;
  const remainder = (value % pageSize + pageSize) % pageSize;
  // Fractional column widths can leave a sub-pixel residue at a page boundary.
  return remainder < 0.5 || pageSize - remainder < 0.5 ? 0 : remainder;
}
