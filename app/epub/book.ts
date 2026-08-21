import {
  BlobReader,
  BlobWriter,
  configure,
  TextWriter,
  ZipReader,
} from "@zip.js/zip.js";
import type { FileEntry } from "@zip.js/zip.js";
import type { Book } from "../renderer/reader-view.js";

class ResponseError extends Error {}
class NotFoundError extends Error {}
class UnsupportedTypeError extends Error {}

async function fetchFile(url: string) {
  const startedAt = performance.now();
  console.info("[EPUB.ts] Fetching EPUB resource.", { url });
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ResponseError(`${response.status} ${response.statusText}`, { cause: response });
    }
    const blob = await response.blob();
    console.info("[EPUB.ts] EPUB resource fetched.", {
      durationMs: Math.round(performance.now() - startedAt),
      sizeBytes: blob.size,
      status: response.status,
      url: response.url,
    });
    return new File([blob], new URL(response.url).pathname);
  } catch (error) {
    console.info("[EPUB.ts] EPUB resource fetch failed.", {
      durationMs: Math.round(performance.now() - startedAt),
      error,
      url,
    });
    throw error;
  }
}

async function isZip(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function createZipSource(file: File) {
  const startedAt = performance.now();
  console.info("[EPUB.ts] Indexing EPUB archive.", { name: file.name, sizeBytes: file.size });
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file));
  const entries = (await reader.getEntries()).filter((entry): entry is FileEntry => !entry.directory);
  const files = new Map(entries.map((entry) => [entry.filename, entry]));
  console.info("[EPUB.ts] EPUB archive indexed.", {
    durationMs: Math.round(performance.now() - startedAt),
    entryCount: entries.length,
  });

  return {
    entries,
    getSize: (name: string) => files.get(name)?.uncompressedSize ?? 0,
    loadBlob: (name: string, type?: string) => {
      const entry = files.get(name);
      return entry ? entry.getData(new BlobWriter(type)) : null;
    },
    loadText: (name: string) => {
      const entry = files.get(name);
      return entry ? entry.getData(new TextWriter()) : null;
    },
    destroy: () => reader.close(),
  };
}

export async function createBook(input: File | string): Promise<Book> {
  const file = typeof input === "string" ? await fetchFile(input) : input;
  if (!file.size) throw new NotFoundError("File not found");
  if (!await isZip(file)) throw new UnsupportedTypeError("File type not supported");

  const source = await createZipSource(file);
  let book: Book | undefined;
  try {
    const startedAt = performance.now();
    console.info("[EPUB.ts] Loading EPUB parser engine.");
    const { EPUB } = await import("./parser.js");
    console.info("[EPUB.ts] EPUB parser engine loaded; parsing publication.", {
      durationMs: Math.round(performance.now() - startedAt),
    });
    book = await new EPUB(source).init() as Book;
    if (!book.sections.length) {
      throw new UnsupportedTypeError("EPUB has no readable sections");
    }
    console.info("[EPUB.ts] EPUB publication parsed.", {
      durationMs: Math.round(performance.now() - startedAt),
      sectionCount: book.sections.length,
    });
    return book;
  } catch (error) {
    if (book) await book.destroy?.();
    else await source.destroy();
    throw error;
  }
}
