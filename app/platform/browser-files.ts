import { del, get, set } from "idb-keyval";
import type { EpubFileHandle, PlatformDocument } from "./types";

function getFileHandleKey(bookKey: string) {
  return `epub-file-handle:${bookKey}`;
}

function getStoredFileHandle(bookKey: string) {
  return get<FileSystemFileHandle>(getFileHandleKey(bookKey));
}

function saveFileHandle(bookKey: string, handle: FileSystemFileHandle) {
  return set(getFileHandleKey(bookKey), handle);
}

function clearFileHandle(bookKey: string) {
  return del(getFileHandleKey(bookKey));
}

async function verifyWritePermission(handle: FileSystemFileHandle) {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (await handle.queryPermission(descriptor) === "granted") return true;
  return (await handle.requestPermission(descriptor)) === "granted";
}

async function writeBlobToFile(handle: FileSystemFileHandle, blob: Blob) {
  if (blob.size === 0) throw new Error("Refusing to write an empty file.");

  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    await writable.write({ type: "write", position: 0, data: blob });
    await writable.truncate(blob.size);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }

  const savedFile = await handle.getFile();
  if (savedFile.size !== blob.size) {
    throw new Error(`Saved file size mismatch: expected ${blob.size}, received ${savedFile.size}.`);
  }
}

export class BrowserEpubFileHandle implements EpubFileHandle {
  private nativeHandle?: FileSystemFileHandle;

  constructor(
    readonly name: string,
    private readonly storageKey: string,
    nativeHandle?: FileSystemFileHandle,
  ) {
    this.nativeHandle = nativeHandle;
  }

  private async resolveHandle() {
    if (this.nativeHandle && await verifyWritePermission(this.nativeHandle)) {
      return this.nativeHandle;
    }

    const storedHandle = await getStoredFileHandle(this.storageKey);
    if (storedHandle && await verifyWritePermission(storedHandle)) {
      this.nativeHandle = storedHandle;
      return storedHandle;
    }

    if (!("showSaveFilePicker" in window)) {
      throw new Error("File System Access API is not available in this browser.");
    }

    const handle = await window.showSaveFilePicker({
      id: "epub-overlay-save-file",
      suggestedName: this.name,
      startIn: "documents",
      types: [{
        description: "EPUB files",
        accept: { "application/epub+zip": [".epub"] },
      }],
    });
    if (!await verifyWritePermission(handle)) return null;

    this.nativeHandle = handle;
    await saveFileHandle(this.storageKey, handle);
    return handle;
  }

  async prepareWrite() {
    const handle = await this.resolveHandle();
    if (!handle) return null;

    return {
      save: async (blob: Blob) => {
        try {
          await writeBlobToFile(handle, blob);
          return true;
        } catch (error) {
          await clearFileHandle(this.storageKey);
          if (this.nativeHandle === handle) this.nativeHandle = undefined;
          throw error;
        }
      },
    };
  }
}

const RECENT_FILE_KEY = "browser:recent-epub";

class DownloadEpubFileHandle implements EpubFileHandle {
  constructor(readonly name: string) {}

  async prepareWrite() {
    if (!window.confirm("Direct saving is not available for this file. Download a copy instead?")) {
      return null;
    }
    return {
      save: async (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = Object.assign(document.createElement("a"), {
          download: this.name,
          hidden: true,
          href: url,
        });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
      },
    };
  }
}

function createBrowserLocalDocument(
  file: File,
  storageKey = `local:${file.name}:${file.size}:${file.lastModified}`,
  nativeHandle?: FileSystemFileHandle,
): PlatformDocument {
  const sourceUrl = URL.createObjectURL(file);
  return {
    input: file,
    sourceUrl,
    key: `local:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    sourceLabel: file.name,
    fileHandle: nativeHandle
      ? new BrowserEpubFileHandle(file.name, storageKey, nativeHandle)
      : new DownloadEpubFileHandle(file.name),
    release: () => URL.revokeObjectURL(sourceUrl),
  };
}

async function pickBrowserLocalDocument() {
  const [handle] = await window.showOpenFilePicker({
    id: "epub-file",
    startIn: "documents",
    types: [{
      description: "EPUB files",
      accept: { "application/epub+zip": [".epub"] },
    }],
    excludeAcceptAllOption: true,
    multiple: false,
  });
  await saveFileHandle(RECENT_FILE_KEY, handle);
  return createBrowserLocalDocument(await handle.getFile(), RECENT_FILE_KEY, handle);
}

export const browserLocalDocumentCapabilities = {
  openLocalDocument: createBrowserLocalDocument,
  ...("showOpenFilePicker" in window ? {
    pickLocalDocument: pickBrowserLocalDocument,
  } : {}),
};
