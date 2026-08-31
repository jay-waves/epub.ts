import type { ReaderView as BaseView } from "./reader-view.js";

export { Overlay } from "./shared/overlay";
export { FixedRenderer } from "./fixed/fixed-renderer.js";
export { PaginatedRenderer } from "./paginated/paginated-renderer.js";
export { ScrolledRenderer } from "./scrolled/scrolled-renderer.js";
export type { OverlayDraw, OverlayDrawOptions } from "./shared/overlay";
export type {
  Annotation,
  Anchor,
  Book,
  BookMetadata,
  BookRendition,
  BookSection,
  Content,
  Decoration,
  ReadingPosition,
  RelocateDetail,
  Renderer,
  Resolved,
  TocItem,
  Contributor,
  Identifier,
  LocalizedText,
  View,
  ReaderView,
} from "./reader-view.js";

export async function createView() {
  await import("./reader-view.js");
  return document.createElement("epub-view") as BaseView;
}
