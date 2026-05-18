import type { ReaderThemeId, ReadingHistory, ReadingPosition, RelocateDetail } from "./viewer-types";

export const HISTORY_STORAGE_KEY = "reading-history";
export const FONT_SIZE_STORAGE_KEY = "reader-font-size";
export const MARGIN_STORAGE_KEY = "reader-margin";
export const SPACING_STORAGE_KEY = "reader-spacing";
export const THEME_STORAGE_KEY = "reader-theme";

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

export async function saveReadingPosition(bookKey: string, detail: RelocateDetail) {
  if (!detail.cfi && typeof detail.fraction !== "number") return;

  const history = await getReadingHistory();
  history[bookKey] = {
    cfi: detail.cfi,
    fraction: detail.fraction,
    updatedAt: Date.now(),
  };
  await setStorage(HISTORY_STORAGE_KEY, history);
}

export async function saveReaderTheme(theme: ReaderThemeId) {
  await setStorage(THEME_STORAGE_KEY, theme);
}

export async function saveReaderFontSize(fontSize: number) {
  await setStorage(FONT_SIZE_STORAGE_KEY, fontSize);
}

export async function saveReaderMargin(margin: number) {
  await setStorage(MARGIN_STORAGE_KEY, margin);
}

export async function saveReaderSpacing(spacing: number) {
  await setStorage(SPACING_STORAGE_KEY, spacing);
}
