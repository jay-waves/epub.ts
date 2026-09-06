/** A mode-neutral window over loaded spine entries. */
export type SpineEntry<View> = {
  index: number;
  view: View;
  start: number;
  extent: number;
};

export type SpineBufferChange<View> = {
  revision: number;
  added: readonly SpineEntry<View>[];
  removed: readonly SpineEntry<View>[];
  needsMore: boolean;
};

type SpineBufferOptions<View> = {
  create: (index: number) => Promise<View>;
  destroy: (index: number, view: View) => void;
  getExtent: (view: View) => number;
};

export type SpineBufferRequest = {
  activeIndex: number;
  adjacent: (index: number, direction: -1 | 1) => number | undefined;
  maxLoadsPerDirection?: number;
  preloadViewports?: number;
  retainViewports?: number;
  viewportEnd: number;
  viewportSize: number;
  viewportStart: number;
};

const DEFAULT_MAX_LOADS = 16;
const DEFAULT_PRELOAD_VIEWPORTS = 2;
const DEFAULT_RETAIN_VIEWPORTS = 3;

const abortError = (message: string) => new DOMException(message, "AbortError");

/**
 * Owns the staged and committed render buffer around the EPUB spine.
 *
 * Loading never mutates the committed window. Callers apply one revisioned
 * change at a navigation-safe point, then dispose its removed entries after
 * preserving the viewport anchor.
 */
export class SpineBuffer<View> {
  readonly #entries: SpineEntry<View>[] = [];
  readonly #staged = new Map<number, SpineEntry<View>>();
  readonly #loads = new Map<number, Promise<SpineEntry<View>>>();
  readonly #create: SpineBufferOptions<View>["create"];
  readonly #destroy: SpineBufferOptions<View>["destroy"];
  readonly #getExtent: SpineBufferOptions<View>["getExtent"];
  #generation = 0;
  #revision = 0;

  constructor({ create, destroy, getExtent }: SpineBufferOptions<View>) {
    this.#create = create;
    this.#destroy = destroy;
    this.#getExtent = getExtent;
  }

  get entries(): readonly SpineEntry<View>[] {
    return this.#entries;
  }

  get first() {
    return this.#entries[0];
  }

  get last() {
    return this.#entries.at(-1);
  }

  find(index: number) {
    return this.#entries.find((entry) => entry.index === index);
  }

  findAt(offset: number) {
    return this.#entries.find((entry) =>
      offset >= entry.start && offset < entry.start + entry.extent)
      ?? this.last;
  }

  prepare(index: number) {
    const existing = this.find(index) ?? this.#staged.get(index);
    if (existing) return Promise.resolve(existing);
    const pending = this.#loads.get(index);
    if (pending) return pending;

    const generation = this.#generation;
    const load = this.#create(index).then((view) => {
      if (generation !== this.#generation) {
        this.#destroy(index, view);
        throw abortError("Stale spine load");
      }
      const entry = {
        index,
        view,
        start: 0,
        extent: Math.max(1, this.#getExtent(view)),
      };
      this.#staged.set(index, entry);
      return entry;
    }).finally(() => {
      if (this.#loads.get(index) === load) this.#loads.delete(index);
    });
    this.#loads.set(index, load);
    return load;
  }

  changeFor(added: readonly SpineEntry<View>[]): SpineBufferChange<View> {
    return { revision: this.#revision, added, removed: [], needsMore: false };
  }

  async reconcile({
    activeIndex,
    adjacent,
    maxLoadsPerDirection = DEFAULT_MAX_LOADS,
    preloadViewports = DEFAULT_PRELOAD_VIEWPORTS,
    retainViewports = DEFAULT_RETAIN_VIEWPORTS,
    viewportEnd,
    viewportSize,
    viewportStart,
  }: SpineBufferRequest): Promise<SpineBufferChange<View>> {
    const revision = this.#revision;
    const first = this.first;
    const last = this.last;
    if (!first || !last || !(viewportSize > 0)) {
      return { revision, added: [], removed: [], needsMore: false };
    }

    const prepend: SpineEntry<View>[] = [];
    const append: SpineEntry<View>[] = [];
    const preloadDistance = viewportSize * preloadViewports;

    const fill = async (direction: -1 | 1) => {
      const added = direction < 0 ? prepend : append;
      let boundaryIndex = direction < 0 ? first.index : last.index;
      let buffered = direction < 0
        ? viewportStart - first.start
        : last.start + last.extent - viewportEnd;

      for (let count = 0; count < maxLoadsPerDirection; count += 1) {
        if (buffered >= preloadDistance) return false;
        const index = adjacent(boundaryIndex, direction);
        if (index === undefined) return false;
        const entry = await this.prepare(index);
        if (this.#revision !== revision) throw abortError("Stale spine reconcile");
        if (!this.find(index) && !added.includes(entry)) added.push(entry);
        boundaryIndex = index;
        buffered += entry.extent;
      }
      return buffered < preloadDistance;
    };

    const needsMore = (await Promise.all([fill(-1), fill(1)])).some(Boolean);
    if (this.#revision !== revision) throw abortError("Stale spine reconcile");
    const added = [...prepend, ...append].sort((a, b) => a.index - b.index);
    const prependedExtent = prepend.reduce((sum, entry) => sum + entry.extent, 0);
    const plannedViewportStart = viewportStart + prependedExtent;
    const plannedViewportEnd = viewportEnd + prependedExtent;
    const retainDistance = viewportSize * Math.max(retainViewports, preloadViewports);
    const keepStart = Math.max(0, plannedViewportStart - retainDistance);
    const keepEnd = plannedViewportEnd + retainDistance;

    let start = 0;
    const planned = [...this.#entries, ...added].sort((a, b) => a.index - b.index)
      .map((entry) => {
        const positioned = { entry, start, end: start + entry.extent };
        start = positioned.end;
        return positioned;
      });
    const removed = planned
      .filter(({ entry, start: entryStart, end }) => this.#entries.includes(entry)
        && entry.index !== activeIndex
        && (end < keepStart || entryStart > keepEnd))
      .map(({ entry }) => entry);

    return { revision, added, removed, needsMore };
  }

  commit(change: SpineBufferChange<View>) {
    if (change.revision !== this.#revision) throw abortError("Stale spine commit");
    const removedSet = new Set(change.removed);
    const removed = this.#entries.filter((entry) => removedSet.has(entry));
    const added: SpineEntry<View>[] = [];
    for (const entry of change.added) {
      if (this.find(entry.index)) continue;
      const staged = this.#staged.get(entry.index);
      if (staged !== entry) throw abortError("Stale staged spine entry");
      added.push(entry);
    }

    // Validate the complete change before mutating either collection so a
    // stale staged entry cannot leave a partially committed window.
    if (removed.length) {
      const retained = this.#entries.filter((entry) => !removedSet.has(entry));
      this.#entries.splice(0, this.#entries.length, ...retained);
    }
    for (const entry of added) {
      this.#staged.delete(entry.index);
      this.#entries.push(entry);
    }
    if (added.length) this.#entries.sort((a, b) => a.index - b.index);
    if (added.length || removed.length) this.#revision += 1;
    return { added, removed };
  }

  dispose(entries: readonly SpineEntry<View>[]) {
    for (const { index, view } of entries) this.#destroy(index, view);
  }

  removeWhere(predicate: (entry: SpineEntry<View>) => boolean) {
    const removed = this.#entries.filter(predicate);
    if (!removed.length) return removed;
    const applied = this.commit({
      revision: this.#revision,
      added: [],
      removed,
      needsMore: false,
    });
    this.dispose(applied.removed);
    return applied.removed;
  }

  clear() {
    this.#generation += 1;
    this.#revision += 1;
    this.#loads.clear();
    const removed = this.#entries.splice(0);
    const staged = [...this.#staged.values()];
    this.#staged.clear();
    this.dispose([...removed, ...staged]);
    return removed;
  }
}

export type SpineTrackView = {
  extent: number;
};

export type AppliedSpineChange<View> = {
  added: readonly SpineEntry<View>[];
  removed: readonly SpineEntry<View>[];
};

type TrackPlacement<View> = {
  entry: SpineEntry<View>;
  physicalStart: number;
};

export type SpineTrackLayout<View> = {
  placements: readonly TrackPlacement<View>[];
};

/** Owns logical spine positions and their projection onto the scroll track. */
export interface SpineTrack<View extends SpineTrackView> {
  readonly contentExtent: number;
  readonly physicalExtent: number;
  entryOffset(entry: SpineEntry<View> | undefined): number;
  layout(entries: readonly SpineEntry<View>[]): SpineTrackLayout<View>;
  reset(): void;
  updateForChange?(change: AppliedSpineChange<View>, activeIndex: number | undefined): void;
  viewportRange(start: number, end: number): {
    start: number;
    end: number;
  };
}
