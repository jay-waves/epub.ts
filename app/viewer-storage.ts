import type {
  ReaderHighlight,
  ReaderSettings,
  ReadingPosition,
} from "./reader";
import type { RelocateDetail } from "./foliate";
import { get, set } from "idb-keyval";

let positionWrite = Promise.resolve();

function getBookPositionKey(bookKey: string) {
  return `reading-position:${bookKey}`;
}

function getBookHighlightsKey(bookKey: string) {
  return `reading-highlights:${bookKey}`;
}

async function getBookPositionRecord(bookKey: string) {
  if (!bookKey) return null;
  return (await get<ReadingPosition>(getBookPositionKey(bookKey))) ?? null;
}

async function getBookHighlightsRecord(bookKey: string) {
  if (!bookKey) return [];
  return (await get<ReaderHighlight[]>(getBookHighlightsKey(bookKey))) ?? [];
}

function updateBookPosition(
  bookKey: string,
  update: (previous: ReadingPosition | null) => ReadingPosition,
) {
  const write = positionWrite.then(async () => {
    await set(getBookPositionKey(bookKey), update(await getBookPositionRecord(bookKey)));
  });
  positionWrite = write.catch(() => {});
  return write;
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
  }));
}

export async function saveReaderSettings(bookKey: string, settings: ReaderSettings) {
  if (!bookKey) return;

  await updateBookPosition(bookKey, (previous) => ({
    cfi: previous?.cfi,
    fraction: previous?.fraction,
    settings,
  }));
}

export async function getSavedHighlights(bookKey: string) {
  return getBookHighlightsRecord(bookKey);
}

export async function saveHighlight(bookKey: string, highlight: ReaderHighlight) {
  if (!bookKey) return;

  const bookHighlights = await getBookHighlightsRecord(bookKey);
  if (bookHighlights.some((item) => item.value === highlight.value)) return;

  await set(getBookHighlightsKey(bookKey), [...bookHighlights, highlight]);
}

export async function setSavedHighlights(bookKey: string, bookHighlights: ReaderHighlight[]) {
  if (!bookKey) return;
  await set(getBookHighlightsKey(bookKey), bookHighlights);
}
