import {
  getStoredFileHandle,
  readViewerMetadata,
  saveFileHandle,
  writeViewerMetadata,
} from "./browser-storage";
import { BrowserEpubFileHandle } from "./browser-file-handle";
import { openExternal } from "./external";
import { webReaderProfile } from "./reader-profile";
import type { PlatformDocument, ViewerPlatform } from "./types";

const RECENT_FILE_KEY = "web:recent-epub";

function documentFromFile(
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
    fileHandle: new BrowserEpubFileHandle(file.name, storageKey, nativeHandle),
    release: () => URL.revokeObjectURL(sourceUrl),
  };
}

async function restoreRecentDocument() {
  try {
    const handle = await getStoredFileHandle(RECENT_FILE_KEY);
    if (!handle || await handle.queryPermission({ mode: "read" }) !== "granted") return undefined;
    return documentFromFile(await handle.getFile(), RECENT_FILE_KEY, handle);
  } catch {
    return undefined;
  }
}

export const platform: ViewerPlatform = {
  readerProfile: webReaderProfile,
  translationModelPolicy: "external-fallback",
  async loadInitialDocument() {
    return restoreRecentDocument();
  },
  openLocalDocument: documentFromFile,
  ...("showOpenFilePicker" in window ? {
    async pickLocalDocument() {
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
      return documentFromFile(await handle.getFile(), RECENT_FILE_KEY, handle);
    },
  } : {}),
  openExternal,
  readViewerMetadata,
  writeViewerMetadata,
};
