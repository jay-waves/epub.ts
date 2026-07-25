import type {
  ReaderHighlight,
  ReaderSettings,
  ReadingPosition,
} from "./reader";
import type { RelocateDetail } from "./foliate";
import { platform } from "#platform";

const queuePositionWrite = createWriteQueue();
const queueHighlightWrite = createWriteQueue();

const getBookPositionKey = (bookKey: string) => `reading-position:${bookKey}`;
const getBookHighlightsKey = (bookKey: string) => `reading-highlights:${bookKey}`;

async function getBookPositionRecord(bookKey: string) {
  if (!bookKey) return null;
  return (await platform.readViewerMetadata<ReadingPosition>(getBookPositionKey(bookKey))) ?? null;
}

async function getBookHighlightsRecord(bookKey: string) {
  if (!bookKey) return [];
  return (await platform.readViewerMetadata<ReaderHighlight[]>(getBookHighlightsKey(bookKey))) ?? [];
}

function updateBookPosition(
  bookKey: string,
  update: (previous: ReadingPosition | null) => ReadingPosition,
) {
  return queuePositionWrite(async () => {
    await platform.writeViewerMetadata(getBookPositionKey(bookKey), update(await getBookPositionRecord(bookKey)));
  });
}

export async function getSavedPosition(bookKey: string) {
  return (await getBookPositionRecord(bookKey)) ?? undefined;
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

export async function setSavedHighlights(bookKey: string, bookHighlights: ReaderHighlight[]) {
  if (!bookKey) return;
  await queueHighlightWrite(() => platform.writeViewerMetadata(getBookHighlightsKey(bookKey), bookHighlights));
}

function createWriteQueue() {
  let pending = Promise.resolve();

  return <Result>(write: () => Promise<Result>) => {
    const result = pending.then(write);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
}
