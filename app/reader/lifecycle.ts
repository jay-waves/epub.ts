import type { Book } from "../renderer";
import type { ReaderView } from "./model";
import { createBook } from "../epub/book";
import type { PlatformDocument } from "../platform/types";
import { Navigation } from "./navigation";

/** All resources that belong to one document, in their ownership order. */
export class Reader {
  readonly signal: AbortSignal;
  readonly view: ReaderView;
  readonly source: PlatformDocument;
  book!: Book;
  navigation!: Navigation;

  readonly #abort = new AbortController();
  #disposed = false;

  private constructor(source: PlatformDocument, view: ReaderView) {
    this.source = source;
    this.view = view;
    this.signal = this.#abort.signal;
  }

  static async open(
    source: PlatformDocument,
    view: ReaderView,
    setup?: (reader: Reader) => void,
  ) {
    const reader = new Reader(source, view);
    try {
      setup?.(reader);
      const book = await createBook(source.input);
      if (reader.#disposed) {
        await book.destroy?.();
        throw new DOMException("Reader disposed", "AbortError");
      }
      reader.book = book;
      reader.navigation = await Navigation.create(reader.book);
      reader.#throwIfDisposed();
      await view.open(reader.book, reader.navigation);
      reader.#throwIfDisposed();
      reader.navigation.attach(view.renderer);
      return reader;
    } catch (error) {
      await reader.dispose();
      throw error;
    }
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    this.navigation?.close();
    try {
      this.view.destroy();
    } finally {
      try {
        await this.book?.destroy?.();
      } finally {
        this.source.release?.();
      }
    }
  }

  #throwIfDisposed() {
    if (this.#disposed) throw new DOMException("Reader disposed", "AbortError");
  }
}
