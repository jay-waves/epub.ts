import type { Book } from "../renderer/reader-view.js";

export class EPUB {
  constructor(source: unknown);
  init(): Promise<Book>;
}
