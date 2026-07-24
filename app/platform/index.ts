import { del, get, set } from "idb-keyval";
import { createDocflowSession } from "./docflow";

export type WritableFileHandle = FileSystemFileHandle;

export const isWebViewer = __VIEWER_PLATFORM__ === "web";
const docflow = isWebViewer ? createDocflowSession() : null;
export const isDocflowViewer = docflow !== null;

export function getViewerAssetUrl(filename: string) {
  return isWebViewer
    ? new URL(filename, document.baseURI).href
    : chrome.runtime.getURL(filename);
}

export async function ensureSourceAccess(sourceUrl: string) {
  if (isWebViewer || !sourceUrl.startsWith("file://")) return true;

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    console.warn("File URL access is disabled. Enable 'Allow access to file URLs' for this extension.");
  }
  return allowed;
}

export function getInitialSourceUrl() {
  if (docflow) return docflow.resourceUrl;
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

export async function saveDocflowBlob(blob: Blob) {
  if (!docflow) throw new Error("No active docflow session.");
  return docflow.save(blob);
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

export function getStoredFileHandle(bookKey: string) {
  return get<FileSystemFileHandle>(getFileHandleKey(bookKey));
}

export function saveFileHandle(bookKey: string, handle: WritableFileHandle) {
  return set(getFileHandleKey(bookKey), handle);
}

export function clearFileHandle(bookKey: string) {
  return del(getFileHandleKey(bookKey));
}

export async function verifyWritePermission(handle: WritableFileHandle) {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (await handle.queryPermission(descriptor) === "granted") return true;
  return (await handle.requestPermission(descriptor)) === "granted";
}

export async function writeBlobToFile(handle: WritableFileHandle, blob: Blob) {
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
