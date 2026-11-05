import type { SectionDirection } from "../shared/section-frame";

type ProjectedRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

function getFrame(doc: Document) {
  return doc.defaultView?.frameElement as HTMLElement | null;
}

/** Projects a rectangle from an EPUB iframe into the reader viewport. */
function projectDocumentRect(doc: Document, rect: DOMRect): ProjectedRect | undefined {
  const frame = getFrame(doc);
  if (!frame) return undefined;
  const frameRect = frame.getBoundingClientRect();
  const scaleX = frameRect.width / Math.max(1, frame.offsetWidth);
  const scaleY = frameRect.height / Math.max(1, frame.offsetHeight);
  return {
    bottom: frameRect.top + rect.bottom * scaleY,
    left: frameRect.left + rect.left * scaleX,
    right: frameRect.left + rect.right * scaleX,
    top: frameRect.top + rect.top * scaleY,
  };
}

/** Resolves a scroll target from current, real DOM geometry instead of cached chapter offsets. */
function getAnchorTarget(
  container: HTMLElement,
  doc: Document,
  rect: DOMRect,
  inset: number,
) {
  const projected = projectDocumentRect(doc, rect);
  if (!projected) return undefined;
  const viewport = container.getBoundingClientRect();
  const readingEdge = viewport.top + inset;
  const visibleEnd = Math.max(readingEdge, viewport.bottom - inset);
  return {
    offset: Math.max(0, container.scrollTop + projected.top - readingEdge),
    visible: projected.top >= readingEdge && projected.top <= visibleEnd,
  };
}

function collapsedRangeAt(doc: Document, x: number, y: number) {
  const position = doc.caretPositionFromPoint(x, y);
  if (position) {
    const range = doc.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  const element = doc.elementFromPoint(x, y);
  if (!element) return undefined;
  const range = doc.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  return range;
}

/** Samples the text at the viewport reading edge without walking the chapter DOM. */
function getReadingRange(
  container: HTMLElement,
  doc: Document,
  inset: number,
  writingMode: SectionDirection["writingMode"],
) {
  const frame = getFrame(doc);
  if (!frame) return undefined;
  const frameRect = frame.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  const scaleX = frameRect.width / Math.max(1, frame.offsetWidth);
  const scaleY = frameRect.height / Math.max(1, frame.offsetHeight);
  const visibleLeft = Math.max(frameRect.left, viewport.left);
  const visibleRight = Math.min(frameRect.right, viewport.right);
  const visibleTop = Math.max(frameRect.top, viewport.top);
  const visibleBottom = Math.min(frameRect.bottom, viewport.bottom);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return undefined;
  const vertical = writingMode !== "horizontal-tb";
  const clamp = (value: number, start: number, end: number) =>
    Math.max(start, Math.min(end - Math.min(1, (end - start) / 2), value));
  const edge = vertical
    ? clamp(writingMode === "vertical-rl" ? viewport.right - inset : viewport.left + inset,
        visibleLeft, visibleRight)
    : clamp(viewport.top + inset, visibleTop, visibleBottom);

  for (const fraction of [0.5, 0.3, 0.7]) {
    const hostX = vertical ? edge : visibleLeft + (visibleRight - visibleLeft) * fraction;
    const hostY = vertical ? visibleTop + (visibleBottom - visibleTop) * fraction : edge;
    const range = collapsedRangeAt(
      doc,
      (hostX - frameRect.left) / Math.max(scaleX, Number.EPSILON),
      (hostY - frameRect.top) / Math.max(scaleY, Number.EPSILON),
    );
    if (range && range.startContainer !== doc.documentElement && range.startContainer !== doc.body) {
      return range;
    }
  }

  // Physical alignment space has no text anchor. The renderer retains the
  // section fraction instead of manufacturing a chapter-start Range.
  return undefined;
}

/** Scroll-mode geometry sampling and anchor projection. */
export class ScrollCoordinator {
  readonly #container: HTMLElement;
  readonly #events = new AbortController();
  readonly #update: () => void;
  #updateFrame = 0;
  #left: number;
  #top: number;

  constructor(container: HTMLElement, update: () => void) {
    this.#container = container;
    this.#update = update;
    this.#left = container.scrollLeft;
    this.#top = container.scrollTop;
    const options = { signal: this.#events.signal };
    container.addEventListener("scroll", this.#schedule, options);
    container.addEventListener("scrollend", this.#flush, options);
  }

  anchorTarget(doc: Document, rect: DOMRect, inset: number) {
    return getAnchorTarget(this.#container, doc, rect, inset);
  }

  readingRange(doc: Document, inset: number,
    writingMode: SectionDirection["writingMode"] = "horizontal-tb") {
    return getReadingRange(this.#container, doc, inset, writingMode);
  }

  readonly #schedule = () => {
    if (!this.#hasMoved()) return;
    if (!this.#updateFrame) {
      this.#updateFrame = requestAnimationFrame(this.#flush);
    }
  };

  readonly #flush = () => { this.flush(); };

  #hasMoved() {
    return this.#container.scrollLeft !== this.#left
      || this.#container.scrollTop !== this.#top;
  }

  /** Records the browser's actual (possibly clamped) offset before events arrive. */
  scrollTo(property: "scrollLeft" | "scrollTop", offset: number) {
    this.#container[property] = offset;
    this.cancel();
  }

  /** Commits the latest physical scroll before a reflow can restore its anchor. */
  flush() {
    const moved = this.#hasMoved();
    this.cancel();
    if (!moved) return false;
    this.#update();
    return true;
  }

  cancel() {
    cancelAnimationFrame(this.#updateFrame);
    this.#updateFrame = 0;
    this.#left = this.#container.scrollLeft;
    this.#top = this.#container.scrollTop;
  }

  destroy() {
    this.cancel();
    this.#events.abort();
  }
}
