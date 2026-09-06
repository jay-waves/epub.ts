import type { SpineEntry } from "../shared/spine-state";
import type { SpineTrackView } from "../shared/spine-state";
import { clampFraction } from "../shared/navigation";

type Options<View extends SpineTrackView> = {
  continuous: boolean;
  current?: SpineEntry<View>;
  entryOffset: (entry: SpineEntry<View>) => number;
  findAt: (offset: number) => SpineEntry<View> | undefined;
  margin: number;
  range: (entry: SpineEntry<View>) => Range | undefined;
  start: number;
  viewportSize: number;
};

export function scrolledReadingEdge(start: number, margin: number) {
  return Math.max(0, start + margin);
}

export function resolveScrolledLocation<View extends SpineTrackView>(options: Options<View>) {
  const readingEdge = scrolledReadingEdge(options.start, options.margin);
  const entry = options.continuous ? options.findAt(readingEdge) : options.current;
  if (!entry) return undefined;
  const offset = options.entryOffset(entry);
  return {
    entry,
    range: options.range(entry),
    fraction: clampFraction((readingEdge - offset) / entry.view.extent),
    size: Math.min(1, options.viewportSize / entry.view.extent),
  };
}
