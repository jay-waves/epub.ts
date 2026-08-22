import type {
  ReaderSettings,
  ReadingPosition,
} from "./model";
import type { Location } from "./navigation";
import { platform } from "#platform";
import { SerialTaskQueue } from "../shared/async-tasks";

const positionWrites = new SerialTaskQueue();

const getBookPositionKey = (bookKey: string) => `reading-position:${bookKey}`;

function updateBookPosition(
  bookKey: string,
  update: (previous: ReadingPosition | undefined) => ReadingPosition,
) {
  return positionWrites.add(async () => {
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
