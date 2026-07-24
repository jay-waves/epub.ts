import { get, set } from "idb-keyval";
export {
  clearFileHandle,
  getStoredFileHandle,
  normalizeSourceUrl,
  saveFileHandle,
  verifyWritePermission,
  writeBlobToFile,
} from "./browser-storage";
export type { WritableFileHandle } from "./browser-storage";

export const isWebViewer = true;
export const isDocflowViewer = true;
export const usesFullReaderStyle = true;

type WriteResponse = {
  version: string;
};

type ConflictResponse = {
  message?: string;
};

type CopyResponse = {
  name: string;
};

function stripEtag(value: string | null) {
  return value?.trim().replace(/^"|"$/g, "") ?? "";
}

export class DocflowSession {
  readonly resourceUrl: string;
  private readonly initialVersion: Promise<string>;
  private version = "";

  constructor(documentId: string) {
    this.resourceUrl = new URL(
      `/api/documents/${encodeURIComponent(documentId)}`,
      window.location.origin,
    ).href;
    this.initialVersion = this.readInitialVersion();
  }

  async save(blob: Blob) {
    if (!this.version) this.version = await this.initialVersion;
    const response = await fetch(this.resourceUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/epub+zip",
        "If-Match": `"${this.version}"`,
      },
      body: blob,
    });
    if (response.ok) {
      const result = await response.json() as WriteResponse;
      this.version = result.version;
      return true;
    }

    if (response.status === 409) {
      const conflict = await response.json().catch(() => ({})) as ConflictResponse;
      const shouldSaveCopy = window.confirm(
        `${conflict.message ?? "This EPUB was modified by another program or docflow window."}\n\n`
        + "The original will not be overwritten. Save your changes as a conflict copy beside it?",
      );
      if (!shouldSaveCopy) return false;

      const copyResponse = await fetch(`${this.resourceUrl}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/epub+zip" },
        body: blob,
      });
      if (!copyResponse.ok) {
        throw new Error(`Docflow could not save a conflict copy (${copyResponse.status}).`);
      }
      const copy = await copyResponse.json() as CopyResponse;
      window.alert(`The EPUB changed on disk. Your edits were saved as:\n${copy.name}`);
      return true;
    }

    const failure = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(failure.message ?? `Docflow could not save the EPUB (${response.status}).`);
  }

  readMetadata<Value>(key: string) {
    return get<Value>(key);
  }

  writeMetadata<Value>(key: string, value: Value) {
    return set(key, value);
  }

  private async readInitialVersion() {
    const response = await fetch(this.resourceUrl, { method: "HEAD", cache: "no-store" });
    if (!response.ok) {
      if (response.status === 410) {
        throw new Error("This EPUB was moved or deleted. Open it with Docflow again to register its new location.");
      }
      throw new Error(`Docflow could not open the document (${response.status}).`);
    }
    const version = stripEtag(response.headers.get("ETag"));
    if (!version) throw new Error("Docflow did not provide a document version.");
    return version;
  }

}

function createDocflowSession() {
  const query = new URLSearchParams(window.location.search);
  const documentId = query.get("docflowDocument");
  if (!documentId) {
    throw new Error("This Docflow viewer URL is missing its document identifier.");
  }
  return new DocflowSession(documentId);
}

const docflow = createDocflowSession();

export function getViewerAssetUrl(filename: string) {
  return new URL(filename, document.baseURI).href;
}

export async function ensureSourceAccess() {
  return true;
}

export function getInitialSourceUrl() {
  return docflow.resourceUrl;
}

export function saveDocflowBlob(blob: Blob) {
  return docflow.save(blob);
}

export function readViewerMetadata<Value>(key: string) {
  return docflow.readMetadata<Value>(key);
}

export function writeViewerMetadata<Value>(key: string, value: Value) {
  return docflow.writeMetadata(key, value);
}
