import type { PageTurnDirection, ReaderView } from "./model";
import type { Resolved } from "../renderer";

const EDGE_RATIO = 0.22;
const CLICK_DISTANCE = 4;
const CURSOR_DELAY = 1_000;
const TARGET_CLASS = "reader-link-target";
const TARGET_STYLE = `
  @keyframes reader-link-target-flash {
    0%, 18% {
      background-color: color-mix(in srgb, var(--reader-accent-secondary) 24%, transparent);
    }
    100% {
      background-color: transparent;
    }
  }
  .${TARGET_CLASS} {
    animation: reader-link-target-flash 900ms ease-out;
    background-color: transparent;
    border-radius: 0;
    outline: 0;
  }
`;

type Point = { x: number; y: number };

type InteractionOptions = {
  getFlow: () => "paginated" | "scrolled";
  navigate: (href: string) => Promise<Resolved | undefined>;
  turn: (direction: PageTurnDirection) => void;
  openExternal: (href: string) => void;
  root: HTMLElement;
};

type ViewBinding = {
  docs: Map<Document, AbortController>;
  events: AbortController;
};

function asElement(target: EventTarget | null) {
  // Nodes from a rendered iframe belong to a different realm, so they are not
  // instanceof the host window's Element constructor.
  return target && (target as Node).nodeType === 1 ? target as Element : null;
}

function isPlainClick(event: MouseEvent | PointerEvent) {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey;
}

function isClick(start: Point | null, event: MouseEvent) {
  return Boolean(start)
    && Math.abs(event.clientX - start!.x) <= CLICK_DISTANCE
    && Math.abs(event.clientY - start!.y) <= CLICK_DISTANCE;
}

function isInteractiveTarget(target: EventTarget | null) {
  return Boolean(asElement(target)?.closest(
      'a[href], button, input, select, textarea, label, summary, [contenteditable="true"], audio[controls], video[controls]',
    ));
}

function flashTarget(view: ReaderView, resolved?: Resolved) {
  if (!resolved || typeof resolved.anchor !== "function") return;
  const content = view.renderer?.getContents?.()
    .find(({ index }) => index === resolved.index);
  const doc = content?.doc;
  if (!doc) return;

  let target: Node | Range | number | null;
  try {
    target = resolved.anchor(doc);
  } catch {
    return;
  }
  if (!target || typeof target === "number") return;

  const node = "startContainer" in target ? target.startContainer : target;
  let element = node.nodeType === 1 ? node as Element : node.parentElement;
  while (element && !element.getClientRects().length) element = element.parentElement;
  if (!element) return;

  element.classList.remove(TARGET_CLASS);
  element.getBoundingClientRect();
  element.classList.add(TARGET_CLASS);
  element.addEventListener("animationend", () => {
    element?.classList.remove(TARGET_CLASS);
  }, { once: true });
}

function edgeAt(x: number, width: number): PageTurnDirection | null {
  const edge = width * EDGE_RATIO;
  if (x <= edge) return "left";
  if (x >= width - edge) return "right";
  return null;
}

class CursorHider {
  readonly #targets = new Map<HTMLElement, () => boolean>();
  #timer?: number;
  #point?: Point;

  add(target: HTMLElement, enabled: () => boolean, signal: AbortSignal) {
    this.#targets.set(target, enabled);
    target.addEventListener("mousemove", this.#move, { signal });
    signal.addEventListener("abort", () => {
      this.#targets.delete(target);
      target.style.removeProperty("cursor");
    }, { once: true });
  }

  destroy() {
    window.clearTimeout(this.#timer);
    this.#targets.forEach((_, target) => target.style.removeProperty("cursor"));
    this.#targets.clear();
  }

  readonly #move = (event: MouseEvent) => {
    if (this.#point?.x === event.screenX && this.#point.y === event.screenY) return;
    this.#point = { x: event.screenX, y: event.screenY };
    this.#targets.forEach((_, target) => target.style.removeProperty("cursor"));
    window.clearTimeout(this.#timer);
    if (![...this.#targets.values()].some((enabled) => enabled())) return;
    this.#timer = window.setTimeout(() => {
      this.#targets.forEach((enabled, target) => {
        if (enabled()) target.style.setProperty("cursor", "none");
      });
    }, CURSOR_DELAY);
  };
}

/** Owns pointer, link, and cursor behavior for both the reader shell and its documents. */
export function createInteractions(options: InteractionOptions) {
  const views = new Map<ReaderView, ViewBinding>();
  const rootEvents = new AbortController();
  const cursor = new CursorHider();
  let rootStart: Point | null = null;
  const edgeFromViewport = (x: number) => {
    const rect = options.root.getBoundingClientRect();
    return edgeAt(x - rect.left, rect.width);
  };

  options.root.addEventListener("pointerdown", (event) => {
    rootStart = null;
    if (options.getFlow() !== "scrolled" || !event.isPrimary || !isPlainClick(event)) return;
    if (!(event.target instanceof Node) || !options.root.contains(event.target)) return;
    rootStart = { x: event.clientX, y: event.clientY };
  }, { capture: true, signal: rootEvents.signal });

  options.root.addEventListener("click", (event) => {
    const start = rootStart;
    rootStart = null;
    if (options.getFlow() !== "scrolled" || !isPlainClick(event)) return;
    if (!(event.target instanceof Node) || !options.root.contains(event.target)) return;
    if (!isClick(start, event)) return;
    if (isInteractiveTarget(event.target)) return;
    const direction = edgeFromViewport(event.clientX);
    if (direction) options.turn(direction);
  }, { signal: rootEvents.signal });

  const bindDoc = (view: ReaderView, doc: Document, index: number, binding: ViewBinding) => {
    if (binding.docs.has(doc)) return;
    const events = new AbortController();
    binding.docs.set(doc, events);
    const { signal } = events;
    let start: Point | null = null;

    cursor.add(doc.documentElement, () => view.hasAttribute("autohide-cursor"), signal);
    const targetStyle = doc.createElement("style");
    targetStyle.textContent = TARGET_STYLE;
    doc.head?.append(targetStyle);

    doc.addEventListener("pointerdown", (event) => {
      start = null;
      if (!event.isPrimary || !isPlainClick(event)) return;
      start = { x: event.clientX, y: event.clientY };
    }, { capture: true, signal });

    doc.addEventListener("click", (event) => {
      const clickStart = start;
      start = null;
      if (!isPlainClick(event)) return;

      const anchor = asElement(event.target)?.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        event.preventDefault();
        const sourceHref = anchor.getAttribute("href");
        if (!sourceHref) return;
        const section = view.book?.sections?.[index];
        const href = section?.resolveHref?.(sourceHref) ?? sourceHref;
        if (view.book?.isExternal?.(href)) {
          options.openExternal(href);
        } else {
          void options.navigate(href)
            .then((resolved) => flashTarget(view, resolved))
            .catch((error) => {
              console.warn("Failed to open reader link.", error);
            });
        }
        return;
      }
      if (!isClick(clickStart, event)) return;
      if (isInteractiveTarget(event.target)) return;

      const frame = doc.defaultView?.frameElement;
      const frameLeft = frame?.nodeType === Node.ELEMENT_NODE
        ? (frame as Element).getBoundingClientRect().left
        : 0;
      const direction = edgeFromViewport(frameLeft + event.clientX);
      if (!direction) return;

      if (view.renderer?.getAttribute("flow") !== "scrolled") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      options.turn(direction);
    }, { capture: true, signal });
  };

  const unbindDoc = (binding: ViewBinding, doc: Document) => {
    binding.docs.get(doc)?.abort();
    binding.docs.delete(doc);
  };

  const bindView = (view: ReaderView) => {
    if (views.has(view)) return;
    const binding: ViewBinding = { docs: new Map(), events: new AbortController() };
    views.set(view, binding);
    cursor.add(view, () => view.hasAttribute("autohide-cursor"), binding.events.signal);

    view.renderer?.getContents?.().forEach(({ doc, index }) => {
      if (doc) bindDoc(view, doc, index, binding);
    });
    view.addEventListener("load", (event) => {
      bindDoc(view, event.detail.doc, event.detail.index, binding);
    }, { signal: binding.events.signal });
    view.addEventListener("unload", (event) => {
      unbindDoc(binding, event.detail.doc);
    }, { signal: binding.events.signal });
  };

  const unbindView = (view: ReaderView) => {
    const binding = views.get(view);
    if (!binding) return;
    binding.events.abort();
    binding.docs.forEach((events) => events.abort());
    binding.docs.clear();
    views.delete(view);
  };

  return {
    bindView,
    destroy() {
      rootEvents.abort();
      views.forEach((_, view) => unbindView(view));
      cursor.destroy();
    },
    unbindView,
  };
}
