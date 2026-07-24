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

export const isWebViewer = false;
export const isDocflowViewer = false;
export const usesFullReaderStyle = true;

export function getViewerAssetUrl(filename: string) {
  return chrome.runtime.getURL(filename);
}

export async function ensureSourceAccess(sourceUrl: string) {
  if (!sourceUrl.startsWith("file://")) return true;

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    console.warn("File URL access is disabled. Enable 'Allow access to file URLs' for this extension.");
  }
  return allowed;
}

export function getInitialSourceUrl() {
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

export async function saveDocflowBlob(_blob: Blob): Promise<boolean> {
  throw new Error("No active docflow session.");
}
