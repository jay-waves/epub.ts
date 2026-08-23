import type { SpineEntry } from "./spine-buffer";
export type SpineTrackView = {
  columnCount: number;
  columnStep: number;
  contentColumns: number;
  extent: number;
};

export type AppliedSpineChange<View> = {
  added: readonly SpineEntry<View>[];
  removed: readonly SpineEntry<View>[];
};

type TrackPlacement<View> = {
  entry: SpineEntry<View>;
  physicalStart: number;
};

export type SpineTrackLayout<View> = {
  placements: readonly TrackPlacement<View>[];
};

/** Owns logical spine positions and their projection onto the scroll track. */
export interface SpineTrack<View extends SpineTrackView> {
  readonly contentExtent: number;
  readonly physicalExtent: number;
  entryOffset(entry: SpineEntry<View> | undefined): number;
  layout(entries: readonly SpineEntry<View>[]): SpineTrackLayout<View>;
  reset(): void;
  updateForChange?(change: AppliedSpineChange<View>, activeIndex: number | undefined): void;
  viewportRange(start: number, end: number): {
    start: number;
    end: number;
  };
}
