import { rewritePublisherFontFamilies } from "./font-family";

type TransformDetail = {
  data: string | Promise<string>;
  type: string;
};

type TransformableBook = {
  transformTarget?: EventTarget;
};

const normalizedBooks = new WeakSet<object>();

/** Installs publication-content CSS normalization once per book. */
export function installTypographyNormalization(book: TransformableBook) {
  const target = book.transformTarget;
  if (!target || normalizedBooks.has(book)) return;
  normalizedBooks.add(book);
  target.addEventListener("data", ((event: CustomEvent<TransformDetail>) => {
    if (event.detail.type !== "text/css") return;
    event.detail.data = Promise.resolve(event.detail.data).then((css) =>
      rewritePublisherFontFamilies(css).replace(/(?<=[{\s;])-epub-/giu, ""));
  }) as EventListener);
}
