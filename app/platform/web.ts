import { readViewerMetadata, writeViewerMetadata } from "./browser-storage";
import { browserLocalDocumentCapabilities } from "./browser-local-document";
import { openExternal } from "./external";
import { createWebReaderProfile } from "./reader-profile";
import type { ViewerPlatform } from "./types";

function getWebAssetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

export const platform: ViewerPlatform = {
  readerProfile: createWebReaderProfile(getWebAssetUrl),
  translationModelPolicy: "external-fallback",
  loadInitialDocument: () => undefined,
  ...browserLocalDocumentCapabilities,
  openExternal,
  readViewerMetadata,
  writeViewerMetadata,
};
