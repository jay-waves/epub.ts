import type { FoliateBook, FoliateViewElement } from "../foliate";
import { createBook } from "../epub/book";
import type { PlatformDocument } from "../platform/types";
import { Navigation } from "./navigation";

/** All resources that belong to one document, in their ownership order. */
export class ReaderDocument {
  readonly signal: AbortSignal;
  readonly view: FoliateViewElement;
  readonly document: PlatformDocument;
  book!: FoliateBook;
  navigation!: Navigation;

  readonly #abort = new AbortController();
  #disposed = false;

  private constructor(document: PlatformDocument, view: FoliateViewElement) {
    this.document = document;
    this.view = view;
    this.signal = this.#abort.signal;
  }

  static async open(
    document: PlatformDocument,
    view: FoliateViewElement,
    setup?: (reader: ReaderDocument) => void,
  ) {
    const reader = new ReaderDocument(document, view);
    try {
      setup?.(reader);
      const book = await createBook(document.input);
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
    this.view.destroy();
    await this.book?.destroy?.();
    this.document.release?.();
  }

  #throwIfDisposed() {
    if (this.#disposed) throw new DOMException("Reader disposed", "AbortError");
  }
}
