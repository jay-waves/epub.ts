import type {
  ReaderHighlight,
  ReaderSettings,
  ReadingPosition,
} from "./reader/model";
import type { Location } from "./reader/navigation";
import { platform } from "#platform";

const queuePositionWrite = createWriteQueue();
const queueHighlightAccess = createWriteQueue();

const getBookPositionKey = (bookKey: string) => `reading-position:${bookKey}`;
const getBookHighlightsKey = (bookKey: string) => `reading-highlights:${bookKey}`;

function updateBookPosition(
  bookKey: string,
  update: (previous: ReadingPosition | undefined) => ReadingPosition,
) {
  return queuePositionWrite(async () => {
    await platform.writeViewerMetadata(getBookPositionKey(bookKey), update(await getSavedPosition(bookKey)));
  });
}

export async function getSavedPosition(bookKey: string) {
  if (!bookKey) return undefined;
  return platform.readViewerMetadata<ReadingPosition>(getBookPositionKey(bookKey));
}

export async function saveReadingPosition(bookKey: string, detail: Location) {
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
  if (!bookKey) return [];
  return queueHighlightAccess(async () =>
    (await platform.readViewerMetadata<ReaderHighlight[]>(getBookHighlightsKey(bookKey))) ?? []);
}

export async function setSavedHighlights(bookKey: string, bookHighlights: ReaderHighlight[]) {
  if (!bookKey) return;
  await queueHighlightAccess(() => platform.writeViewerMetadata(getBookHighlightsKey(bookKey), bookHighlights));
}

function createWriteQueue() {
  let pending = Promise.resolve();

  return <Result>(write: () => Promise<Result>) => {
    const result = pending.then(write);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
}
