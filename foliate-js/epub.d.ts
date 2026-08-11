import type { FoliateBook } from "./view.js";

export class EPUB {
  constructor(source: unknown);
  init(): Promise<FoliateBook>;
}
