import type { Book } from "../renderer/view.js";

export class EPUB {
  constructor(source: unknown);
  init(): Promise<Book>;
}
