import type { Book, Content } from "../reader-view.js";
import type { RendererStyles } from "../renderer";
import { getDocumentBackground, SectionFrame, type SectionDirection, type SectionLayout } from "./section-frame";
import {
  SpineBuffer,
  type SpineBufferChange,
  type SpineBufferRequest,
  type SpineEntry,
  type SpineTrack,
} from "./spine-state";
import type { NavigationTransaction } from "./navigation";

type SpineOptions = {
  activeEntry: () => SpineEntry<SectionFrame> | undefined;
  backgroundElement: HTMLElement;
  beforeRenderDocument: (doc: Document, index: number) => Promise<void> | void;
  continuous: () => boolean;
  host: HTMLElement;
  layout: () => void;
  layoutFor: (direction: SectionDirection) => SectionLayout;
  layoutRevision?: () => number;
  canJoinWindow?: (current: SectionFrame, candidate: SectionFrame) => boolean;
  navigation: NavigationTransaction;
  onClear?: () => void;
  restoreViewport: (offset: number) => void;
  scheduleRender: () => void;
  trackElement: HTMLElement;
  track: SpineTrack<SectionFrame>;
  viewportOffset: () => number;
  viewport: () => Pick<SpineBufferRequest,
    "activeIndex" | "viewportEnd" | "viewportSize" | "viewportStart">;
};

/** Shared lifecycle and virtualization for reflowable spine renderers. */
export class ReflowableSpine {
  readonly track: SpineTrack<SectionFrame>;
  readonly #buffer: SpineBuffer<SectionFrame>;
  readonly #events = new AbortController();
  readonly #options: SpineOptions;
  readonly #styleMap = new WeakMap<Document, [HTMLStyleElement, HTMLStyleElement]>();
  readonly #mediaQuery = matchMedia("(prefers-color-scheme: dark)");
  #book?: Book;
  #cacheFrame?: number;
  #currentView?: SectionFrame;
  #loading = false;
  #openingEnd = 0;
  #styles?: RendererStyles;

  constructor(options: SpineOptions) {
    this.#options = options;
    this.track = options.track;
    this.#mediaQuery.addEventListener("change", () => this.#updateBackground(), {
      signal: this.#events.signal,
    });
    this.#buffer = new SpineBuffer({
      create: index => this.#create(index),
      destroy: (index, view) => {
        this.#destroy(view);
        this.#book?.sections[index]?.unload();
      },
      getExtent: view => view.extent,
    });
  }

  open(book: Book) {
    this.#book = book;
    const tocTargets = (book.toc ?? []).flatMap(({ href }) => {
      if (!href) return [];
      try {
        const index = book.resolveHref(href)?.index;
        return index !== undefined && Number.isInteger(index)
          && index > 0 && index < book.sections.length
          ? [index] : [];
      } catch {
        return [];
      }
    });
    this.#openingEnd = Math.min(...tocTargets, book.sections.length);
  }

  get entries() { return this.#buffer.entries; }
  get first() { return this.#buffer.first; }
  get last() { return this.#buffer.last; }
  get contentExtent() { return this.track.contentExtent; }
  get currentView() { return this.#currentView ?? null; }
  get physicalExtent() { return this.track.physicalExtent; }

  #find(index: number) { return this.#buffer.find(index); }
  findAt(offset: number) { return this.#buffer.findAt(offset); }
  contains(index: number) {
    return Number.isInteger(index) && index >= 0 && index < (this.#book?.sections.length ?? 0);
  }
  entryForView(view: SectionFrame | null | undefined = this.#currentView) {
    return this.entries.find(entry => entry.view === view);
  }
  showNavigationCue(target: Element | Range | undefined) {
    if (!target) return;
    const doc = "startContainer" in target
      ? target.startContainer.ownerDocument
      : target.ownerDocument;
    this.entries.find(({ view }) => view.document === doc)?.view.showNavigationCue(target);
  }
  adjacent(from: number, direction: -1 | 1) {
    const sections = this.#book?.sections;
    if (!sections) return;
    for (let index = from + direction;
      index >= 0 && index < sections.length;
      index += direction) {
      if (index < this.#openingEnd || sections[index]?.linear !== "no") return index;
    }
  }
  entryOffset(entry: SpineEntry<SectionFrame> | undefined) {
    return this.track.entryOffset(entry);
  }
  viewportRange(start: number, end: number) {
    return this.track.viewportRange(start, end);
  }

  layout() {
    return this.track.layout(this.entries);
  }

  commit(change: SpineBufferChange<SectionFrame>, activeEntry = this.#options.activeEntry()) {
    const oldOffset = activeEntry ? this.entryOffset(activeEntry) : 0;
    const viewportOffset = activeEntry ? this.#options.viewportOffset() : 0;
    const applied = this.#buffer.commit(change);
    if (!applied.added.length && !applied.removed.length) return applied;

    if (this.#options.continuous()) {
      this.track.updateForChange?.(applied, activeEntry?.index);
      this.#options.layout();
      if (activeEntry) {
        this.#options.restoreViewport(
          viewportOffset + this.entryOffset(activeEntry) - oldOffset,
        );
      }
    }
    for (const entry of applied.added) this.#initialize(entry);
    this.#buffer.dispose(applied.removed);
    return applied;
  }

  async prepare(index: number) {
    let entry = this.#find(index);
    if (!entry) {
      const adjacentToWindow = this.#options.continuous() && this.entries.some(candidate =>
        this.adjacent(candidate.index, -1) === index
        || this.adjacent(candidate.index, 1) === index);
      if (!adjacentToWindow) this.clear();
      const prepared = await this.#buffer.prepare(index);
      this.commit(this.#buffer.changeFor([prepared]));
      entry = this.#find(index);
    }
    if (!entry) throw new DOMException("Stale spine entry", "AbortError");
    return entry;
  }

  activate(entry: SpineEntry<SectionFrame>) {
    if (!this.entries.includes(entry)) throw new DOMException("Stale spine entry", "AbortError");
    this.#currentView = entry.view;
    this.#updateBackground();
  }

  removeOtherThanCurrent() {
    return this.#buffer.removeWhere(entry => entry.view !== this.#currentView);
  }

  scheduleCache() {
    if (!this.#options.continuous() || this.#cacheFrame !== undefined) return;
    this.#cacheFrame = requestAnimationFrame(() => {
      this.#cacheFrame = requestAnimationFrame(() => {
        this.#cacheFrame = undefined;
        void this.#cacheAdjacent().catch(error => {
          if (error?.name !== "AbortError") {
            console.warn("Failed to cache adjacent reader sections.", error);
          }
        });
      });
    });
  }

  async #cacheAdjacent() {
    if (!this.#options.continuous()) return;
    if (this.#loading) {
      this.scheduleCache();
      return;
    }
    const revision = this.#options.layoutRevision;
    const layoutRevision = revision?.();
    this.#loading = true;
    try {
      const viewport = this.#options.viewport();
      let change = await this.#buffer.reconcile({
        ...viewport,
        adjacent: (index, direction) => this.adjacent(index, direction),
      });
      const current = this.#currentView;
      const canJoin = this.#options.canJoinWindow;
      if (current && canJoin) {
        const accepted: SpineEntry<SectionFrame>[] = [];
        const acceptUntilMismatch = (entries: readonly SpineEntry<SectionFrame>[]) => {
          for (const entry of entries) {
            if (!canJoin(current, entry.view)) break;
            accepted.push(entry);
          }
        }
        acceptUntilMismatch(change.added
          .filter(entry => entry.index < viewport.activeIndex)
          .sort((a, b) => b.index - a.index));
        acceptUntilMismatch(change.added
          .filter(entry => entry.index > viewport.activeIndex)
          .sort((a, b) => a.index - b.index));
        if (accepted.length !== change.added.length) {
          change = {
            ...change,
            added: accepted.sort((a, b) => a.index - b.index),
            needsMore: false,
          };
        }
      }
      if (revision && layoutRevision !== revision()) {
        this.scheduleCache();
        return;
      }
      const committed = await this.#options.navigation.run(() => {
        if (revision && layoutRevision !== revision()) return false;
        this.commit(change);
        return true;
      });
      if (!committed || change.needsMore) this.scheduleCache();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") this.scheduleCache();
      else throw error;
    } finally {
      this.#loading = false;
    }
  }

  setStyles(styles: RendererStyles) {
    this.#styles = styles;
    const docs = this.entries
      .map(({ view }) => view.document)
      .filter(doc => this.#applyStyles(doc, styles));
    if (!docs.length) return docs;
    requestAnimationFrame(() => this.#updateBackground());
    Promise.all(docs.map(doc => doc.fonts.ready)).then(this.#options.scheduleRender);
    return docs;
  }

  getContents(): Content[] {
    return this.entries.map(({ index, view }) => ({
      index,
      overlay: view.overlay,
      doc: view.document,
    }));
  }

  clear() {
    if (this.#cacheFrame !== undefined) cancelAnimationFrame(this.#cacheFrame);
    this.#cacheFrame = undefined;
    this.#buffer.clear();
    this.track.reset();
    this.#options.onClear?.();
  }

  destroy() {
    this.clear();
    this.#events.abort();
    this.#book = undefined;
    this.#openingEnd = 0;
  }

  async #create(index: number) {
    const section = this.#book?.sections[index];
    if (!section) throw new RangeError(`Missing spine section ${index}`);
    let view!: SectionFrame;
    view = new SectionFrame({
      onExpand: () => {
        if (this.entries.some(entry => entry.view === view)) this.#options.scheduleRender();
      },
    });
    this.#options.trackElement.append(view.element);
    try {
      const source = await section.load();
      if (!source) throw new Error(`Failed to load spine section ${index}`);
      await view.load(source, async doc => {
        if (doc.head) {
          const beforeStyle = doc.createElement("style");
          doc.head.prepend(beforeStyle);
          const style = doc.createElement("style");
          style.dataset.readerBookStyles = "";
          doc.head.append(style);
          this.#styleMap.set(doc, [beforeStyle, style]);
          this.#applyStyles(doc, this.#styles);
        }
        await this.#options.beforeRenderDocument(doc, index);
      }, this.#options.layoutFor);
    } catch (error) {
      this.#destroy(view);
      section.unload();
      throw error;
    }
    return view;
  }

  #initialize({ index, view }: SpineEntry<SectionFrame>) {
    if (!this.#options.continuous()) view.element.style.position = "relative";
    view.element.style.removeProperty("visibility");
    this.#options.host.dispatchEvent(new CustomEvent("load", {
      detail: { doc: view.document, index },
    }));
    this.#options.host.dispatchEvent(new CustomEvent("request-overlay", {
      detail: {
        doc: view.document,
        index,
        attach: (overlay: SectionFrame["overlay"]) => view.overlay = overlay,
      },
    }));
  }

  #destroy(view: SectionFrame) {
    let doc: Document | undefined;
    try { doc = view.document; } catch { /* The iframe may not have loaded. */ }
    if (doc) this.#options.host.dispatchEvent(new CustomEvent("unload", { detail: { doc } }));
    if (this.#currentView === view) this.#currentView = undefined;
    view.destroy();
    view.element.remove();
  }

  #applyStyles(doc: Document, styles?: RendererStyles) {
    const targets = this.#styleMap.get(doc);
    if (!targets || styles == null) return false;
    const [beforeStyle, style] = targets;
    const [before, main] = styles;
    if (beforeStyle.textContent !== before) beforeStyle.textContent = before;
    if (style.textContent !== main) style.textContent = main;
    return true;
  }

  #updateBackground() {
    const view = this.#currentView;
    if (view) this.#options.backgroundElement.style.background = getDocumentBackground(view.document);
  }
}
