import { del, get, set } from "idb-keyval";

export function readViewerMetadata<Value>(key: string) {
  return get<Value>(key);
}

export function writeViewerMetadata<Value>(key: string, value: Value) {
  return set(key, value);
}

function getFileHandleKey(bookKey: string) {
  return `epub-file-handle:${bookKey}`;
}

export function getStoredFileHandle(bookKey: string) {
  return get<FileSystemFileHandle>(getFileHandleKey(bookKey));
}

export function saveFileHandle(bookKey: string, handle: FileSystemFileHandle) {
  return set(getFileHandleKey(bookKey), handle);
}

export function clearFileHandle(bookKey: string) {
  return del(getFileHandleKey(bookKey));
}

export async function verifyWritePermission(handle: FileSystemFileHandle) {
  const descriptor: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (await handle.queryPermission(descriptor) === "granted") return true;
  return (await handle.requestPermission(descriptor)) === "granted";
}

export async function writeBlobToFile(handle: FileSystemFileHandle, blob: Blob) {
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

export function normalizeSourceUrl(sourceUrl: string) {
  if (!sourceUrl.startsWith("file://")) return sourceUrl;
  try {
    return new URL(sourceUrl).href;
  } catch {
    return sourceUrl;
  }
}
