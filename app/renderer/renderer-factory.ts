import type { Book } from "./reader-view.js";
import type { Renderer } from "./renderer";
import type { RenderMode } from "./shared/flow-geometry";

export async function createRenderer(mode: RenderMode): Promise<Renderer> {
  if (mode === "fixed") {
    const { FixedRenderer } = await import("./fixed/fixed-renderer.js");
    return new FixedRenderer();
  }
  if (mode === "scrolled") {
    const { ScrolledRenderer } = await import("./scrolled/scrolled-renderer.js");
    return new ScrolledRenderer();
  }
  const { PaginatedRenderer } = await import("./paginated/paginated-renderer.js");
  return new PaginatedRenderer();
}

export function rendererModeForBook(book: Book): RenderMode {
  return book.rendition?.layout === "pre-paginated" ? "fixed" : "paginated";
}
