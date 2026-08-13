export type NavigationDirection = -1 | 1;

type NavigationTask<T> = () => T | Promise<T>;

/** Serializes viewport moves and coalesces reflows that happen during a move. */
export class ViewportNavigation {
  #active = false;
  #idle: Promise<void> | undefined;
  #resolveIdle: (() => void) | undefined;
  #queue = Promise.resolve();
  #reflowPending = false;

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

  async run<T>(task: NavigationTask<T>, reflow: () => void): Promise<T | undefined> {
    if (this.#active) return undefined;
    this.#active = true;
    this.#idle = new Promise((resolve) => { this.#resolveIdle = resolve; });
    try {
      return await task();
    } finally {
      this.#active = false;
      this.#resolveIdle?.();
      this.#idle = undefined;
      this.#resolveIdle = undefined;
      if (this.#reflowPending) {
        this.#reflowPending = false;
        reflow();
      }
    }
  }

  enqueue<T>(task: NavigationTask<T>, reflow: () => void): Promise<T | undefined> {
    const result = this.#queue.then(async () => {
      if (this.#idle) await this.#idle;
      return this.run(task, reflow);
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

type EntryOffsetOptions = {
  continuous: boolean;
  leadingRemainder: number;
  scrolled: boolean;
  start?: number;
  viewportSize: number;
};

export function getEntryOffset({
  continuous,
  leadingRemainder,
  scrolled,
  start = 0,
  viewportSize,
}: EntryOffsetOptions) {
  return continuous ? (scrolled ? 0 : viewportSize + leadingRemainder) + start : 0;
}

/** Physical track size required to make every cached scroll anchor reachable. */
export function getScrolledTrackSize(contentExtent: number, viewportSize: number) {
  return Math.max(contentExtent + viewportSize, viewportSize);
}

/** Converts a section-relative fraction to a stable track coordinate. */
export function getFractionTarget(entryOffset: number, entryExtent: number, fraction: number) {
  return entryOffset + fraction * entryExtent;
}

/** Converts a rendered document rect to a stable track coordinate. */
export function getRectTarget(entryOffset: number, mappedStart: number, margin: number) {
  return entryOffset + mappedStart - margin;
}

export function getAnchorPage(entryOffset: number, anchorOffset: number, viewportSize: number) {
  return Math.floor((entryOffset + anchorOffset) / viewportSize);
}

type RectTarget = {
  getBoundingClientRect?: () => DOMRect;
  getClientRects?: () => DOMRectList | DOMRect[];
  ownerDocument?: Document;
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

export type ViewportNavigationState = {
  atBookEnd: boolean;
  atBookStart: boolean;
  end: number;
  extent: number;
  mode: "paginated" | "scrolled";
  page: number;
  pages: number;
  size: number;
  start: number;
};

export type ViewportNavigationAction =
  | { kind: "book-edge" }
  | { kind: "cross-window" }
  | { kind: "page"; page: number; crossWindowAfter: boolean }
  | { kind: "scroll"; offset: number };

const EDGE_EPSILON = 2;

export function isAtBookEdge(state: ViewportNavigationState, direction: NavigationDirection) {
  if (direction < 0) return state.atBookStart && state.page <= 1;
  return state.atBookEnd && state.page >= state.pages - 2;
}

export function planViewportNavigation(
  state: ViewportNavigationState,
  direction: NavigationDirection,
  distance?: number,
): ViewportNavigationAction {
  if (isAtBookEdge(state, direction)) return { kind: "book-edge" };

  if (state.mode === "paginated") {
    const page = state.page + direction;
    return {
      kind: "page",
      page,
      crossWindowAfter: direction < 0 ? page <= 0 : page >= state.pages - 1,
    };
  }

  const remaining = direction < 0 ? state.start : state.extent - state.end;
  if (remaining <= EDGE_EPSILON) return { kind: "cross-window" };
  const step = Math.min(distance ?? state.size, remaining);
  return { kind: "scroll", offset: state.start + direction * step };
}
