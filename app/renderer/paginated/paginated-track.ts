import type { SpineEntry } from "../shared/spine-buffer";
import type {
  AppliedSpineChange,
  SpineTrack,
  SpineTrackLayout,
  SpineTrackView,
} from "../shared/spine-track";

export class PaginatedTrack<View extends SpineTrackView> implements SpineTrack<View> {
  #leadingRemainder = 0;
  #contentExtent = 0;
  #physicalExtent = 0;
  readonly #viewportSize: () => number;

  constructor(viewportSize: () => number) { this.#viewportSize = viewportSize; }
  get contentExtent() { return this.#contentExtent; }
  get physicalExtent() { return this.#physicalExtent; }

  reset() {
    this.#leadingRemainder = 0;
    this.#contentExtent = 0;
    this.#physicalExtent = 0;
  }

  updateForChange(change: AppliedSpineChange<View>, activeIndex: number | undefined) {
    if (activeIndex === undefined) return;
    const extentBefore = (entries: readonly SpineEntry<View>[]) => entries
      .filter((entry) => entry.index < activeIndex)
      .reduce((sum, entry) => sum + entry.extent, 0);
    this.#leadingRemainder = pageRemainder(
      this.#leadingRemainder + extentBefore(change.removed) - extentBefore(change.added),
      this.#viewportSize(),
    );
  }

  layout(entries: readonly SpineEntry<View>[]): SpineTrackLayout<View> {
    const viewportSize = this.#viewportSize();
    if (!entries.length) {
      this.#contentExtent = 0;
      this.#physicalExtent = viewportSize;
      return { placements: [] };
    }
    const { columnCount, columnStep } = entries[0]!.view;
    const pageSize = columnCount * columnStep || viewportSize;
    const leading = pageSize + this.#leadingRemainder;
    let columnStart = 0;
    const placements = entries.map((entry) => {
      entry.start = columnStart * columnStep;
      entry.extent = Math.max(1, entry.view.extent);
      columnStart += entry.view.contentColumns;
      return { entry, physicalStart: leading + entry.start };
    });
    this.#contentExtent = columnStart * columnStep;
    this.#physicalExtent = Math.ceil((leading + this.#contentExtent) / pageSize) * pageSize + pageSize;
    return { placements };
  }

  entryOffset(entry: SpineEntry<View> | undefined) {
    return this.#viewportSize() + this.#leadingRemainder + (entry?.start ?? 0);
  }

  viewportRange(start: number, end: number) {
    const origin = this.#viewportSize() + this.#leadingRemainder;
    return { start: Math.max(0, start - origin), end: Math.max(0, end - origin) };
  }
}

function pageRemainder(value: number, pageSize: number) {
  if (!(pageSize > 0)) return 0;
  const remainder = (value % pageSize + pageSize) % pageSize;
  return remainder < 0.5 || pageSize - remainder < 0.5 ? 0 : remainder;
}
