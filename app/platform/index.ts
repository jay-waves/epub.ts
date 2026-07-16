import { del, get, set } from "idb-keyval";

export type WritableFileHandle = FileSystemFileHandle;

export const isWebViewer = __VIEWER_PLATFORM__ === "web";

export function getViewerAssetUrl(filename: string) {
  return isWebViewer
    ? new URL(filename, document.baseURI).href
    : chrome.runtime.getURL(filename);
}

export async function ensureSourceAccess(sourceUrl?: string) {
  if (isWebViewer || !sourceUrl?.startsWith("file://")) return true;

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    console.warn("File URL access is disabled. Enable 'Allow access to file URLs' for this extension.");
  }
  return allowed;
}

export function getInitialSourceUrl() {
  if (isWebViewer) return null;
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

export function normalizeSourceUrl(sourceUrl: string) {
  if (!sourceUrl.startsWith("file://")) return sourceUrl;
  try {
    return new URL(sourceUrl).href;
  } catch {
    return sourceUrl;
  }
}

function getFileHandleKey(bookKey: string) {
  return `epub-file-handle:${bookKey}`;
}

export async function getStoredFileHandle(bookKey: string) {
  if (!bookKey) return undefined;
  return get<FileSystemFileHandle>(getFileHandleKey(bookKey));
}

export async function saveFileHandle(bookKey: string, handle: WritableFileHandle) {
  if (bookKey) await set(getFileHandleKey(bookKey), handle);
}

export async function clearFileHandle(bookKey: string) {
  if (bookKey) await del(getFileHandleKey(bookKey));
}

export async function verifyWritePermission(handle: WritableFileHandle) {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (await handle.queryPermission(descriptor) === "granted") return true;
  return await handle.requestPermission(descriptor) === "granted";
}

export async function writeBlobToFile(handle: WritableFileHandle, blob: Blob) {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
