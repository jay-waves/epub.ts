import { Overlay } from "./overlay";
import { getVisibleRange } from "./visible-location";

export type SectionDirection = {
  background?: string;
  rtl: boolean;
  vertical: boolean;
};

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
  if (!view) return { rtl: false, vertical: false };
  const { writingMode, direction } = view.getComputedStyle(doc.body);
  const vertical = writingMode === "vertical-rl" || writingMode === "vertical-lr";
  const rtl = doc.body.dir === "rtl"
    || direction === "rtl"
    || doc.documentElement.dir === "rtl";
  return { background: getDocumentBackground(doc), rtl, vertical };
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
  #compact = false;
  #layout?: SectionLayout;
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
  get extent() {
    return this.#layout?.kind === "columns"
      ? this.#contentColumns * this.#columnStep
      : this.#contentExtent;
  }

  set compact(value: boolean) {
    if (this.#compact === value) return;
    this.#compact = value;
    this.expand();
  }

  async load(source: string, afterLoad?: AfterLoad, resolveLayout?: ResolveLayout) {
    if (typeof source !== "string") throw new TypeError("Section source must be a string");
    await new Promise<void>((resolve, reject) => {
      this.#iframe.addEventListener("load", async () => {
        try {
          const doc = this.document;
          this.#iframe.style.display = "block";
          await afterLoad?.(doc);
          this.#throwIfDestroyed();

          const direction = getDirection(doc);
          this.#iframe.style.display = "none";
          this.#vertical = direction.vertical;
          this.#rtl = direction.rtl;
          this.#contentRange.selectNodeContents(doc.body);

          const layout = resolveLayout?.(direction);
          this.#iframe.style.display = "block";
          if (layout) this.render(layout);
          this.#observer.observe(doc.body);

          await doc.fonts.ready;
          this.#throwIfDestroyed();
          this.expand();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      this.#iframe.src = source;
    });
  }

  render(layout: SectionLayout) {
    this.#layout = layout;
    if (layout.kind === "columns") this.#columnize(layout);
    else this.#renderScrolled(layout);
  }

  #renderScrolled({ gap, columnWidth }: ScrolledSectionLayout) {
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
    this.expand();
  }

  #columnize(layout: PaginatedSectionLayout) {
    const { width, height, gap, columnWidth, columnCount, columnStep } = layout;
    this.#size = this.#vertical ? height : width;
    this.#columnCount = columnCount;
    this.#columnStep = columnStep;

    const doc = this.document;
    setStylesImportant(doc.documentElement, {
      "-webkit-line-box-contain": "block glyphs replaced",
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
    this.expand();
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

  expand() {
    if (this.#destroyed || !this.#layout) return;
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
      this.#contentExtent = this.#contentColumns * this.#columnStep;
      const pageCount = Math.ceil(this.#contentColumns / this.#columnCount);
      const expandedSize = pageCount * this.#size;
      this.#element.style.padding = "0";
      this.#iframe.style[side] = `${expandedSize}px`;
      this.#iframe.style.flex = `0 0 ${expandedSize}px`;
      this.#element.style[side] = this.#compact
        ? `${this.extent}px`
        : `${expandedSize + this.#size * 2}px`;
      this.#element.style.justifyContent = this.#compact ? "flex-start" : "center";
      this.#element.style.alignItems = this.#compact ? "flex-start" : "center";
      this.#iframe.style[otherSide] = "100%";
      this.#element.style[otherSide] = "100%";
      documentElement.style[side] = `${this.#size}px`;
      if (this.#overlay) {
        this.#overlay.element.style.margin = "0";
        this.#overlay.element.style.left = this.#compact || this.#vertical
          ? "0" : `${this.#size}px`;
        this.#overlay.element.style.top = this.#compact || !this.#vertical
          ? "0" : `${this.#size}px`;
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
    this.#onExpand();
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
        return { left: size - rect.right - margin, right: size - rect.left - margin };
      }
      return { left: rect.top + margin, right: rect.bottom + margin };
    }
    const pixelSize = Math.ceil(this.#contentColumns / this.#columnCount) * this.#size;
    if (this.#rtl) return { left: pixelSize - rect.right, right: pixelSize - rect.left };
    if (this.#vertical) return { left: rect.top, right: rect.bottom };
    return rect;
  }

  visibleRange(start: number, end: number) {
    return getVisibleRange(this.document, start, end, (rect) => this.mapRect(rect));
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#expandFrame !== undefined) cancelAnimationFrame(this.#expandFrame);
    this.#observer.disconnect();
    this.#media = undefined;
    this.#overlay = undefined;
  }

  #throwIfDestroyed() {
    if (this.#destroyed) throw new DOMException("Section frame destroyed", "AbortError");
  }
}

function validLimit(value: string) {
  return value !== "none" && value !== "0px";
}
