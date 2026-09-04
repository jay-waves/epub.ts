import type { ReaderView as BaseView } from "./reader-view.js";

export { Overlay } from "./shared/overlay";
export { FixedRenderer } from "./fixed/fixed-renderer.js";
export { PaginatedRenderer } from "./paginated/paginated-renderer.js";
export { ScrolledRenderer } from "./scrolled/scrolled-renderer.js";
export type { OverlayDraw, OverlayDrawOptions } from "./shared/overlay";
export type {
  Book,
  BookMetadata,
  BookRendition,
  BookSection,
  Collection,
  Content,
  Decoration,
  DocumentAnchorResolver,
  ReadingPosition,
  RelocateDetail,
  RelocationReason,
  Renderer,
  ResolvedNavigationTarget,
  SectionAnchor,
  TocItem,
  Contributor,
  ContributorDetails,
  Identifier,
  LocalizedText,
  PublicationViewport,
  ReaderView,
} from "./reader-view.js";

export async function createView() {
  await import("./reader-view.js");
  return document.createElement("epub-view") as BaseView;
}
