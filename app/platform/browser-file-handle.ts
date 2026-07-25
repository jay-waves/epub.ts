import {
  clearFileHandle,
  getStoredFileHandle,
  saveFileHandle,
  verifyWritePermission,
  writeBlobToFile,
} from "./browser-storage";
import type { EpubFileHandle } from "./types";

export class BrowserEpubFileHandle implements EpubFileHandle {
  private nativeHandle?: FileSystemFileHandle;

  constructor(
    readonly name: string,
    private readonly storageKey: string,
    nativeHandle?: FileSystemFileHandle,
  ) {
    this.nativeHandle = nativeHandle;
  }

  private async resolveHandle() {
    if (this.nativeHandle && await verifyWritePermission(this.nativeHandle)) {
      return this.nativeHandle;
    }

    const storedHandle = await getStoredFileHandle(this.storageKey);
    if (storedHandle && await verifyWritePermission(storedHandle)) {
      this.nativeHandle = storedHandle;
      return storedHandle;
    }

    if (!("showSaveFilePicker" in window)) {
      throw new Error("File System Access API is not available in this browser.");
    }

    const handle = await window.showSaveFilePicker({
      id: "epub-overlay-save-file",
      suggestedName: this.name,
      startIn: "documents",
      types: [{
        description: "EPUB files",
        accept: { "application/epub+zip": [".epub"] },
      }],
    });
    if (!await verifyWritePermission(handle)) return null;

    this.nativeHandle = handle;
    await saveFileHandle(this.storageKey, handle);
    return handle;
  }

  async prepareWrite() {
    const handle = await this.resolveHandle();
    if (!handle) return null;

    return {
      save: async (blob: Blob) => {
        try {
          await writeBlobToFile(handle, blob);
          return true;
        } catch (error) {
          await clearFileHandle(this.storageKey);
          if (this.nativeHandle === handle) this.nativeHandle = undefined;
          throw error;
        }
      },
    };
  }
}
