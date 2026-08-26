import type { SpineEntry } from "../shared/spine-state";
import type { VisibleLocationView } from "../shared/visible-range";
import { clampFraction } from "../shared/navigation";

type Options<View extends VisibleLocationView> = {
  current?: SpineEntry<View>;
  end: number;
  entryOffset: (entry: SpineEntry<View>) => number;
  findAt: (offset: number) => SpineEntry<View> | undefined;
  start: number;
  viewportSize: number;
};

export function paginatedReadingEdge(start: number, contentOffset: number) {
  return Math.max(0, start - contentOffset);
}

export function resolvePaginatedLocation<View extends VisibleLocationView>(options: Options<View>) {
  const { current, end, entryOffset, start, viewportSize } = options;
  const contentOffset = current ? entryOffset(current) - current.start : 0;
  const entry = options.findAt(paginatedReadingEdge(start, contentOffset));
  if (!entry) return undefined;

  const offset = entryOffset(entry);
  const { view } = entry;
  const range = view.visibleRange(
    Math.max(0, start - offset), Math.min(view.extent, end - offset));

  return {
    entry,
    range,
    fraction: clampFraction((start - offset) / view.extent),
    size: Math.min(1, viewportSize / view.extent),
  };
}
