import * as CFI from "../epub/cfi.js";
import type { Book, RawRelocateDetail, Renderer, Resolved, TocItem } from "../renderer/reader-view.js";
import { SectionIndex, TocIndex } from "./location";
import type { SectionLocation } from "./location";

type Target = string | number | Resolved;

type GoOptions = {
  select?: boolean;
};

const cfiFilter = (node: Node) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
  const element = node as Element;
  return element.parentElement?.closest("pre")
    ? NodeFilter.FILTER_SKIP
    : NodeFilter.FILTER_ACCEPT;
};

export type Location = SectionLocation & Omit<RawRelocateDetail, "fraction" | "size"> & {
  cfi: string;
  pageItem?: TocItem | null;
  tocItem?: TocItem | null;
};

/** Single owner for reader navigation, CFI conversion, and book progress. */
export class Navigation {
  readonly book: Book;
  readonly #sections: SectionIndex;
  #pages?: TocIndex;
  #renderer?: Renderer;
  #toc?: TocIndex;

  private constructor(book: Book) {
    this.book = book;
    this.#sections = new SectionIndex(book.sections, 1_500, 1_600);
  }

  static async create(book: Book) {
    const navigation = new Navigation(book);
    await navigation.#indexToc();
    return navigation;
  }

  async #indexToc() {
    const { getTOCFragment, splitTOCHref } = this.book;
    if (!getTOCFragment || !splitTOCHref) return;
    const ids = this.book.sections.map((section) => section.id);
    const init = (toc: TocItem[]) => {
      const index = new TocIndex();
      return index.init({
        toc,
        ids,
        splitHref: splitTOCHref.bind(this.book),
        getFragment: getTOCFragment.bind(this.book),
      }).then(() => index);
    };
    [this.#toc, this.#pages] = await Promise.all([
      init(this.book.toc ?? []),
      init(this.book.pageList ?? []),
    ]);
  }

  attach(renderer: Renderer) {
    this.#renderer = renderer;
  }

  close() {
    this.#renderer = undefined;
  }

  cfi(index: number, range?: Range) {
    const base = this.book.sections[index]?.cfi ?? CFI.fake.fromIndex(index);
    return range ? CFI.joinIndir(base, CFI.fromRange(range, cfiFilter)) : base;
  }

  resolve(target: Target): Resolved | undefined {
    try {
      let resolved: Resolved | undefined;
      if (typeof target === "number") resolved = { index: target };
      if (typeof target === "object") resolved = target;
      else if (typeof target === "string") {
        resolved = CFI.isCFI.test(target)
          ? this.#resolveCfi(target)
          : this.book.resolveHref?.(target) ?? undefined;
      }
      return resolved
        && Number.isInteger(resolved.index)
        && resolved.index >= 0
        && resolved.index < this.book.sections.length
        ? resolved
        : undefined;
    } catch (error) {
      console.error(`Could not resolve target ${String(target)}`, error);
      return undefined;
    }
  }

  #resolveCfi(cfi: string): Resolved {
    if (this.book.resolveCFI) return this.book.resolveCFI(cfi, cfiFilter);
    const parts = CFI.parse(cfi);
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
    return { index, anchor: (doc) => CFI.toRange(doc, parts, cfiFilter) };
  }

  async go(target: Target, options: GoOptions = {}) {
    const resolved = this.resolve(target);
    if (!resolved) throw new Error(`Could not resolve target ${String(target)}`);
    await this.#getRenderer().goTo(options.select ? { ...resolved, select: true } : resolved);
    return resolved;
  }

  async goToProgress(fraction: number) {
    if (!Number.isFinite(fraction)) throw new Error(`Invalid reading progress ${String(fraction)}`);
    const [index, anchor] = this.#sections.at(Math.max(0, Math.min(1, fraction)));
    const resolved = { anchor, index };
    await this.#getRenderer().goTo(resolved);
    return resolved;
  }

  async init({
    lastLocation,
    progress,
    showTextStart,
  }: {
    lastLocation?: Target;
    progress?: number;
    showTextStart?: boolean;
  }) {
    const resolved = lastLocation !== undefined ? this.resolve(lastLocation) : undefined;
    if (lastLocation !== undefined && !resolved) {
      throw new Error(`Could not resolve initial location ${String(lastLocation)}`);
    }
    if (resolved) {
      await this.go(lastLocation!);
    } else if (progress !== undefined) {
      await this.goToProgress(progress);
    } else if (showTextStart) {
      await this.start();
    } else {
      await this.next();
    }
  }

  start() {
    const landmark = this.book.landmarks
      ?.find(({ type }) => type.includes("bodymatter") || type.includes("text"))
      ?.href;
    const firstLinear = this.book.sections.findIndex((section) => section.linear !== "no");
    const target = landmark && this.resolve(landmark) ? landmark : Math.max(0, firstLinear);
    return this.go(target);
  }

  prev(distance?: number) {
    return this.#getRenderer().prev(distance);
  }

  next(distance?: number) {
    return this.#getRenderer().next(distance);
  }

  prevPage() {
    const renderer = this.#getRenderer();
    return renderer.prevPage?.() ?? renderer.prev();
  }

  nextPage() {
    const renderer = this.#getRenderer();
    return renderer.nextPage?.() ?? renderer.next();
  }

  scrollBy(distance: number) {
    this.#getRenderer().panBy?.(distance, distance);
  }

  scrollTo(anchor: number) {
    return this.#getRenderer().scrollToAnchor?.(anchor);
  }

  clearSelection() {
    for (const { doc } of this.#renderer?.getContents?.() ?? []) {
      doc?.defaultView?.getSelection()?.removeAllRanges();
    }
  }

  location(raw: RawRelocateDetail): Location {
    const {
      fraction: sectionFraction,
      index,
      size: viewportFraction,
      ...relocation
    } = raw;
    const progress = this.#sections.get(index, sectionFraction, viewportFraction);
    const { range } = relocation;
    const cfi = this.cfi(index, range);
    return {
      ...relocation,
      index,
      ...progress,
      cfi,
      pageItem: this.#pages?.get(index, range),
      tocItem: this.#toc?.get(index, range),
    };
  }

  fractions() {
    return this.#sections.fractions.map((fraction) => fraction + Number.EPSILON);
  }

  label(index: number) {
    return this.#toc?.get(index)?.label ?? "";
  }

  #getRenderer() {
    if (!this.#renderer) throw new Error("Navigation is not attached to a renderer");
    return this.#renderer;
  }
}
