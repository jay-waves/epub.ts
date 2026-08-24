import { saveFileHandle } from "./browser-storage";
import { BrowserEpubFileHandle } from "./browser-file-handle";
import type { EpubFileHandle, PlatformDocument } from "./types";

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
