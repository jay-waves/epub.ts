export {
  clearFileHandle,
  getStoredFileHandle,
  normalizeSourceUrl,
  readViewerMetadata,
  saveFileHandle,
  verifyWritePermission,
  writeBlobToFile,
  writeViewerMetadata,
} from "./browser-storage";
export type { WritableFileHandle } from "./browser-storage";

export const isWebViewer = true;
export const isDocflowViewer = false;
export const usesFullReaderStyle = false;

export function getViewerAssetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

export async function ensureSourceAccess() {
  return true;
}

export function getInitialSourceUrl() {
  return null;
}

export async function saveDocflowBlob(_blob: Blob): Promise<boolean> {
  throw new Error("No active docflow session.");
}
