export type ChapterFlowEntry<View> = {
  index: number;
  view: View;
  start: number;
  extent: number;
};

export class ChapterFlow<View> {
  readonly #entries: ChapterFlowEntry<View>[] = [];

  get entries() {
    return this.#entries as readonly ChapterFlowEntry<View>[];
  }

  get first() {
    return this.#entries[0];
  }

  get last() {
    return this.#entries.at(-1);
  }

  get extent() {
    const last = this.last;
    return last ? last.start + last.extent : 0;
  }

  add(index: number, view: View) {
    const existing = this.find(index);
    if (existing) return existing;
    const entry = { index, view, start: 0, extent: 0 };
    const position = this.#entries.findIndex((candidate) => candidate.index > index);
    if (position < 0) this.#entries.push(entry);
    else this.#entries.splice(position, 0, entry);
    return entry;
  }

  clear() {
    return this.#entries.splice(0);
  }

  find(index: number) {
    return this.#entries.find((entry) => entry.index === index);
  }

  findAt(offset: number) {
    return this.#entries.find((entry) =>
      offset >= entry.start && offset < entry.start + entry.extent)
      ?? this.last;
  }

  removeWhere(predicate: (entry: ChapterFlowEntry<View>) => boolean) {
    const removed: ChapterFlowEntry<View>[] = [];
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (entry && predicate(entry)) removed.unshift(...this.#entries.splice(index, 1));
    }
    return removed;
  }

  layout(getExtent: (view: View) => number) {
    let start = 0;
    for (const entry of this.#entries) {
      entry.start = start;
      entry.extent = Math.max(1, getExtent(entry.view));
      start += entry.extent;
    }
    return start;
  }
}
