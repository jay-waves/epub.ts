import type {
  ReaderHighlight,
  ReaderHighlights,
  ReaderSettings,
  ReadingHistory,
  ReadingPosition,
  RelocateDetail,
} from "./viewer-types";

export const HISTORY_STORAGE_KEY = "reading-history";
export const HIGHLIGHTS_STORAGE_KEY = "reading-highlights";

export async function getStorage<T>(key: string, fallback: T) {
  const items = await chrome.storage.local.get(key);
  return (items[key] as T | undefined) ?? fallback;
}

export async function setStorage<T>(key: string, value: T) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getReadingHistory() {
  return getStorage<ReadingHistory>(HISTORY_STORAGE_KEY, {});
}

export async function getSavedPosition(bookKey: string) {
  const history = await getReadingHistory();
  return history[bookKey];
}

export async function getSavedReaderSettings(bookKey: string) {
  const history = await getReadingHistory();
  return history[bookKey]?.settings;
}

export async function saveReadingPosition(bookKey: string, detail: RelocateDetail) {
  if (!detail.cfi && typeof detail.fraction !== "number") return;

  const history = await getReadingHistory();
  const previous = history[bookKey];
  history[bookKey] = {
    cfi: detail.cfi,
    fraction: detail.fraction,
    settings: previous?.settings,
    updatedAt: Date.now(),
  };
  await setStorage(HISTORY_STORAGE_KEY, history);
}

export async function saveReaderSettings(bookKey: string, settings: ReaderSettings) {
  const history = await getReadingHistory();
  const previous = history[bookKey];
  history[bookKey] = {
    cfi: previous?.cfi,
    fraction: previous?.fraction,
    settings,
    updatedAt: Date.now(),
  };
  await setStorage(HISTORY_STORAGE_KEY, history);
}

export async function getSavedHighlights(bookKey: string) {
  const highlights = await getStorage<ReaderHighlights>(HIGHLIGHTS_STORAGE_KEY, {});
  return highlights[bookKey] ?? [];
}

export async function saveHighlight(bookKey: string, highlight: ReaderHighlight) {
  const highlights = await getStorage<ReaderHighlights>(HIGHLIGHTS_STORAGE_KEY, {});
  const bookHighlights = highlights[bookKey] ?? [];
  if (!bookHighlights.some((item) => item.value === highlight.value)) {
    highlights[bookKey] = [...bookHighlights, highlight];
    await setStorage(HIGHLIGHTS_STORAGE_KEY, highlights);
  }
}

export async function setSavedHighlights(bookKey: string, bookHighlights: ReaderHighlight[]) {
  const highlights = await getStorage<ReaderHighlights>(HIGHLIGHTS_STORAGE_KEY, {});
  highlights[bookKey] = bookHighlights;
  await setStorage(HIGHLIGHTS_STORAGE_KEY, highlights);
}
