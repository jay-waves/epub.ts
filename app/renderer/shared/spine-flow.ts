import type { Book } from "../reader-view.js";

/** Logical reading order shared by reflowable renderers. */
export class SpineFlow {
  readonly #breaks = new Set<number>();
  readonly #openingEnd: number;
  readonly #sections: Book["sections"];

  constructor(book: Book) {
    this.#sections = book.sections;
    for (const item of book.toc ?? []) {
      if (!item.href) continue;
      try {
        const index = book.resolveHref?.(item.href)?.index;
        if (Number.isInteger(index) && index! > 0 && index! < this.#sections.length) {
          this.#breaks.add(index!);
        }
      } catch {
        // A malformed navigation target must not break the reading flow.
      }
    }
    this.#openingEnd = Math.min(...this.#breaks, this.#sections.length);
  }

  breakBefore(index: number) {
    return this.#breaks.has(index);
  }

  adjacent(from: number, direction: -1 | 1) {
    for (let index = from + direction;
      index >= 0 && index < this.#sections.length;
      index += direction) {
      if (index < this.#openingEnd || this.#sections[index]?.linear !== "no") return index;
    }
  }
}
