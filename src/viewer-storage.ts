import type {
  ReaderHighlight,
  ReaderSettings,
  ReaderHighlights,
  ReadingHistory,
  ReadingPosition,
} from "./viewer-types";
import type { RelocateDetail } from "../foliate-js/view.js";

const HISTORY_STORAGE_KEY = "reading-history";
const HIGHLIGHTS_STORAGE_KEY = "reading-highlights";
let positionWrite = Promise.resolve();

function getBookPositionKey(bookKey: string) {
  return `reading-position:${bookKey}`;
}

function getBookHighlightsKey(bookKey: string) {
  return `reading-highlights:${bookKey}`;
}

async function getStorage<T>(key: string, fallback: T) {
  const items = await chrome.storage.local.get(key);
  return (items[key] as T | undefined) ?? fallback;
}

async function setStorage<T>(key: string, value: T) {
  await chrome.storage.local.set({ [key]: value });
}

async function removeStorage(key: string) {
  await chrome.storage.local.remove(key);
}

async function getBookPositionRecord(bookKey: string) {
  if (!bookKey) return null;

  const record = await getStorage<ReadingPosition | null>(getBookPositionKey(bookKey), null);
  if (record) return record;

  const legacyHistory = await getStorage<ReadingHistory>(HISTORY_STORAGE_KEY, {});
  return legacyHistory[bookKey] ?? null;
}

async function getBookHighlightsRecord(bookKey: string) {
  if (!bookKey) return [];

  const highlights = await getStorage<ReaderHighlight[] | null>(getBookHighlightsKey(bookKey), null);
  if (highlights) return highlights;

  const legacyHighlights = await getStorage<ReaderHighlights>(HIGHLIGHTS_STORAGE_KEY, {});
  return legacyHighlights[bookKey] ?? [];
}

function updateBookPosition(
  bookKey: string,
  update: (previous: ReadingPosition | null) => ReadingPosition,
) {
  const write = positionWrite.then(async () => {
    await setStorage(getBookPositionKey(bookKey), update(await getBookPositionRecord(bookKey)));
  });
  positionWrite = write.catch(() => {});
  return write;
}

function mergeHighlights(...groups: ReaderHighlight[][]) {
  const highlights = new Map<string, ReaderHighlight>();
  for (const highlight of groups.flat()) {
    if (!highlights.has(highlight.value)) highlights.set(highlight.value, highlight);
  }
  return [...highlights.values()].sort((left, right) => left.createdAt - right.createdAt);
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

  await updateBookPosition(bookKey, (previous) => ({
    cfi: detail.cfi,
    fraction: detail.fraction,
    settings: previous?.settings,
    updatedAt: Date.now(),
  }));
}

export async function saveReaderSettings(bookKey: string, settings: ReaderSettings) {
  if (!bookKey) return;

  await updateBookPosition(bookKey, (previous) => ({
    cfi: previous?.cfi,
    fraction: previous?.fraction,
    settings,
    updatedAt: Date.now(),
  }));
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

  await setSavedHighlights(
    bookKey,
    mergeHighlights(await getBookHighlightsRecord(bookKey), highlights),
  );
}

export async function reconcileBookStorage(primaryKey: string, aliasKeys: string[]) {
  if (!primaryKey) return;

  const fallbackKeys = aliasKeys.filter((key) => key && key !== primaryKey);
  if (!fallbackKeys.length) return;

  const positions = await Promise.all(
    [primaryKey, ...fallbackKeys].map(getBookPositionRecord),
  );
  const latestPosition = positions
    .filter((entry): entry is ReadingPosition => Boolean(entry))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];

  if (latestPosition) {
    await setStorage(getBookPositionKey(primaryKey), latestPosition);
  }

  const highlightEntries = await Promise.all(
    [primaryKey, ...fallbackKeys].map(getBookHighlightsRecord),
  );

  const highlights = mergeHighlights(...highlightEntries);
  if (highlights.length) await setStorage(getBookHighlightsKey(primaryKey), highlights);

  await Promise.all([
    ...fallbackKeys.map((key) => removeStorage(getBookPositionKey(key))),
    ...fallbackKeys.map((key) => removeStorage(getBookHighlightsKey(key))),
  ]);
}
