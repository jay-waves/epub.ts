import type { FoliateViewElement } from "./foliate";
import type { Navigation } from "./reader/navigation";
import type { PageTurnDirection } from "./viewer-events";

const EDGE_RATIO = 0.22;
const CLICK_DISTANCE = 4;
const CURSOR_DELAY = 1_000;

type Point = { x: number; y: number };

type InteractionOptions = {
  getFlow: () => "paginated" | "scrolled";
  getNavigation: () => Navigation | null;
  onEdgeClick: (direction: PageTurnDirection) => void;
  openExternal: (href: string) => void;
  root: HTMLElement;
};

type ViewBinding = {
  docs: Map<Document, AbortController>;
  events: AbortController;
};

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

function emit<T>(view: FoliateViewElement, type: string, detail: T, cancelable = false) {
  return view.dispatchEvent(new CustomEvent(type, { cancelable, detail }));
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
export function createReaderInteractions(options: InteractionOptions) {
  const views = new Map<FoliateViewElement, ViewBinding>();
  const rootEvents = new AbortController();
  const cursor = new CursorHider();
  let rootStart: Point | null = null;

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
    const direction = edgeAt(event.clientX, window.innerWidth);
    if (direction) options.onEdgeClick(direction);
  }, { signal: rootEvents.signal });

  const bindDoc = (view: FoliateViewElement, doc: Document, index: number, binding: ViewBinding) => {
    if (binding.docs.has(doc)) return;
    const events = new AbortController();
    binding.docs.set(doc, events);
    const { signal } = events;
    let start: Point | null = null;

    cursor.add(doc.documentElement, () => view.hasAttribute("autohide-cursor"), signal);

    doc.addEventListener("pointerdown", (event) => {
      start = null;
      if (!event.isPrimary || !isPlainClick(event)) return;
      start = { x: event.clientX, y: event.clientY };
    }, { capture: true, signal });

    doc.addEventListener("click", (event) => {
      const clickStart = start;
      start = null;
      if (!isPlainClick(event) || !isClick(clickStart, event)) return;

      const frame = doc.defaultView?.frameElement;
      const x = frame instanceof Element
        ? frame.getBoundingClientRect().left + event.clientX
        : event.clientX;
      const width = doc.defaultView?.top?.innerWidth
        || doc.defaultView?.parent?.innerWidth
        || doc.defaultView?.innerWidth
        || doc.documentElement.clientWidth;
      if (!width) return;
      const direction = edgeAt(x, width);
      if (!direction) return;

      if (view.renderer?.getAttribute("flow") !== "scrolled") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      emit(view, "edge-click", { x });
      options.onEdgeClick(direction);
    }, { capture: true, signal });

    doc.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!anchor) return;
      event.preventDefault();
      const sourceHref = anchor.getAttribute("href");
      if (!sourceHref) return;
      const section = view.book?.sections?.[index];
      const href = section?.resolveHref?.(sourceHref) ?? sourceHref;
      if (view.book?.isExternal?.(href)) {
        if (emit(view, "external-link", { a: anchor, href_: sourceHref }, true)) {
          options.openExternal(sourceHref);
        }
      } else if (emit(view, "link", { a: anchor, href }, true)) {
        void options.getNavigation()?.go(href).catch((error) => {
          console.warn("Failed to open reader link.", error);
        });
      }
    }, { signal });
  };

  const unbindDoc = (binding: ViewBinding, doc: Document) => {
    binding.docs.get(doc)?.abort();
    binding.docs.delete(doc);
  };

  const bindView = (view: FoliateViewElement) => {
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

  const unbindView = (view: FoliateViewElement) => {
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
