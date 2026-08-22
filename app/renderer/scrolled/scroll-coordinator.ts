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
) {
  const frame = getFrame(doc);
  if (!frame) return undefined;
  const frameRect = frame.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  const scaleX = frameRect.width / Math.max(1, frame.offsetWidth);
  const scaleY = frameRect.height / Math.max(1, frame.offsetHeight);
  const visibleLeft = Math.max(frameRect.left, viewport.left);
  const visibleRight = Math.min(frameRect.right, viewport.right);
  const hostY = Math.max(
    frameRect.top,
    Math.min(frameRect.bottom - 1, viewport.top + inset),
  );
  const center = (visibleLeft + visibleRight) / 2;
  const hostXs = [center, visibleLeft + (visibleRight - visibleLeft) * 0.3,
    visibleLeft + (visibleRight - visibleLeft) * 0.7];

  for (const hostX of hostXs) {
    const range = collapsedRangeAt(
      doc,
      (hostX - frameRect.left) / Math.max(scaleX, Number.EPSILON),
      (hostY - frameRect.top) / Math.max(scaleY, Number.EPSILON),
    );
    if (range && range.startContainer !== doc.documentElement && range.startContainer !== doc.body) {
      return range;
    }
  }

  const fallback = doc.createRange();
  fallback.selectNodeContents(doc.body);
  fallback.collapse(true);
  return fallback;
}

/** Owns the scroll-mode hot path: geometry, throttling, and reading-edge sampling. */
/** Scroll-mode geometry sampling and anchor projection. */
export class ScrollCoordinator {
  readonly #container: HTMLElement;
  readonly #update: () => void;
  #updateFrame = 0;

  constructor(container: HTMLElement, update: () => void) {
    this.#container = container;
    this.#update = update;
    container.addEventListener("scrollend", this.#handleScrollEnd);
  }

  anchorTarget(doc: Document, rect: DOMRect, inset: number) {
    return getAnchorTarget(this.#container, doc, rect, inset);
  }

  readingRange(doc: Document, inset: number) {
    return getReadingRange(this.#container, doc, inset);
  }

  schedule() {
    if (!this.#updateFrame) {
      this.#updateFrame = requestAnimationFrame(() => {
        this.#updateFrame = 0;
        this.#update();
      });
    }
  }

  readonly #handleScrollEnd = () => {
    if (this.#updateFrame) {
      cancelAnimationFrame(this.#updateFrame);
      this.#updateFrame = 0;
    }
    this.#update();
  };

  /** Commits the latest physical scroll before a reflow can restore its anchor. */
  flush() {
    if (!this.#updateFrame) return false;
    cancelAnimationFrame(this.#updateFrame);
    this.#updateFrame = 0;
    this.#update();
    return true;
  }

  cancel() {
    cancelAnimationFrame(this.#updateFrame);
    this.#updateFrame = 0;
  }

  destroy() {
    this.cancel();
    this.#container.removeEventListener("scrollend", this.#handleScrollEnd);
  }
}
