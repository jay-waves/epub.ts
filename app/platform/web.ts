import { get as readViewerMetadata, set as writeViewerMetadata } from "idb-keyval";
import { browserLocalDocumentCapabilities } from "./browser-files";
import { openExternal, createBundledReaderProfile } from "./shared";
import type { ViewerPlatform } from "./types";

function getWebAssetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

export const platform: ViewerPlatform = {
  readerProfile: { ...createBundledReaderProfile(getWebAssetUrl), lineHeightOffset: 0.1 },
  loadInitialDocument: () => undefined,
  ...browserLocalDocumentCapabilities,
  openExternal,
  readViewerMetadata,
  writeViewerMetadata,
};
