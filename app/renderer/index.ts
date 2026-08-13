import type { View as BaseView } from "./view.js";

export { Overlay } from "./overlay";
export type { OverlayDraw, OverlayDrawOptions } from "./overlay";
export type {
  Annotation,
  Anchor,
  Book,
  BookSection,
  Content,
  Decoration,
  RawRelocateDetail,
  Resolved,
  TocItem,
  View,
} from "./view.js";

export async function createView<Item extends import("./view.js").Annotation = import("./view.js").Annotation>() {
  await import("./view.js");
  return document.createElement("epub-view") as BaseView<Item>;
}
