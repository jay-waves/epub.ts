import type { ReaderSettings, ReadingHistory, ReadingPosition, RelocateDetail } from "./viewer-types";

export const HISTORY_STORAGE_KEY = "reading-history";

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
