import type { Book } from "../renderer";
import type { ReaderView } from "./model";
import { createBook } from "../epub/book";
import type { PlatformDocument } from "../platform/types";
import { Navigation } from "./navigation";
import { installTypographyNormalization } from "../typography";

/** All resources that belong to one document, in their ownership order. */
export class Reader {
  readonly signal: AbortSignal;
  readonly view: ReaderView;
  readonly source: PlatformDocument;
  book!: Book;
  navigation!: Navigation;

  readonly #abort = new AbortController();
  #disposed = false;
  #opened = false;

  constructor(source: PlatformDocument, view: ReaderView) {
    this.source = source;
    this.view = view;
    this.signal = this.#abort.signal;
  }

  async open(fontsReady: Promise<void>) {
    if (this.#disposed) throw new DOMException("Reader disposed", "AbortError");
    if (this.#opened) throw new Error("Reader already opened");
    this.#opened = true;
    try {
      const book = await createBook(this.source.input);
      if (this.#disposed) {
        await book.destroy?.();
        throw new DOMException("Reader disposed", "AbortError");
      }
      this.book = book;
      installTypographyNormalization(book);
      this.navigation = await Navigation.create(book);
      this.#throwIfDisposed();
      await fontsReady;
      this.#throwIfDisposed();
      await this.view.open(book, this.navigation);
      this.#throwIfDisposed();
      this.navigation.attach(this.view.renderer);
    } catch (error) {
      await this.dispose();
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
