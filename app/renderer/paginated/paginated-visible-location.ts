import type { SpineEntry } from "../shared/spine-buffer";
import { getVisibleRange, type VisibleLocationView } from "../shared/visible-range";

type Options<View extends VisibleLocationView> = {
  continuous: boolean;
  current?: SpineEntry<View>;
  edgeTurns: number;
  end: number;
  entryOffset: (entry: SpineEntry<View>) => number;
  findAt: (offset: number) => SpineEntry<View> | undefined;
  page: number;
  pages: number;
  rtl: boolean;
  start: number;
  viewportSize: number;
};

export function paginatedReadingEdge(start: number, contentOffset: number) {
  return Math.max(0, start - contentOffset);
}

export function resolvePaginatedLocation<View extends VisibleLocationView>(options: Options<View>) {
  const { continuous, current, end, entryOffset, start, viewportSize } = options;
  const contentOffset = continuous && current ? entryOffset(current) - current.start : 0;
  const entry = continuous
    ? options.findAt(paginatedReadingEdge(start, contentOffset))
    : current;
  if (!entry) return undefined;

  const offset = entryOffset(entry);
  const { view } = entry;
  const range = continuous
    ? view.visibleRange(Math.max(0, start - offset), Math.min(view.extent, end - offset))
    : getVisibleRange(
      view.document,
      start - (options.rtl ? -viewportSize : viewportSize),
      end - (options.rtl ? -viewportSize : viewportSize),
      rect => view.mapRect(rect),
    );

  if (!(options.pages > 0)) return { entry, range, fraction: undefined, size: undefined };
  if (continuous) return {
    entry,
    range,
    fraction: Math.min(1, Math.max(0, (start - offset) / view.extent)),
    size: Math.min(1, viewportSize / view.extent),
  };
  const contentTurns = options.pages - options.edgeTurns * 2;
  return {
    entry,
    range,
    fraction: (options.page - options.edgeTurns) / contentTurns,
    size: options.edgeTurns / contentTurns,
  };
}
