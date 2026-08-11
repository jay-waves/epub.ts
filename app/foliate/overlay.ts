const SVG_NS = "http://www.w3.org/2000/svg";

type Rects = DOMRectList | readonly DOMRect[];

export type OverlayDrawOptions = {
  color?: string;
  radius?: number;
  src?: string;
  width?: number;
  writingMode?: string;
  [key: string]: unknown;
};

export type OverlayDraw<T extends OverlayDrawOptions = OverlayDrawOptions> = (
  rects: DOMRectList,
  options?: T,
) => SVGElement;

type Item<T extends OverlayDrawOptions = OverlayDrawOptions> = {
  draw: OverlayDraw<T>;
  element: SVGElement;
  options?: T;
  range: Range;
  rects: DOMRectList;
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K) {
  return document.createElementNS(SVG_NS, tag);
}

/** Draws and hit-tests decorations anchored to ranges in a reader document. */
export class Overlay {
  readonly #element = svg("svg");
  readonly #items = new Map<string, Item>();

  constructor() {
    Object.assign(this.#element.style, {
      height: "100%",
      left: "0",
      pointerEvents: "none",
      position: "absolute",
      top: "0",
      width: "100%",
    });
  }

  get element() {
    return this.#element;
  }

  add<T extends OverlayDrawOptions>(
    key: string,
    target: Range | ((root: Node) => Range),
    draw: OverlayDraw<T>,
    options?: T,
  ) {
    if (this.#items.has(key)) this.remove(key);
    const range = typeof target === "function" ? target(this.#element.getRootNode()) : target;
    const rects = range.getClientRects();
    const element = draw(rects, options);
    this.#element.append(element);
    this.#items.set(key, { draw, element, options, range, rects } as Item);
  }

  remove(key: string) {
    const item = this.#items.get(key);
    if (!item) return;
    item.element.remove();
    this.#items.delete(key);
  }

  redraw() {
    for (const item of this.#items.values()) {
      item.element.remove();
      const rects = item.range.getClientRects();
      const element = item.draw(rects, item.options);
      this.#element.append(element);
      item.element = element;
      item.rects = rects;
    }
  }

  hitTest({ x, y }: { x: number; y: number }): [string, Range] | [] {
    const items = Array.from(this.#items.entries());
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const entry = items[index];
      if (!entry) continue;
      const [key, item] = entry;
      for (const rect of item.rects) {
        if (rect.top <= y && rect.left <= x && rect.bottom > y && rect.right > x) {
          return [key, item.range];
        }
      }
    }
    return [];
  }

  static underline(rects: Rects, options: OverlayDrawOptions = {}) {
    const { color = "red", width = 2, writingMode } = options;
    const group = svg("g");
    group.setAttribute("fill", color);
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr") {
      for (const { right, top, height } of rects) {
        const line = svg("rect");
        line.setAttribute("x", String(right - width));
        line.setAttribute("y", String(top));
        line.setAttribute("height", String(height));
        line.setAttribute("width", String(width));
        group.append(line);
      }
    } else {
      for (const { left, bottom, width: rectWidth } of rects) {
        const line = svg("rect");
        line.setAttribute("x", String(left));
        line.setAttribute("y", String(bottom - width));
        line.setAttribute("height", String(width));
        line.setAttribute("width", String(rectWidth));
        group.append(line);
      }
    }
    return group;
  }

  static strikethrough(rects: Rects, options: OverlayDrawOptions = {}) {
    const { color = "red", width = 2, writingMode } = options;
    const group = svg("g");
    group.setAttribute("fill", color);
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr") {
      for (const { right, left, top, height } of rects) {
        const line = svg("rect");
        line.setAttribute("x", String((right + left) / 2));
        line.setAttribute("y", String(top));
        line.setAttribute("height", String(height));
        line.setAttribute("width", String(width));
        group.append(line);
      }
    } else {
      for (const { left, top, bottom, width: rectWidth } of rects) {
        const line = svg("rect");
        line.setAttribute("x", String(left));
        line.setAttribute("y", String((top + bottom) / 2));
        line.setAttribute("height", String(width));
        line.setAttribute("width", String(rectWidth));
        group.append(line);
      }
    }
    return group;
  }

  static squiggly(rects: Rects, options: OverlayDrawOptions = {}) {
    const { color = "red", width = 2, writingMode } = options;
    const group = svg("g");
    group.setAttribute("fill", "none");
    group.setAttribute("stroke", color);
    group.setAttribute("stroke-width", String(width));
    const block = width * 1.5;
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr") {
      for (const { right, top, height } of rects) {
        const path = svg("path");
        const count = Math.round(height / block / 1.5);
        const inline = height / count;
        const lines = Array.from(
          { length: count },
          (_, index) => `l${index % 2 ? -block : block} ${inline}`,
        ).join("");
        path.setAttribute("d", `M${right} ${top}${lines}`);
        group.append(path);
      }
    } else {
      for (const { left, bottom, width: rectWidth } of rects) {
        const path = svg("path");
        const count = Math.round(rectWidth / block / 1.5);
        const inline = rectWidth / count;
        const lines = Array.from(
          { length: count },
          (_, index) => `l${inline} ${index % 2 ? block : -block}`,
        ).join("");
        path.setAttribute("d", `M${left} ${bottom}${lines}`);
        group.append(path);
      }
    }
    return group;
  }

  static highlight(rects: Rects, options: OverlayDrawOptions = {}) {
    const { color = "red" } = options;
    const group = svg("g");
    group.setAttribute("fill", color);
    group.style.opacity = "var(--overlayer-highlight-opacity, .3)";
    group.style.mixBlendMode = "var(--overlayer-highlight-blend-mode, normal)";
    for (const { left, top, height, width } of rects) {
      const rect = svg("rect");
      rect.setAttribute("x", String(left));
      rect.setAttribute("y", String(top));
      rect.setAttribute("height", String(height));
      rect.setAttribute("width", String(width));
      group.append(rect);
    }
    return group;
  }

  static outline(rects: Rects, options: OverlayDrawOptions = {}) {
    const { color = "red", width = 3, radius = 3 } = options;
    const group = svg("g");
    group.setAttribute("fill", "none");
    group.setAttribute("stroke", color);
    group.setAttribute("stroke-width", String(width));
    for (const { left, top, height, width: rectWidth } of rects) {
      const rect = svg("rect");
      rect.setAttribute("x", String(left));
      rect.setAttribute("y", String(top));
      rect.setAttribute("height", String(height));
      rect.setAttribute("width", String(rectWidth));
      rect.setAttribute("rx", String(radius));
      group.append(rect);
    }
    return group;
  }

  static copyImage(rects: Rects, options: OverlayDrawOptions = {}) {
    const rect = rects[0];
    if (!rect) return svg("image");
    const image = svg("image");
    const { left, top, height, width } = rect;
    if (options.src) image.setAttribute("href", options.src);
    image.setAttribute("x", String(left));
    image.setAttribute("y", String(top));
    image.setAttribute("height", String(height));
    image.setAttribute("width", String(width));
    return image;
  }
}

// Keep the foliate-js public name while using the shorter project-side name.
export { Overlay as Overlayer };
