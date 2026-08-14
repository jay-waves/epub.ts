import {
  readViewerMetadata,
  saveFileHandle,
  writeViewerMetadata,
} from "./browser-storage";
import { BrowserEpubFileHandle } from "./browser-file-handle";
import { openExternal } from "./external";
import { createWebReaderProfile } from "./reader-profile";
import type { PlatformDocument, ViewerPlatform } from "./types";

const RECENT_FILE_KEY = "web:recent-epub";

function getWebAssetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

class DownloadEpubFileHandle {
  constructor(readonly name: string) {}

  async prepareWrite() {
    const shouldDownload = window.confirm(
      "Direct saving is not available for this file. Download a copy instead?",
    );
    if (!shouldDownload) return null;

    const fileName = this.name;
    return {
      async save(blob: Blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
      },
    };
  }
}

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
    fileHandle: nativeHandle
      ? new BrowserEpubFileHandle(file.name, storageKey, nativeHandle)
      : new DownloadEpubFileHandle(file.name),
    release: () => URL.revokeObjectURL(sourceUrl),
  };
}

export const platform: ViewerPlatform = {
  readerProfile: createWebReaderProfile(getWebAssetUrl),
  translationModelPolicy: "external-fallback",
  async loadInitialDocument() {
    return undefined;
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
