import type { SpineEntry } from "./spine-buffer";

type MappedRect = { left: number; right: number };

export type VisibleLocationView = {
  document: Document;
  extent: number;
  mapRect: (rect: DOMRect) => MappedRect;
  visibleRange: (start: number, end: number) => Range;
};

type VisibleLocationOptions<View extends VisibleLocationView> = {
  current?: SpineEntry<View>;
  end: number;
  edgeTurns?: number;
  entryOffset: (entry: SpineEntry<View>) => number;
  findAt: (offset: number) => SpineEntry<View> | undefined;
  layout:
    | {
      kind: "paginated";
      continuous: boolean;
      rtl: boolean;
    }
    | {
      kind: "scrolled";
      continuous: boolean;
      range: (entry: SpineEntry<View>) => Range | undefined;
    };
  margin: number;
  page: number;
  pages: number;
  start: number;
  viewportSize: number;
};

type ReadingEdgeOptions = {
  contentOffset: number;
  layout: "paginated" | "scrolled";
  margin: number;
  start: number;
};

/** Coordinate used to decide which chapter owns the viewport's reading edge. */
export function getReadingEdge({ contentOffset, layout, margin, start }: ReadingEdgeOptions) {
  return Math.max(0, start + (layout === "scrolled" ? margin : -contentOffset));
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
  const measurementRange = doc.createRange();
  const acceptNode = (node: Node) => {
    const name = (node as Element).localName?.toLowerCase();
    if (name === "script" || name === "style") return NodeFilter.FILTER_REJECT;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const { left, right } = mapRect((node as Element).getBoundingClientRect());
      if (right < start || left > end) return NodeFilter.FILTER_REJECT;
      if (left >= start && right <= end) return NodeFilter.FILTER_ACCEPT;
    } else {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_SKIP;
      measurementRange.selectNodeContents(node);
      const { left, right } = mapRect(measurementRange.getBoundingClientRect());
      if (right >= start && left <= end) return NodeFilter.FILTER_ACCEPT;
    }
    return NodeFilter.FILTER_SKIP;
  };

  const walker = doc.createTreeWalker(doc.body, filter, { acceptNode });
  let from: Node | undefined;
  let to: Node | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    from ??= node;
    to = node;
  }
  from ??= doc.body;
  to ??= from;

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
  current,
  end,
  edgeTurns = 1,
  entryOffset,
  findAt,
  layout,
  margin,
  page,
  pages,
  start,
  viewportSize,
}: VisibleLocationOptions<View>) {
  const { continuous } = layout;
  const contentOffset = continuous && layout.kind === "paginated" && current
    ? entryOffset(current) - current.start
    : 0;
  const readingEdge = getReadingEdge({ contentOffset, layout: layout.kind, margin, start });
  const entry = continuous
    ? findAt(readingEdge)
    : current;
  if (!entry) return undefined;

  const offset = entryOffset(entry);
  const { view } = entry;
  const range = layout.kind === "scrolled"
    ? layout.range(entry)
    : continuous
      ? view.visibleRange(
        Math.max(0, start - offset),
        Math.min(view.extent, end - offset),
      )
      : getVisibleRange(
        view.document,
        start - (layout.rtl ? -viewportSize : viewportSize),
        end - (layout.rtl ? -viewportSize : viewportSize),
        (rect) => view.mapRect(rect),
      );

  let fraction: number | undefined;
  let visibleSize: number | undefined;
  if (layout.kind === "scrolled") {
    fraction = Math.min(1, Math.max(0, (readingEdge - offset) / view.extent));
    visibleSize = Math.min(1, viewportSize / view.extent);
  } else if (pages > 0) {
    if (continuous) {
      fraction = Math.min(1, Math.max(0, (start - offset) / view.extent));
      visibleSize = Math.min(1, viewportSize / view.extent);
    } else {
      const contentTurns = pages - edgeTurns * 2;
      fraction = (page - edgeTurns) / contentTurns;
      visibleSize = edgeTurns / contentTurns;
    }
  }

  return { entry, fraction, range, size: visibleSize };
}
