import { getBookStyles } from "./reader-settings";
import { runWhenIdle } from "./scheduler";
import type { FoliateBook } from "./viewer-types";

type CacheableSection = NonNullable<FoliateBook["sections"]>[number] & {
  createDocument?: () => Promise<Document>;
  load?: () => Promise<string | null>;
  unload?: () => void;
};

type CachedDocumentSnapshot = {
  document: Document;
  id: string;
  index: number;
  preparedAt: number;
  sourceUrl: string | null;
};

const CACHE_WINDOW = 1;

export function createReaderDocumentCache() {
  let activeBook: FoliateBook | null = null;
  let generation = 0;
  let isPreparing = false;
  let scheduled = false;
  const cache = new Map<number, CachedDocumentSnapshot>();
  const desired = new Set<number>();
  const pending = new Map<number, Promise<void>>();

  const getSection = (index: number) => activeBook?.sections?.[index] as CacheableSection | undefined;

  const releaseEntry = (index: number) => {
    const section = getSection(index);
    if (cache.has(index)) section?.unload?.();
    cache.delete(index);
  };

  const prune = (allowed: Set<number>) => {
    for (const index of cache.keys()) {
      if (!allowed.has(index)) releaseEntry(index);
    }
  };

  const prepareSection = async (index: number, token: number) => {
    const section = getSection(index);
    if (!section?.createDocument || !section.load) return;

    const id = String(section.id ?? index);
    const cached = cache.get(index);
    if (cached?.id === id) return;

    const [sourceUrl, doc] = await Promise.all([
      section.load(),
      section.createDocument(),
    ]);

    if (token !== generation || activeBook?.sections?.[index] !== section) {
      section.unload?.();
      return;
    }

    prepareDocumentSnapshot(doc, index);
    cache.set(index, {
      document: doc,
      id,
      index,
      preparedAt: Date.now(),
      sourceUrl,
    });
  };

  const getNextPrepareIndex = () => {
    for (const index of desired) {
      if (!cache.has(index) && !pending.has(index)) return index;
    }
    return undefined;
  };

  const schedulePrepare = () => {
    if (scheduled || isPreparing) return;
    scheduled = true;
    runWhenIdle(() => {
      scheduled = false;
      void prepareNext();
    }, 1200, 120);
  };

  const prepareNext = async () => {
    if (isPreparing) return;
    const index = getNextPrepareIndex();
    if (typeof index !== "number") return;

    isPreparing = true;
    const token = generation;
    const task = prepareSection(index, token)
      .catch((error) => {
        console.warn(`Failed to prepare section ${index}.`, error);
      })
      .finally(() => {
        pending.delete(index);
      });
    pending.set(index, task);

    try {
      await task;
    } finally {
      isPreparing = false;
      if (getNextPrepareIndex() != null) schedulePrepare();
    }
  };

  const prepareAround = (currentIndex: number | undefined) => {
    if (!activeBook || typeof currentIndex !== "number") return;

    const sections = activeBook.sections ?? [];
    const targets = new Set<number>();
    for (let offset = -CACHE_WINDOW; offset <= CACHE_WINDOW; offset += 1) {
      const index = currentIndex + offset;
      if (index >= 0 && index < sections.length) targets.add(index);
    }

    prune(targets);
    desired.clear();
    for (const index of targets) desired.add(index);
    schedulePrepare();
  };

  const reset = () => {
    generation += 1;
    for (const index of Array.from(cache.keys())) releaseEntry(index);
    cache.clear();
    desired.clear();
    pending.clear();
    activeBook = null;
    isPreparing = false;
    scheduled = false;
  };

  return {
    getSnapshot: (index: number) => cache.get(index) ?? null,
    prepareAround,
    reset,
    setBook: (book: FoliateBook | null) => {
      reset();
      activeBook = book;
    },
  };
}

function prepareDocumentSnapshot(doc: Document, index: number) {
  doc.documentElement.dataset.readerCachedDocument = "true";
  doc.documentElement.dataset.readerSectionIndex = String(index);

  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement("head"), doc.documentElement.firstChild);
  const style = doc.createElement("style");
  style.dataset.readerCachedStyles = "true";
  style.textContent = getBookStyles();
  head.append(style);
}
