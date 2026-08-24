import type {
  ReaderSettings,
  SavedReadingPosition,
} from "./model";
import type { Location } from "./navigation";
import { platform } from "#platform";

let pendingPositionWrite = Promise.resolve();

const getBookPositionKey = (bookKey: string) => `reading-position:${bookKey}`;

function updateBookPosition(
  bookKey: string,
  update: (previous: SavedReadingPosition | undefined) => SavedReadingPosition,
) {
  const result = pendingPositionWrite.then(async () => {
    await platform.writeViewerMetadata(getBookPositionKey(bookKey), update(await getSavedPosition(bookKey)));
  });
  pendingPositionWrite = result.then(() => undefined, () => undefined);
  return result;
}

export async function getSavedPosition(bookKey: string) {
  if (!bookKey) return undefined;
  return platform.readViewerMetadata<SavedReadingPosition>(getBookPositionKey(bookKey));
}

export async function saveReadingPosition(bookKey: string, detail: Location) {
  if (!bookKey) return;

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
