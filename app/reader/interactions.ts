import type { ReaderView } from "./model";
import type { Resolved } from "../renderer";
import { observeRenderedDocuments } from "./documents";

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
  navigate: (href: string) => Promise<Resolved | undefined>;
  openExternal: (href: string) => void;
};

type ViewBinding = {
  events: AbortController;
  stopDocuments: () => void;
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

/** Owns link routing and cursor behavior for the reader shell and its documents. */
export function createInteractions(options: InteractionOptions) {
  const views = new Map<ReaderView, ViewBinding>();
  const cursor = new CursorHider();

  const bindDoc = (view: ReaderView, doc: Document, index: number, signal: AbortSignal) => {
    cursor.add(doc.documentElement, () => view.hasAttribute("autohide-cursor"), signal);
    const targetStyle = doc.createElement("style");
    targetStyle.textContent = TARGET_STYLE;
    doc.head?.append(targetStyle);

    doc.addEventListener("click", (event) => {
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
      }
    }, { capture: true, signal });
  };

  const bindView = (view: ReaderView) => {
    if (views.has(view)) return;
    const events = new AbortController();
    const binding: ViewBinding = {
      events,
      stopDocuments: observeRenderedDocuments(view, ({ doc, index }, signal) => bindDoc(view, doc, index, signal)),
    };
    views.set(view, binding);
    cursor.add(view, () => view.hasAttribute("autohide-cursor"), events.signal);
  };

  const unbindView = (view: ReaderView) => {
    const binding = views.get(view);
    if (!binding) return;
    binding.events.abort();
    binding.stopDocuments();
    views.delete(view);
  };

  return {
    bindView,
    destroy() {
      views.forEach((_, view) => unbindView(view));
      cursor.destroy();
    },
    unbindView,
  };
}
