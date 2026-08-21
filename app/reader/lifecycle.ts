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
  #opened = false;

  constructor(source: PlatformDocument, view: ReaderView) {
    this.source = source;
    this.view = view;
    this.signal = this.#abort.signal;
  }

  async open() {
    if (this.#disposed) throw new DOMException("Reader disposed", "AbortError");
    if (this.#opened) throw new Error("Reader already opened");
    this.#opened = true;
    const startedAt = performance.now();
    try {
      const book = await createBook(this.source.input);
      if (this.#disposed) {
        await book.destroy?.();
        throw new DOMException("Reader disposed", "AbortError");
      }
      this.book = book;
      const navigationStartedAt = performance.now();
      console.info("[EPUB.ts] Building publication navigation indexes.", {
        sections: book.sections.length,
        tocItems: book.toc?.length ?? 0,
      });
      this.navigation = await Navigation.create(book);
      console.info("[EPUB.ts] Publication navigation indexes built.", {
        durationMs: Math.round(performance.now() - navigationStartedAt),
      });
      this.#throwIfDisposed();
      const rendererStartedAt = performance.now();
      console.info("[EPUB.ts] Initializing document renderer.", {
        layout: book.rendition?.layout ?? "reflowable",
      });
      await this.view.open(book, this.navigation);
      console.info("[EPUB.ts] Document renderer initialized.", {
        durationMs: Math.round(performance.now() - rendererStartedAt),
        renderMode: this.view.renderMode,
      });
      this.#throwIfDisposed();
      this.navigation.attach(this.view.renderer);
      console.info("[EPUB.ts] Reader core initialization completed.", {
        durationMs: Math.round(performance.now() - startedAt),
      });
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
