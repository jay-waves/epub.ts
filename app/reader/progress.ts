export type TocItem = {
  href?: string;
  label?: string;
  subitems?: TocItem[];
};

export type Section = {
  linear?: string;
  size?: number;
};

type TocNode = TocItem & { id?: number };
type SplitHref = (href?: string) => [unknown, string?] | Promise<[unknown, string?]>;
type GetFragment = (doc: Document, id?: string) => Element | null;

export type SectionLocation = {
  fraction: number;
  location: { current: number; next: number; total: number };
  section: { current: number; total: number };
  time: { section: number; total: number };
};

function flatten(items: TocNode[]): TocNode[] {
  return items.flatMap((item) => item.subitems?.length
    ? [item, ...flatten(item.subitems)]
    : item);
}

/** Resolves the nearest TOC or page-list item for a rendered range. */
export class TocIndex {
  #ids?: unknown[];
  #map = new Map<unknown, { items?: Array<{ fragment?: string; item: TocNode }>; prev?: TocNode }>();
  #getFragment?: GetFragment;

  async init({
    toc,
    ids,
    splitHref,
    getFragment,
  }: {
    toc: TocNode[];
    ids: unknown[];
    splitHref: SplitHref;
    getFragment: GetFragment;
  }) {
    let nextId = 0;
    const assignId = (item: TocNode) => {
      item.id = nextId++;
      item.subitems?.forEach(assignId);
    };
    toc.forEach(assignId);

    const items = flatten(toc);
    const grouped = new Map<unknown, { items: Array<{ fragment?: string; item: TocNode }>; prev?: TocNode }>();
    for (const [index, item] of items.entries()) {
      const [id, fragment] = await splitHref(item.href) ?? [];
      const value = { fragment, item };
      const group = grouped.get(id);
      if (group) group.items.push(value);
      else grouped.set(id, { prev: items[index - 1], items: [value] });
    }

    const map = new Map<unknown, { items?: Array<{ fragment?: string; item: TocNode }>; prev?: TocNode }>();
    for (const [index, id] of ids.entries()) {
      map.set(id, grouped.get(id) ?? map.get(ids[index - 1]) ?? {});
    }
    this.#ids = ids;
    this.#map = map;
    this.#getFragment = getFragment;
  }

  get(index: number, range?: Range): TocItem | null | undefined {
    const id = this.#ids?.[index];
    if (!this.#ids || id === undefined) return undefined;
    const group = this.#map.get(id);
    if (!group) return null;
    const { prev, items } = group;
    if (!items) return prev;
    if (!range || (items.length === 1 && !items[0]?.fragment)) return items[0]?.item;

    const doc = range.startContainer.getRootNode() as Document;
    for (const [itemIndex, { fragment }] of items.entries()) {
      const element = this.#getFragment?.(doc, fragment);
      if (element && range.comparePoint(element, 0) > 0) {
        return items[itemIndex - 1]?.item ?? prev;
      }
    }
    return items.at(-1)?.item;
  }

}

/** Maps section-relative positions to whole-book progress and back. */
export class SectionIndex {
  readonly fractions: number[];
  readonly #sizes: number[];
  readonly #sizePerLocation: number;
  readonly #sizePerTime: number;
  readonly #total: number;

  constructor(sections: Section[], sizePerLocation: number, sizePerTime: number) {
    const measured = sections
      .filter((section) => section.linear !== "no")
      .map((section) => Number(section.size))
      .filter((size) => Number.isFinite(size) && size > 0);
    const estimate = measured.length
      ? measured.reduce((sum, size) => sum + size, 0) / measured.length
      : 1;
    const hasLinear = sections.some((section) => section.linear !== "no");

    this.#sizes = sections.map((section) => {
      if (hasLinear && section.linear === "no") return 0;
      const size = Number(section.size);
      return Number.isFinite(size) && size > 0 ? size : estimate;
    });
    this.#sizePerLocation = sizePerLocation;
    this.#sizePerTime = sizePerTime;
    this.#total = this.#sizes.reduce((sum, size) => sum + size, 0);
    this.fractions = this.#buildFractions();
  }

  #buildFractions() {
    const result = [0];
    let sum = 0;
    for (const size of this.#sizes) result.push((sum += size) / this.#total);
    return result;
  }

  get(index: number, sectionFraction?: number, pageFraction = 0): SectionLocation {
    const fraction = Number.isFinite(sectionFraction)
      ? Math.max(0, Math.min(1, sectionFraction!))
      : 0;
    const page = Number.isFinite(pageFraction) ? Math.max(0, pageFraction) : 0;
    const sectionSize = this.#sizes[index] ?? 0;
    const sizeBefore = this.#sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
    const size = sizeBefore + fraction * sectionSize;
    const nextSize = size + page * sectionSize;

    return {
      fraction: nextSize / this.#total,
      section: { current: index, total: this.#sizes.length },
      location: {
        current: Math.floor(size / this.#sizePerLocation),
        next: Math.floor(nextSize / this.#sizePerLocation),
        total: Math.ceil(this.#total / this.#sizePerLocation),
      },
      time: {
        section: ((1 - fraction) * sectionSize) / this.#sizePerTime,
        total: (this.#total - size) / this.#sizePerTime,
      },
    };
  }

  at(fraction: number): [number, number] {
    const first = this.#sizes.findIndex((size) => size > 0);
    let last = this.#sizes.length - 1;
    while (last >= 0 && !(this.#sizes[last]! > 0)) last -= 1;
    if (first < 0) return [0, 0];
    if (fraction <= 0) return [first, 0];
    if (fraction >= 1) return [last, 1];

    const target = fraction + Number.EPSILON;
    let index = this.fractions.findIndex((value) => value > target) - 1;
    if (index < 0) return [first, 0];
    while (!this.#sizes[index] && index < last) index += 1;
    const sectionFraction = (target - this.fractions[index]!)
      / ((this.#sizes[index] ?? 0) / this.#total);
    return [index, sectionFraction];
  }

}
