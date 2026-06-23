import {
  BlobReader,
  BlobWriter,
  configure,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { del, get, set } from "idb-keyval";
import type { ReaderHighlight } from "./viewer-types";
import type { Entry, FileEntry } from "@zip.js/zip.js";

export const EPUB_MIME_TYPE = "application/epub+zip";
const EPUB_MIMETYPE_ENTRY = "mimetype";
const OVERLAY_ENTRY = "META-INF/epub-viewer-annotations.json";

type OverlayFile = {
  createdAt?: string;
  generator: "epub-viewer-extension";
  highlights: ReaderHighlight[];
  updatedAt: string;
  version: 1;
};

configure({ useWebWorkers: false });

function getHandleKey(bookKey: string) {
  return `epub-file-handle:${bookKey}`;
}

function createOverlayFile(highlights: ReaderHighlight[]): OverlayFile {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    generator: "epub-viewer-extension",
    highlights,
    updatedAt: now,
    version: 1,
  };
}

function parseOverlayFile(value: string): ReaderHighlight[] {
  const parsed = JSON.parse(value) as Partial<OverlayFile>;
  if (!Array.isArray(parsed.highlights)) return [];
  return parsed.highlights.filter(isReaderHighlight);
}

function isReaderHighlight(value: unknown): value is ReaderHighlight {
  if (!value || typeof value !== "object") return false;
  const highlight = value as Partial<ReaderHighlight>;
  return typeof highlight.value === "string"
    && typeof highlight.color === "string"
    && typeof highlight.createdAt === "number";
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

export async function getEpubBlob(sourceUrl: string) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Failed to read EPUB: ${response.status} ${response.statusText}`);
  return response.blob();
}

export async function readEmbeddedHighlights(source: Blob | string) {
  const blob = typeof source === "string" ? await getEpubBlob(source) : source;
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const overlayEntry = entries.find((entry) => entry.filename === OVERLAY_ENTRY);
    if (!overlayEntry || !isFileEntry(overlayEntry)) return [];

    const text = await overlayEntry.getData?.(new TextWriter());
    return text ? parseOverlayFile(text) : [];
  } finally {
    await reader.close();
  }
}

export async function createAnnotatedEpub(sourceBlob: Blob, highlights: ReaderHighlight[]) {
  const reader = new ZipReader(new BlobReader(sourceBlob));
  const writer = new ZipWriter(new BlobWriter(EPUB_MIME_TYPE));

  try {
    const entries = await reader.getEntries();
    const mimetypeEntry = entries.find((entry) => entry.filename === EPUB_MIMETYPE_ENTRY);
    const mimetype = mimetypeEntry && isFileEntry(mimetypeEntry)
      ? await mimetypeEntry.getData?.(new TextWriter())
      : EPUB_MIME_TYPE;

    await writer.add(EPUB_MIMETYPE_ENTRY, new TextReader(mimetype || EPUB_MIME_TYPE), { level: 0 });

    for (const entry of entries) {
      if (entry.filename === EPUB_MIMETYPE_ENTRY || entry.filename === OVERLAY_ENTRY) continue;
      if (!isFileEntry(entry)) {
        await writer.add(entry.filename, undefined, { directory: true });
        continue;
      }

      const blob = await entry.getData?.(new BlobWriter());
      if (blob) await writer.add(entry.filename, new BlobReader(blob), { lastModDate: entry.lastModDate });
    }

    await writer.add(
      OVERLAY_ENTRY,
      new TextReader(`${JSON.stringify(createOverlayFile(highlights), null, 2)}\n`),
      { lastModDate: new Date() },
    );

    return await writer.close();
  } finally {
    await reader.close();
  }
}

export async function getStoredFileHandle(bookKey: string) {
  if (!bookKey) return undefined;
  return get<FileSystemFileHandle>(getHandleKey(bookKey));
}

export async function saveFileHandle(bookKey: string, handle: FileSystemFileHandle) {
  if (!bookKey) return;
  await set(getHandleKey(bookKey), handle);
}

export async function clearFileHandle(bookKey: string) {
  if (!bookKey) return;
  await del(getHandleKey(bookKey));
}

export async function verifyWritePermission(handle: FileSystemFileHandle) {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (await handle.queryPermission(descriptor) === "granted") return true;
  return await handle.requestPermission(descriptor) === "granted";
}

export async function writeBlobToFile(handle: FileSystemFileHandle, blob: Blob) {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
