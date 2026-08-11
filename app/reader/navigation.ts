import * as CFI from "../epub/cfi.js";
import { SectionIndex, TocIndex } from "./progress";
import type { SectionLocation, TocItem } from "./progress";

export type Target = string | number | { fraction: number };
export type Anchor = number | ((doc: Document) => Node | Range | number | null);
export type Resolved = { anchor?: Anchor; index: number; select?: boolean };

export type BookSection = {
  cfi?: string;
  createDocument?: () => Promise<Document>;
  id?: number | string;
  linear?: string;
  size?: number;
};

export type Book = {
  dir?: string;
  getTOCFragment?: (doc: Document, id?: string) => Element | null;
  landmarks?: Array<{ href?: string; type: string[] }>;
  pageList?: TocItem[];
  resolveCFI?: (cfi: string) => Resolved;
  resolveHref?: (href: string) => Resolved | null;
  sections: BookSection[];
  splitTOCHref?: (href?: string) => [unknown, string?] | Promise<[unknown, string?]>;
  toc?: TocItem[];
};

export type Renderer = {
  getContents?: () => Array<{ doc?: Document }>;
  goTo: (target: Resolved) => Promise<unknown>;
  next: (distance?: number) => Promise<unknown>;
  prev: (distance?: number) => Promise<unknown>;
};

export type RawLocation = {
  fraction?: number;
  index: number;
  range?: Range;
  reason?: string;
  size?: number;
};

export type Location = Partial<SectionLocation> & RawLocation & {
  cfi: string;
  pageItem?: TocItem | null;
  tocItem?: TocItem | null;
};

class History extends EventTarget {
  #entries: Target[] = [];
  #index = -1;

  get canGoBack() {
    return this.#index > 0;
  }

  get canGoForward() {
    return this.#index < this.#entries.length - 1;
  }

  push(state: Target) {
    const last = this.#entries[this.#index];
    if (last === state
      || (typeof last === "object" && typeof state === "object" && last.fraction === state.fraction)) return;
    this.#entries[++this.#index] = state;
    this.#entries.length = this.#index + 1;
    this.dispatchEvent(new Event("change"));
  }

  replace(state: Target) {
    if (this.#index >= 0) this.#entries[this.#index] = state;
  }

  back() {
    if (!this.canGoBack) return;
    this.#index -= 1;
    this.#pop();
  }

  forward() {
    if (!this.canGoForward) return;
    this.#index += 1;
    this.#pop();
  }

  clear() {
    this.#entries = [];
    this.#index = -1;
  }

  #pop() {
    this.dispatchEvent(new CustomEvent("pop", { detail: this.#entries[this.#index] }));
    this.dispatchEvent(new Event("change"));
  }
}

/** Single owner for reader navigation, CFI conversion, and book progress. */
export class Navigation {
  readonly history = new History();
  readonly book: Book;
  readonly #sections: SectionIndex;
  #pages?: TocIndex;
  #renderer?: Renderer;
  #toc?: TocIndex;

  private constructor(book: Book) {
    this.book = book;
    this.#sections = new SectionIndex(book.sections, 1_500, 1_600);
    this.history.addEventListener("pop", (event) => {
      const target = (event as CustomEvent<Target>).detail;
      const resolved = this.resolve(target);
      if (resolved && this.#renderer) void this.#renderer.goTo(resolved);
    });
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

  detach() {
    this.#renderer = undefined;
  }

  close() {
    this.detach();
    this.history.clear();
  }

  cfi(index: number, range?: Range) {
    const base = this.book.sections[index]?.cfi ?? CFI.fake.fromIndex(index);
    return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base;
  }

  resolve(target: Target): Resolved | undefined {
    try {
      if (typeof target === "number") return { index: target };
      if (typeof target === "object") {
        const [index, anchor] = this.#sections.at(target.fraction);
        return { anchor, index };
      }
      if (CFI.isCFI.test(target)) return this.#resolveCfi(target);
      return this.book.resolveHref?.(target) ?? undefined;
    } catch (error) {
      console.error(`Could not resolve target ${String(target)}`, error);
      return undefined;
    }
  }

  #resolveCfi(cfi: string): Resolved {
    if (this.book.resolveCFI) return this.book.resolveCFI(cfi);
    const parts = CFI.parse(cfi);
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
    return { index, anchor: (doc) => CFI.toRange(doc, parts) };
  }

  async go(target: Target) {
    const resolved = this.resolve(target);
    if (!resolved) throw new Error(`Could not resolve target ${String(target)}`);
    await this.#getRenderer().goTo(resolved);
    this.history.push(target);
    return resolved;
  }

  async select(target: Target) {
    const resolved = this.resolve(target);
    if (!resolved) throw new Error(`Could not resolve target ${String(target)}`);
    await this.#getRenderer().goTo({ ...resolved, select: true });
    this.history.push(target);
    return resolved;
  }

  async init({ lastLocation, showTextStart }: { lastLocation?: Target; showTextStart?: boolean }) {
    const resolved = lastLocation !== undefined ? this.resolve(lastLocation) : undefined;
    if (lastLocation !== undefined && !resolved) {
      throw new Error(`Could not resolve initial location ${String(lastLocation)}`);
    }
    if (resolved) {
      await this.#getRenderer().goTo(resolved);
      this.history.push(lastLocation!);
    } else if (showTextStart) {
      await this.start();
    } else {
      this.history.push(0);
      await this.next();
    }
  }

  start() {
    const landmark = this.book.landmarks
      ?.find(({ type }) => type.includes("bodymatter") || type.includes("text"))
      ?.href;
    const target = landmark ?? this.book.sections.findIndex((section) => section.linear !== "no");
    return this.go(target);
  }

  prev(distance?: number) {
    return this.#getRenderer().prev(distance);
  }

  next(distance?: number) {
    return this.#getRenderer().next(distance);
  }

  left() {
    return this.book.dir === "rtl" ? this.next() : this.prev();
  }

  right() {
    return this.book.dir === "rtl" ? this.prev() : this.next();
  }

  clearSelection() {
    for (const { doc } of this.#renderer?.getContents?.() ?? []) {
      doc?.defaultView?.getSelection()?.removeAllRanges();
    }
  }

  location(raw: RawLocation): Location {
    const { fraction, index, range, reason, size } = raw;
    const progress = this.#sections.get(index, fraction, size);
    const cfi = this.cfi(index, range);
    if (reason === "snap" || reason === "page" || reason === "scroll") {
      this.history.replace(cfi);
    }
    return {
      ...raw,
      ...progress,
      cfi,
      pageItem: this.#pages?.get(index, range),
      tocItem: this.#toc?.get(index, range),
    };
  }

  fractions() {
    return this.#sections.fractions.map((fraction) => fraction + Number.EPSILON);
  }

  progress(index: number, range?: Range) {
    return {
      pageItem: this.#pages?.get(index, range),
      tocItem: this.#toc?.get(index, range),
    };
  }

  label(index: number) {
    return this.#toc?.get(index)?.label ?? "";
  }

  async tocItem(target: Target) {
    const resolved = this.resolve(target);
    const section = resolved && this.book.sections[resolved.index];
    if (!resolved || !section?.createDocument) return undefined;
    const doc = await section.createDocument();
    const fragment = typeof resolved.anchor === "function" ? resolved.anchor(doc) : null;
    const isRange = fragment && typeof fragment !== "number" && "startContainer" in fragment;
    const range = isRange ? fragment as Range : doc.createRange();
    if (fragment && typeof fragment !== "number" && !isRange) range.selectNodeContents(fragment);
    return this.#toc?.get(resolved.index, range);
  }

  #getRenderer() {
    if (!this.#renderer) throw new Error("Navigation is not attached to a renderer");
    return this.#renderer;
  }
}
