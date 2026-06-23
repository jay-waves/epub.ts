import type {
  ReaderHighlight,
  ReaderSettings,
  ReaderHighlights,
  ReadingHistory,
  ReadingPosition,
  RelocateDetail,
} from "./viewer-types";

export const HISTORY_STORAGE_KEY = "reading-history";
export const HIGHLIGHTS_STORAGE_KEY = "reading-highlights";

function getBookPositionKey(bookKey: string) {
  return `reading-position:${bookKey}`;
}

function getBookHighlightsKey(bookKey: string) {
  return `reading-highlights:${bookKey}`;
}

export async function getStorage<T>(key: string, fallback: T) {
  const items = await chrome.storage.local.get(key);
  return (items[key] as T | undefined) ?? fallback;
}

export async function setStorage<T>(key: string, value: T) {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeStorage(key: string) {
  await chrome.storage.local.remove(key);
}

async function getLegacyReadingHistory() {
  return getStorage<ReadingHistory>(HISTORY_STORAGE_KEY, {});
}

async function getLegacyHighlights() {
  return getStorage<ReaderHighlights>(HIGHLIGHTS_STORAGE_KEY, {});
}

async function getBookPositionRecord(bookKey: string) {
  if (!bookKey) return null;

  const record = await getStorage<ReadingPosition | null>(getBookPositionKey(bookKey), null);
  if (record) return record;

  const legacyHistory = await getLegacyReadingHistory();
  return legacyHistory[bookKey] ?? null;
}

async function getBookHighlightsRecord(bookKey: string) {
  if (!bookKey) return [];

  const highlights = await getStorage<ReaderHighlight[] | null>(getBookHighlightsKey(bookKey), null);
  if (highlights) return highlights;

  const legacyHighlights = await getLegacyHighlights();
  return legacyHighlights[bookKey] ?? [];
}

export async function getSavedPosition(bookKey: string) {
  return (await getBookPositionRecord(bookKey)) ?? undefined;
}

export async function getSavedReaderSettings(bookKey: string) {
  const position = await getBookPositionRecord(bookKey);
  return position?.settings;
}

export async function saveReadingPosition(bookKey: string, detail: RelocateDetail) {
  if (!bookKey || (!detail.cfi && typeof detail.fraction !== "number")) return;

  const previous = await getBookPositionRecord(bookKey);
  const next: ReadingPosition = {
    cfi: detail.cfi,
    fraction: detail.fraction,
    settings: previous?.settings,
    updatedAt: Date.now(),
  };
  await setStorage(getBookPositionKey(bookKey), next);
}

export async function saveReaderSettings(bookKey: string, settings: ReaderSettings) {
  if (!bookKey) return;

  const previous = await getBookPositionRecord(bookKey);
  const next: ReadingPosition = {
    cfi: previous?.cfi,
    fraction: previous?.fraction,
    settings,
    updatedAt: Date.now(),
  };
  await setStorage(getBookPositionKey(bookKey), next);
}

export async function getSavedHighlights(bookKey: string) {
  return getBookHighlightsRecord(bookKey);
}

export async function saveHighlight(bookKey: string, highlight: ReaderHighlight) {
  if (!bookKey) return;

  const bookHighlights = await getBookHighlightsRecord(bookKey);
  if (bookHighlights.some((item) => item.value === highlight.value)) return;

  await setStorage(getBookHighlightsKey(bookKey), [...bookHighlights, highlight]);
}

export async function setSavedHighlights(bookKey: string, bookHighlights: ReaderHighlight[]) {
  if (!bookKey) return;
  await setStorage(getBookHighlightsKey(bookKey), bookHighlights);
}

export async function mergeSavedHighlights(bookKey: string, highlights: ReaderHighlight[]) {
  if (!bookKey || highlights.length === 0) return;

  const mergedHighlights = new Map<string, ReaderHighlight>();
  for (const highlight of await getBookHighlightsRecord(bookKey)) {
    mergedHighlights.set(highlight.value, highlight);
  }
  for (const highlight of highlights) {
    if (!mergedHighlights.has(highlight.value)) mergedHighlights.set(highlight.value, highlight);
  }

  await setSavedHighlights(
    bookKey,
    Array.from(mergedHighlights.values()).sort((left, right) => left.createdAt - right.createdAt),
  );
}

export async function reconcileBookStorage(primaryKey: string, aliasKeys: string[]) {
  if (!primaryKey) return;

  const fallbackKeys = aliasKeys.filter((key) => key && key !== primaryKey);
  if (!fallbackKeys.length) return;

  const positionEntries = await Promise.all(
    [primaryKey, ...fallbackKeys].map(async (key) => ({ key, value: await getBookPositionRecord(key) })),
  );
  const latestPosition = positionEntries
    .map(({ value }) => value)
    .filter((entry): entry is ReadingPosition => Boolean(entry))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];

  if (latestPosition) {
    await setStorage(getBookPositionKey(primaryKey), latestPosition);
  }

  const highlightEntries = await Promise.all(
    [primaryKey, ...fallbackKeys].map(async (key) => await getBookHighlightsRecord(key)),
  );

  const mergedHighlights = new Map<string, ReaderHighlight>();
  for (const bookHighlights of highlightEntries) {
    for (const highlight of bookHighlights) {
      if (!mergedHighlights.has(highlight.value)) mergedHighlights.set(highlight.value, highlight);
    }
  }

  if (mergedHighlights.size > 0) {
    const merged = Array.from(mergedHighlights.values()).sort((left, right) => left.createdAt - right.createdAt);
    await setStorage(getBookHighlightsKey(primaryKey), merged);
  }

  await Promise.all([
    ...fallbackKeys.map((key) => removeStorage(getBookPositionKey(key))),
    ...fallbackKeys.map((key) => removeStorage(getBookHighlightsKey(key))),
  ]);
}
