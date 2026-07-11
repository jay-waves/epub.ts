export class Overlayer {
  static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
  static outline(rects: DOMRectList, options?: unknown): SVGElement;
  static underline(rects: DOMRectList, options?: unknown): SVGElement;
  static strikethrough(rects: DOMRectList, options?: unknown): SVGElement;
  constructor(options?: unknown);
}
