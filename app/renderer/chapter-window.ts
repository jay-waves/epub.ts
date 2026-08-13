export type ChapterEntry<View> = {
  index: number;
  view: View;
  start: number;
  extent: number;
};

type ChapterWindowOptions<View> = {
  create: (index: number) => Promise<View>;
  destroy: (index: number, view: View) => void;
  onAdd?: (entry: ChapterEntry<View>) => void;
};

/** Owns the loaded, ordered chapter window and its in-flight loads. */
export class ChapterWindow<View> {
  readonly #entries: ChapterEntry<View>[] = [];
  readonly #loads = new Map<number, Promise<ChapterEntry<View>>>();
  readonly #create: ChapterWindowOptions<View>["create"];
  readonly #destroy: ChapterWindowOptions<View>["destroy"];
  readonly #onAdd?: ChapterWindowOptions<View>["onAdd"];
  #generation = 0;

  constructor({ create, destroy, onAdd }: ChapterWindowOptions<View>) {
    this.#create = create;
    this.#destroy = destroy;
    this.#onAdd = onAdd;
  }

  get entries() {
    return this.#entries as readonly ChapterEntry<View>[];
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

  find(index: number) {
    return this.#entries.find((entry) => entry.index === index);
  }

  findAt(offset: number) {
    return this.#entries.find((entry) =>
      offset >= entry.start && offset < entry.start + entry.extent)
      ?? this.last;
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

  load(index: number) {
    const existing = this.find(index);
    if (existing) return Promise.resolve(existing);
    const pending = this.#loads.get(index);
    if (pending) return pending;

    const generation = this.#generation;
    const load = this.#create(index).then((view) => {
      if (generation !== this.#generation) {
        this.#destroy(index, view);
        throw new DOMException("Stale chapter load", "AbortError");
      }
      const entry = { index, view, start: 0, extent: 0 };
      const position = this.#entries.findIndex((candidate) => candidate.index > index);
      if (position < 0) this.#entries.push(entry);
      else this.#entries.splice(position, 0, entry);
      this.#onAdd?.(entry);
      return entry;
    }).finally(() => {
      if (this.#loads.get(index) === load) this.#loads.delete(index);
    });
    this.#loads.set(index, load);
    return load;
  }

  removeWhere(predicate: (entry: ChapterEntry<View>) => boolean) {
    const removed: ChapterEntry<View>[] = [];
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (entry && predicate(entry)) removed.unshift(...this.#entries.splice(index, 1));
    }
    for (const { index, view } of removed) this.#destroy(index, view);
    return removed;
  }

  clear() {
    this.#generation += 1;
    this.#loads.clear();
    const removed = this.#entries.splice(0);
    for (const { index, view } of removed) this.#destroy(index, view);
    return removed;
  }
}
