/** A stable reading edge inside one spine section. */
export type ReadingPosition = {
  index: number;
  fraction: number;
  range?: Range;
};

/** A layout-independent fallback position within one spine section. */
export type FractionAnchor = {
  readonly kind: "fraction";
  readonly fraction: number;
};
export type DocumentAnchorResolver = (doc: Document) => Element | Range | null;
/** A section target before its document has been loaded. */
export type SectionAnchor = FractionAnchor | DocumentAnchorResolver;
/** A section target resolved against the currently rendered document. */
export type RenderedAnchor = FractionAnchor | Element | Range;
export type RelocationReason =
  | "anchor"
  | "navigation"
  | "page"
  | "scroll"
  | "selection"
  | "snap"
  | "switch";

/** Renderer relocation payload. Physical offsets never cross this boundary. */
export type RelocateDetail = ReadingPosition & {
  reason?: RelocationReason;
  size: number;
};

export function clampFraction(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function fractionAnchor(fraction: number): FractionAnchor {
  return { kind: "fraction", fraction: clampFraction(fraction) };
}

export function isFractionAnchor(anchor: RenderedAnchor): anchor is FractionAnchor {
  return "kind" in anchor && anchor.kind === "fraction";
}

export function resolveSectionAnchor(
  anchor: SectionAnchor | undefined,
  doc: Document,
): RenderedAnchor {
  if (anchor === undefined) return fractionAnchor(0);
  if (typeof anchor !== "function") return anchor;
  return anchor(doc) ?? fractionAnchor(0);
}

export function createReadingPosition(
  index: number,
  fraction: number | undefined,
  range?: Range,
): ReadingPosition {
  return { index, fraction: clampFraction(fraction), ...(range ? { range } : {}) };
}

/** Reduces a viewport-sized range to the exact point where reading starts. */
export function readingEdgeRange(range: Range): Range;
export function readingEdgeRange(range: undefined): undefined;
export function readingEdgeRange(range: Range | undefined): Range | undefined;
export function readingEdgeRange(range: Range | undefined) {
  if (!range) return undefined;
  const edge = range.cloneRange();
  edge.collapse(true);
  return edge;
}

/** Resolves a mode-switch target without reusing geometry from the old layout. */
export function resolveSemanticTarget<Target extends { index: number }>(
  index: number,
  cfi: string | undefined,
  resolve: (cfi: string) => Target | undefined,
): Target | { index: number } {
  return cfi ? resolve(cfi) ?? { index } : { index };
}

export function rangeBelongsToDocument(range: Range | undefined, doc: Document) {
  if (!range || range.startContainer.ownerDocument !== doc
    || range.endContainer.ownerDocument !== doc) return false;
  return doc.contains(range.startContainer) && doc.contains(range.endContainer);
}

/** Returns an exact anchor only while it still belongs to the same live section. */
export function anchorForPosition(
  position: ReadingPosition | undefined,
  index: number,
  doc: Document,
): RenderedAnchor {
  if (!position || position.index !== index) return fractionAnchor(0);
  const { range } = position;
  return range && rangeBelongsToDocument(range, doc)
    ? range.cloneRange()
    : fractionAnchor(position.fraction);
}

/** Prefer the requested edge while retaining a measured DOM range for CFI/reflow. */
export function resolveReadingPosition(
  measured: ReadingPosition,
  preferred?: Partial<ReadingPosition> & Pick<ReadingPosition, "index">,
) {
  const index = preferred?.index ?? measured.index;
  const range = preferred?.range ?? (measured.index === index ? measured.range : undefined);
  return createReadingPosition(index, preferred?.fraction ?? measured.fraction, range);
}

/** Converts a section-relative fraction to a stable track coordinate. */
export function getFractionTarget(entryOffset: number, entryExtent: number, fraction: number) {
  return entryOffset + fraction * entryExtent;
}

/** Converts a rendered document rect to a stable track coordinate. */
export function getRectTarget(entryOffset: number, mappedStart: number, margin: number) {
  return entryOffset + mappedStart - margin;
}

type RectTarget = {
  getBoundingClientRect?: () => DOMRect;
  getClientRects?: () => DOMRectList | DOMRect[];
  ownerDocument?: Document | null;
};

function usableRect(rect: DOMRect | undefined): rect is DOMRect {
  return Boolean(rect && Number.isFinite(rect.top) && Number.isFinite(rect.left));
}

/** Resolves elements and ranges, including empty EPUB fragment anchors, to a layout rect. */
export function getAnchorRect(target: RectTarget | null | undefined): DOMRect | undefined {
  if (!target) return undefined;
  const rects = Array.from(target.getClientRects?.() ?? []);
  const rendered = rects.find((rect) => rect.width > 0 || rect.height > 0);
  if (rendered) return rendered;
  if (usableRect(rects[0])) return rects[0];

  const bounds = target.getBoundingClientRect?.();
  if (usableRect(bounds) && (bounds.width > 0 || bounds.height > 0 || bounds.top !== 0 || bounds.left !== 0)) {
    return bounds;
  }

  // Some engines give an empty named anchor no rect at all. Its next rendered
  // element is the closest stable representation of the fragment position.
  const node = target as Node;
  const doc = node.ownerDocument;
  if (!doc || typeof node.nodeType !== "number") return usableRect(bounds) ? bounds : undefined;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = node;
  for (let current = walker.nextNode(), attempts = 0;
    current && attempts < 64;
    current = walker.nextNode(), attempts += 1) {
    const candidate = (current as Element).getBoundingClientRect();
    if (usableRect(candidate) && (candidate.width > 0 || candidate.height > 0)) return candidate;
  }
  return usableRect(bounds) ? bounds : undefined;
}

const lerp = (start: number, end: number, fraction: number) =>
  fraction * (end - start) + start;

export const easeOutQuad = (fraction: number) =>
  1 - (1 - fraction) * (1 - fraction);

export function animateNumber(
  startValue: number,
  endValue: number,
  duration: number,
  ease: (fraction: number) => number,
  render: (value: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<boolean>((resolve) => {
    let startTime: number | undefined;
    let frame: number | undefined;
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const step = (now: number) => {
      if (signal?.aborted) return finish(false);
      if (document.hidden) {
        render(endValue);
        return finish(true);
      }
      startTime ??= now;
      const fraction = Math.min(1, (now - startTime) / duration);
      render(lerp(startValue, endValue, ease(fraction)));
      if (fraction < 1) frame = requestAnimationFrame(step);
      else finish(true);
    };
    if (signal?.aborted) return finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    if (document.hidden) {
      render(endValue);
      return finish(true);
    }
    frame = requestAnimationFrame(step);
  });
}

type NavigationTask<T> = () => T | Promise<T>;

/** Serializes user navigation and coalesces reflows requested during a move. */
export class NavigationTransaction {
  readonly #reflow: () => void;
  #active = false;
  #idle: Promise<void> | undefined;
  #pending = 0;
  #resolveIdle: (() => void) | undefined;
  #queue = Promise.resolve();
  #reflowPending = false;
  #revision = 0;

  constructor(reflow: () => void) {
    this.#reflow = reflow;
  }

  get busy() { return this.#active || this.#pending > 0; }
  get revision() { return this.#revision; }

  invalidate() {
    this.#revision += 1;
  }

  deferReflow() {
    if (!this.#active) return false;
    this.#reflowPending = true;
    return true;
  }

  beginReflow() {
    if (this.deferReflow()) return false;
    this.#reflowPending = false;
    return true;
  }

  async run<T>(task: NavigationTask<T>): Promise<T | undefined> {
    if (this.#active) return undefined;
    this.#active = true;
    const idle = Promise.withResolvers<void>();
    this.#idle = idle.promise;
    this.#resolveIdle = idle.resolve;
    try {
      return await task();
    } finally {
      this.#active = false;
      this.#resolveIdle?.();
      this.#idle = undefined;
      this.#resolveIdle = undefined;
      if (this.#reflowPending) {
        this.#reflowPending = false;
        this.#reflow();
      }
    }
  }

  enqueue<T>(task: NavigationTask<T>): Promise<T | undefined> {
    this.#pending += 1;
    const result = this.#queue.then(async () => {
      if (this.#idle) await this.#idle;
      return this.run(task);
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result.finally(() => this.#pending -= 1);
  }

  enqueueCurrent<T>(
    task: (revision: number) => T | Promise<T>,
    revision = this.#revision,
  ) {
    return this.enqueue(() => revision === this.#revision ? task(revision) : undefined);
  }
}

/** Expands a collapsed cross-frame range enough for reliable client geometry. */
export function uncollapseRange(target: Element | Range): Element | Range {
  if (!("startContainer" in target) || !target.collapsed) return target;
  const range = target;
  const { endOffset, endContainer } = range;
  if (endContainer.nodeType === Node.ELEMENT_NODE) {
    const node = endContainer.childNodes[endOffset];
    if (node?.nodeType === Node.ELEMENT_NODE) return node as Element;
    return endContainer as Element;
  }
  if (endOffset < (endContainer.nodeValue?.length ?? 0)) range.setEnd(endContainer, endOffset + 1);
  else if (endOffset > 0) range.setStart(endContainer, endOffset - 1);
  else return endContainer.parentElement ?? range;
  return range;
}

export function setSelectionTarget(
  target: RenderedAnchor | null | undefined,
  collapse: -1 | 0 | 1,
) {
  let range: Range | undefined;
  if (target && !isFractionAnchor(target) && "startContainer" in target) range = target.cloneRange();
  else if (target && !isFractionAnchor(target)) {
    const createdRange = target.ownerDocument.createRange();
    createdRange.selectNode(target);
    range = createdRange;
  }
  if (!range) return;
  const selection = range.startContainer.ownerDocument?.defaultView?.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (collapse === -1) range.collapse(true);
  else if (collapse === 1) range.collapse();
  selection.addRange(range);
}
