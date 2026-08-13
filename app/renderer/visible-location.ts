import type { ChapterEntry } from "./chapter-window";

type MappedRect = { left: number; right: number };

export type VisibleLocationView = {
  document: Document;
  extent: number;
  mapRect: (rect: DOMRect) => MappedRect;
  visibleRange: (start: number, end: number) => Range;
};

type VisibleLocationOptions<View extends VisibleLocationView> = {
  continuous: boolean;
  current?: ChapterEntry<View>;
  end: number;
  entryOffset: (entry: ChapterEntry<View>) => number;
  findAt: (offset: number) => ChapterEntry<View> | undefined;
  margin: number;
  page: number;
  pages: number;
  rtl: boolean;
  scrolled: boolean;
  scrolledRange?: (entry: ChapterEntry<View>) => Range | undefined;
  start: number;
  viewportSize: number;
};

type ReadingEdgeOptions = {
  contentOffset: number;
  margin: number;
  scrolled: boolean;
  start: number;
};

/** Coordinate used to decide which chapter owns the viewport's reading edge. */
export function getReadingEdge({ contentOffset, margin, scrolled, start }: ReadingEdgeOptions) {
  return Math.max(0, start + (scrolled ? margin : -contentOffset));
}

const makeRange = (doc: Document, node: Node, start: number, end = start) => {
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
};

const bisectNode = (
  doc: Document,
  node: Node,
  compare: (a: Range, b: Range) => number,
  start = 0,
  end = node.nodeValue?.length ?? 0,
): number => {
  if (end - start <= 1) {
    const result = compare(makeRange(doc, node, start), makeRange(doc, node, end));
    return result < 0 ? start : end;
  }
  const mid = Math.floor(start + (end - start) / 2);
  const result = compare(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end));
  return result < 0
    ? bisectNode(doc, node, compare, start, mid)
    : result > 0
      ? bisectNode(doc, node, compare, mid, end)
      : mid;
};

const getRangeRect = (target: Range) => {
  let top = Infinity;
  let right = -Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  for (const rect of target.getClientRects()) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
};

/** Finds the text range occupying a rendered interval in one chapter view. */
export function getVisibleRange(
  doc: Document,
  start: number,
  end: number,
  mapRect: (rect: DOMRect) => MappedRect,
) {
  const filter = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;
  const acceptNode = (node: Node) => {
    const name = (node as Element).localName?.toLowerCase();
    if (name === "script" || name === "style") return NodeFilter.FILTER_REJECT;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const { left, right } = mapRect((node as Element).getBoundingClientRect());
      if (right < start || left > end) return NodeFilter.FILTER_REJECT;
      if (left >= start && right <= end) return NodeFilter.FILTER_ACCEPT;
    } else {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_SKIP;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const { left, right } = mapRect(range.getBoundingClientRect());
      if (right >= start && left <= end) return NodeFilter.FILTER_ACCEPT;
    }
    return NodeFilter.FILTER_SKIP;
  };

  const walker = doc.createTreeWalker(doc.body, filter, { acceptNode });
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const from = nodes[0] ?? doc.body;
  const to = nodes.at(-1) ?? from;

  const startOffset = from.nodeType === Node.ELEMENT_NODE ? 0
    : bisectNode(doc, from, (a, b) => {
      const p = mapRect(getRangeRect(a));
      const q = mapRect(getRangeRect(b));
      if (p.right < start && q.left > start) return 0;
      return q.left > start ? -1 : 1;
    });
  const endOffset = to.nodeType === Node.ELEMENT_NODE ? 0
    : bisectNode(doc, to, (a, b) => {
      const p = mapRect(getRangeRect(a));
      const q = mapRect(getRangeRect(b));
      if (p.right < end && q.left > end) return 0;
      return q.left > end ? -1 : 1;
    });

  const range = doc.createRange();
  range.setStart(from, startOffset);
  range.setEnd(to, endOffset);
  return range;
}

/** Resolves one immutable relocation snapshot from viewport geometry. */
export function resolveVisibleLocation<View extends VisibleLocationView>({
  continuous,
  current,
  end,
  entryOffset,
  findAt,
  margin,
  page,
  pages,
  rtl,
  scrolled,
  scrolledRange,
  start,
  viewportSize,
}: VisibleLocationOptions<View>) {
  const contentOffset = continuous && !scrolled && current
    ? entryOffset(current) - current.start
    : 0;
  const readingEdge = getReadingEdge({ contentOffset, margin, scrolled, start });
  const entry = continuous
    ? findAt(readingEdge)
    : current;
  if (!entry) return undefined;

  const offset = entryOffset(entry);
  const { view } = entry;
  const range = scrolled
    ? scrolledRange?.(entry)
    : continuous
      ? view.visibleRange(
        Math.max(0, start - offset),
        Math.min(view.extent, end - offset),
      )
      : getVisibleRange(
        view.document,
        start - (rtl ? -viewportSize : viewportSize),
        end - (rtl ? -viewportSize : viewportSize),
        (rect) => view.mapRect(rect),
      );

  let fraction: number | undefined;
  let visibleSize: number | undefined;
  if (scrolled) {
    fraction = Math.min(1, Math.max(0, (readingEdge - offset) / view.extent));
    visibleSize = Math.min(1, viewportSize / view.extent);
  } else if (pages > 0) {
    if (continuous) {
      fraction = Math.min(1, Math.max(0, (start - offset) / view.extent));
      visibleSize = Math.min(1, viewportSize / view.extent);
    } else {
      fraction = (page - 1) / (pages - 2);
      visibleSize = 1 / (pages - 2);
    }
  }

  return { entry, fraction, range, size: visibleSize };
}
