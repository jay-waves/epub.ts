import { Overlay } from "./overlay";
import { loadFrameDocument } from "./frame-document";
import { getAnchorRect, uncollapseRange } from "./navigation";
import { getVisibleRange } from "./visible-range";

export type SectionDirection = {
  rtl: boolean;
  vertical: boolean;
  writingMode: "horizontal-tb" | "vertical-lr" | "vertical-rl";
};

export function sameSectionDirection(a: SectionDirection, b: SectionDirection) {
  return a.rtl === b.rtl && a.writingMode === b.writingMode;
}

type SectionLayoutBase = {
  gap: number;
  height: number;
  margin: number;
  width: number;
};

export type PaginatedSectionLayout = SectionLayoutBase & {
  kind: "columns";
  columnCount: number;
  columnStep: number;
  columnWidth: number;
};

export type ScrolledSectionLayout = SectionLayoutBase & {
  kind: "scrolled";
  columnWidth: number;
};

export type SectionLayout = PaginatedSectionLayout | ScrolledSectionLayout;

type SectionFrameOptions = {
  onExpand: () => void;
};

type AfterLoad = (doc: Document) => Promise<void> | void;
type ResolveLayout = (direction: SectionDirection) => SectionLayout | undefined;
type StyledMedia = Element & ElementCSSInlineStyle;

type MediaLimits = {
  maxHeight: string;
  maxWidth: string;
};

type MappedRect = { left: number; right: number };

export function getDocumentBackground(doc: Document) {
  const view = doc.defaultView;
  if (!view) return "";
  const bodyStyle = view.getComputedStyle(doc.body);
  return bodyStyle.backgroundColor === "rgba(0, 0, 0, 0)"
      && bodyStyle.backgroundImage === "none"
    ? view.getComputedStyle(doc.documentElement).background
    : bodyStyle.background;
}

function getDirection(doc: Document): SectionDirection {
  const view = doc.defaultView;
  if (!view) return { rtl: false, vertical: false, writingMode: "horizontal-tb" };
  const { writingMode, direction } = view.getComputedStyle(doc.body);
  const vertical = writingMode === "vertical-rl" || writingMode === "vertical-lr";
  const rtl = doc.body.dir === "rtl"
    || direction === "rtl"
    || doc.documentElement.dir === "rtl";
  return {
    rtl,
    vertical,
    writingMode: vertical ? writingMode : "horizontal-tb",
  };
}

function setStylesImportant(element: ElementCSSInlineStyle, styles: Record<string, string>) {
  for (const [name, value] of Object.entries(styles)) {
    if (element.style.getPropertyValue(name) !== value
      || element.style.getPropertyPriority(name) !== "important") {
      element.style.setProperty(name, value, "important");
    }
  }
}

/** One loaded reflowable spine document and its layout measurements. */
export class SectionFrame {
  readonly #observer = new ResizeObserver(() => this.#scheduleExpand());
  readonly #element = document.createElement("div");
  readonly #iframe = document.createElement("iframe");
  readonly #lifecycle = new AbortController();
  readonly #contentRange = document.createRange();
  readonly #mediaLimits = new WeakMap<StyledMedia, MediaLimits>();
  readonly #onExpand: () => void;
  #expandFrame?: number;
  #media?: StyledMedia[];
  #overlay?: Overlay;
  #vertical = false;
  #rtl = false;
  #size = 0;
  #columnCount = 1;
  #columnStep = 0;
  #contentColumns = 1;
  #contentExtent = 1;
  #direction: SectionDirection = {
    rtl: false,
    vertical: false,
    writingMode: "horizontal-tb",
  };
  #layout?: SectionLayout;
  #navigationCue?: SVGElement;
  #destroyed = false;

  constructor({ onExpand }: SectionFrameOptions) {
    this.#onExpand = onExpand;
    this.#iframe.setAttribute("part", "filter");
    this.#iframe.setAttribute("sandbox", "allow-same-origin");
    this.#iframe.setAttribute("scrolling", "no");
    this.#element.append(this.#iframe);
    Object.assign(this.#element.style, {
      alignItems: "center",
      boxSizing: "content-box",
      display: "flex",
      flex: "0 0 auto",
      height: "100%",
      justifyContent: "center",
      overflow: "hidden",
      position: "absolute",
      visibility: "hidden",
      width: "100%",
    });
    Object.assign(this.#iframe.style, {
      border: "0",
      display: "none",
      height: "100%",
      overflow: "hidden",
      width: "100%",
    });
  }

  get element() { return this.#element; }

  get document() {
    const doc = this.#iframe.contentDocument;
    if (!doc) throw new DOMException("Section document is unavailable", "InvalidStateError");
    return doc;
  }

  get columnCount() { return this.#columnCount; }
  get columnStep() { return this.#columnStep; }
  get contentColumns() { return this.#contentColumns; }
  get direction() { return this.#direction; }
  get margin() { return this.#layout?.margin ?? 0; }
  get extent() {
    return this.#layout?.kind === "columns"
      ? this.#contentColumns * this.#columnStep
      : this.#contentExtent;
  }

  async load(source: string, afterLoad?: AfterLoad, resolveLayout?: ResolveLayout) {
    if (typeof source !== "string") throw new TypeError("Section source must be a string");
    await loadFrameDocument(this.#iframe, source, this.#lifecycle.signal, async (doc, signal) => {
      this.#iframe.style.display = "block";
      await afterLoad?.(doc);
      signal.throwIfAborted();

      const direction = getDirection(doc);
      this.#direction = direction;
      this.#iframe.style.display = "none";
      this.#vertical = direction.vertical;
      this.#rtl = direction.rtl;
      this.#contentRange.selectNodeContents(doc.body);

      const layout = resolveLayout?.(direction);
      this.#iframe.style.display = "block";
      if (layout) this.render(layout);
      this.#observer.observe(doc.body);

      await doc.fonts.ready;
      signal.throwIfAborted();
      this.expand();
    });
  }

  render(layout: SectionLayout, notify = true) {
    this.#layout = layout;
    if (layout.kind === "columns") this.#columnize(layout, notify);
    else this.#renderScrolled(layout, notify);
  }

  #renderScrolled({ gap, columnWidth }: ScrolledSectionLayout, notify: boolean) {
    const doc = this.document;
    this.#iframe.style.flex = "0 0 auto";
    this.#element.style.justifyContent = "center";
    this.#element.style.alignItems = "center";
    setStylesImportant(doc.documentElement, {
      "box-sizing": "border-box",
      "column-width": "auto",
      "height": "auto",
      "padding": this.#vertical ? `${gap}px 0` : `0 ${gap}px`,
      "width": "auto",
    });
    setStylesImportant(doc.body, {
      [this.#vertical ? "max-height" : "max-width"]: `${columnWidth}px`,
      "margin": "auto",
    });
    this.#setMediaSize();
    this.expand(notify);
  }

  #columnize(layout: PaginatedSectionLayout, notify: boolean) {
    const { width, height, gap, columnWidth, columnCount, columnStep } = layout;
    this.#size = this.#vertical ? height : width;
    this.#columnCount = columnCount;
    this.#columnStep = columnStep;

    const doc = this.document;
    setStylesImportant(doc.documentElement, {
      "border": "0",
      "box-sizing": "border-box",
      "column-fill": "auto",
      "column-gap": `${gap}px`,
      "column-width": `${columnWidth}px`,
      // Apply both viewport dimensions before measuring the column flow.
      // Keeping the old inline dimension until expand() made the first reflow
      // after a resize use stale, sometimes wider, columns.
      "height": `${height}px`,
      "width": `${width}px`,
      "margin": "0",
      "max-height": "none",
      "max-width": "none",
      "min-height": "none",
      "min-width": "none",
      "overflow": "hidden",
      "overflow-wrap": "break-word",
      "padding": this.#vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
      "position": "static",
    });
    setStylesImportant(doc.body, {
      "margin": "0",
      "max-height": "none",
      "max-width": "none",
    });
    this.#setMediaSize();
    this.expand(notify);
  }

  #setMediaSize() {
    const layout = this.#layout;
    if (!layout) return;
    const { width, height, margin } = layout;
    const doc = this.document;
    this.#media ??= Array.from(
      doc.body.querySelectorAll<StyledMedia>("img, svg, video"),
    );
    for (const element of this.#media) {
      let limits = this.#mediaLimits.get(element);
      if (!limits) {
        const style = doc.defaultView?.getComputedStyle(element);
        limits = {
          maxHeight: style?.maxHeight ?? "none",
          maxWidth: style?.maxWidth ?? "none",
        };
        this.#mediaLimits.set(element, limits);
      }
      const { maxHeight, maxWidth } = limits;
      setStylesImportant(element, {
        "box-sizing": "border-box",
        "break-inside": "avoid",
        "max-height": this.#vertical
          ? validLimit(maxHeight) ? maxHeight : "100%"
          : `${Math.max(0, height - margin * 2)}px`,
        "max-width": this.#vertical
          ? `${Math.max(0, width - margin * 2)}px`
          : validLimit(maxWidth) ? maxWidth : "100%",
        "object-fit": "contain",
      });
    }
  }

  #scheduleExpand() {
    if (this.#destroyed || this.#expandFrame !== undefined) return;
    this.#expandFrame = requestAnimationFrame(() => {
      this.#expandFrame = undefined;
      this.expand();
    });
  }

  expand(notify = true) {
    if (this.#destroyed || !this.#layout) return;
    const previousExtent = this.extent;
    const { documentElement } = this.document;
    if (this.#layout.kind === "columns") {
      const side = this.#vertical ? "height" : "width";
      const otherSide = this.#vertical ? "width" : "height";
      const contentRect = this.#contentRange.getBoundingClientRect();
      const rootRect = documentElement.getBoundingClientRect();
      const contentStart = this.#vertical ? 0
        : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left;
      const contentSize = contentStart + contentRect[side];
      this.#contentColumns = Math.max(1, Math.ceil(contentSize / this.#columnStep));
      const pageCount = Math.ceil(this.#contentColumns / this.#columnCount);
      const expandedSize = pageCount * this.#size;
      this.#element.style.padding = "0";
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#iframe.style.flex = `0 0 ${expandedSize}px`;
      this.#element.style[side] = `${this.extent}px`;
      this.#element.style.justifyContent = "flex-start";
      this.#element.style.alignItems = "flex-start";
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
      documentElement.style[side] = `${this.#size}px`;
      if (this.#overlay) {
        this.#overlay.element.style.margin = "0";
        this.#overlay.element.style.left = "0";
        this.#overlay.element.style.top = "0";
        this.#overlay.element.style[side] = `${expandedSize}px`;
        this.#overlay.redraw();
      }
    } else {
      const side = this.#vertical ? "width" : "height";
      const otherSide = this.#vertical ? "height" : "width";
      const expandedSize = documentElement.getBoundingClientRect()[side];
      const { margin } = this.#layout;
      this.#contentExtent = expandedSize + margin * 2;
      const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`;
      this.#element.style.padding = padding;
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#element.style[side] = `${expandedSize}px`;
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
      if (this.#overlay) {
        this.#overlay.element.style.margin = padding;
        this.#overlay.element.style.left = "0";
        this.#overlay.element.style.top = "0";
        this.#overlay.element.style[side] = `${expandedSize}px`;
        this.#overlay.redraw();
      }
    }
    if (notify && this.extent !== previousExtent) this.#onExpand();
  }

  set overlay(overlay: Overlay | undefined) {
    this.#overlay = overlay;
    if (overlay) this.#element.append(overlay.element);
  }

  get overlay() { return this.#overlay; }

  mapRect(rect: DOMRect): MappedRect {
    if (this.#layout?.kind !== "columns") {
      const size = this.#element.getBoundingClientRect()[this.#vertical ? "width" : "height"];
      const margin = this.#layout?.margin ?? 0;
      if (this.#vertical) {
        return this.#direction.writingMode === "vertical-rl"
          ? { left: size - rect.right - margin, right: size - rect.left - margin }
          : { left: rect.left + margin, right: rect.right + margin };
      }
      return { left: rect.top + margin, right: rect.bottom + margin };
    }
    const pixelSize = Math.ceil(this.#contentColumns / this.#columnCount) * this.#size;
    if (this.#vertical) return { left: rect.top, right: rect.bottom };
    if (this.#rtl) return { left: pixelSize - rect.right, right: pixelSize - rect.left };
    return rect;
  }

  visibleRange(start: number, end: number) {
    return getVisibleRange(this.document, start, end, (rect) => this.mapRect(rect));
  }

  showNavigationCue(target: Node | Range | undefined) {
    this.#navigationCue?.remove();
    this.#navigationCue = undefined;
    if (!target || !this.#overlay || !this.#layout) return;

    const expanded = "startContainer" in target
      ? uncollapseRange(target.cloneRange())
      : uncollapseRange(target);
    const targetRect = getAnchorRect(expanded);
    if (!targetRect) return;

    const doc = this.document;
    const node = "startContainer" in target ? target.startContainer : target;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const style = element && doc.defaultView?.getComputedStyle(element);
    const lineHeight = Number.parseFloat(style?.lineHeight ?? "") || 0;
    const bodyRect = doc.body.getBoundingClientRect();
    const { gap } = this.#layout;

    let { height, left, top, width } = targetRect;
    if (this.#vertical) {
      width = Math.max(width, lineHeight);
      left -= Math.max(0, width - targetRect.width) / 2;
      if (this.#layout.kind === "columns") {
        top = Math.floor(Math.max(0, targetRect.top) / this.#columnStep) * this.#columnStep
          + gap / 2;
        height = this.#layout.columnWidth;
      } else {
        top = bodyRect.top;
        height = bodyRect.height;
      }
    } else {
      height = Math.max(height, lineHeight);
      top -= Math.max(0, height - targetRect.height) / 2;
      if (this.#layout.kind === "columns") {
        left = Math.floor(Math.max(0, targetRect.left) / this.#columnStep) * this.#columnStep
          + gap / 2;
        width = this.#layout.columnWidth;
      } else {
        left = bodyRect.left;
        width = bodyRect.width;
      }
    }

    const band = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const accent = doc.defaultView?.getComputedStyle(doc.documentElement)
      .getPropertyValue("--reader-accent-primary").trim() || "#2563eb";
    band.setAttribute("x", String(left));
    band.setAttribute("y", String(top));
    band.setAttribute("width", String(Math.max(1, width)));
    band.setAttribute("height", String(Math.max(1, height)));
    band.setAttribute("fill", `color-mix(in srgb, ${accent} 16%, transparent)`);
    this.#overlay.element.append(band);
    this.#navigationCue = band;

    const remove = () => {
      if (this.#navigationCue === band) this.#navigationCue = undefined;
      band.remove();
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTimeout(remove, 700);
    } else {
      const animation = band.animate([
        { opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.55 },
        { opacity: 0 },
      ], { duration: 900, easing: "linear" });
      void animation.finished.then(remove, remove);
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#lifecycle.abort(new DOMException("Section frame destroyed", "AbortError"));
    if (this.#expandFrame !== undefined) cancelAnimationFrame(this.#expandFrame);
    this.#observer.disconnect();
    this.#navigationCue?.remove();
    this.#media = undefined;
    this.#overlay = undefined;
  }

}

function validLimit(value: string) {
  return value !== "none" && value !== "0px";
}
