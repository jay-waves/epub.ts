import type { Book } from "../reader-view.js";

type TransformDetail = {
  data: string | Promise<string>;
  type: string;
};

const normalizedBooks = new WeakSet<object>();

/** Installs mode-neutral EPUB CSS normalization once for an open book. */
export function installBookCssNormalization(book: Book) {
  const target = book.transformTarget;
  if (!target || normalizedBooks.has(book)) return;
  normalizedBooks.add(book);
  target.addEventListener("data", ((event: CustomEvent<TransformDetail>) => {
    if (event.detail.type !== "text/css") return;
    event.detail.data = Promise.resolve(event.detail.data).then((css) => css
      .replace(/(?<=[{\s;])-epub-/giu, "")
      .replace(/(\d*\.?\d+)vw/giu, (_match, value: string) =>
        `${parseFloat(value) * window.innerWidth / 100}px`)
      .replace(/(\d*\.?\d+)vh/giu, (_match, value: string) =>
        `${parseFloat(value) * window.innerHeight / 100}px`));
  }) as EventListener);
}
