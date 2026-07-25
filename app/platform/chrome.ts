import {
  normalizeSourceUrl,
  readViewerMetadata,
  writeViewerMetadata,
} from "./browser-storage";
import { BrowserEpubFileHandle } from "./browser-file-handle";
import { openExternal } from "./external";
import { createBundledReaderProfile } from "./reader-profile";
import type { ViewerPlatform } from "./types";

function getInitialSourceUrl() {
  const query = window.location.search;
  if (!query) return null;

  const prefix = "src=";
  const parts = query.startsWith("?") ? query.slice(1).split("&") : query.split("&");
  const partIndex = parts.findIndex((part) => part.startsWith(prefix));
  if (partIndex < 0) return new URLSearchParams(query).get("src");

  const rawSource = parts.slice(partIndex).join("&").slice(prefix.length);
  try {
    return decodeURIComponent(rawSource);
  } catch {
    return rawSource;
  }
}

function getFileName(sourceUrl: string) {
  try {
    return decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() || "book.epub");
  } catch {
    return "book.epub";
  }
}

export const platform: ViewerPlatform = {
  readerProfile: createBundledReaderProfile((filename) => chrome.runtime.getURL(filename), 15),
  translationModelPolicy: "allow-download",
  async loadInitialDocument() {
    const rawSourceUrl = getInitialSourceUrl();
    if (!rawSourceUrl) return undefined;
    const sourceUrl = normalizeSourceUrl(rawSourceUrl);
    if (sourceUrl.startsWith("file://")) {
      const allowed = await chrome.extension.isAllowedFileSchemeAccess();
      if (!allowed) {
        console.warn("File URL access is disabled. Enable 'Allow access to file URLs' for this extension.");
        return undefined;
      }
    }
    const name = getFileName(sourceUrl);
    return {
      input: sourceUrl,
      sourceUrl,
      key: sourceUrl,
      name,
      sourceLabel: sourceUrl,
      fileHandle: new BrowserEpubFileHandle(name, sourceUrl),
    };
  },
  openExternal,
  readViewerMetadata,
  writeViewerMetadata,
};
