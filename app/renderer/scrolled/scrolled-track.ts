import type {
  SpineEntry,
  SpineTrack,
  SpineTrackLayout,
  SpineTrackView,
} from "../shared/spine-state";

export class ScrolledTrack<View extends SpineTrackView> implements SpineTrack<View> {
  #contentExtent = 0;
  readonly #viewportSize: () => number;

  constructor(viewportSize: () => number) {
    this.#viewportSize = viewportSize;
  }

  get contentExtent() { return this.#contentExtent; }
  get physicalExtent() { return Math.max(this.#contentExtent + this.#viewportSize(), this.#viewportSize()); }

  reset() { this.#contentExtent = 0; }
  layout(entries: readonly SpineEntry<View>[]): SpineTrackLayout<View> {
    let start = 0;
    const placements = entries.map((entry) => {
      entry.start = start;
      entry.extent = Math.max(1, entry.view.extent);
      start += entry.extent;
      return { entry, physicalStart: entry.start };
    });
    this.#contentExtent = start;
    return { placements };
  }

  entryOffset(entry: SpineEntry<View> | undefined) { return entry?.start ?? 0; }

  viewportRange(start: number, end: number) {
    return { start: Math.max(0, start), end: Math.max(0, end) };
  }
}
