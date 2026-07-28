import { get, set } from "idb-keyval";
import { openExternal } from "./external";
import { createBundledReaderProfile } from "./reader-profile";
import type { ReaderHighlight } from "../reader";
import type {
  EpubFileHandle,
  PlatformDocument,
  ViewerPlatform,
} from "./types";

type WriteResponse = {
  version: string;
};

type ConflictResponse = {
  message?: string;
};

type CopyResponse = {
  name: string;
};

type AnnotationPayload = {
  highlights: readonly ReaderHighlight[];
};

function stripEtag(value: string | null) {
  return value?.trim().replace(/^"|"$/g, "") ?? "";
}

function filenameFromDisposition(value: string | null) {
  const encoded = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Fall through to the quoted filename.
    }
  }
  return value?.match(/filename="([^"]*)"/i)?.[1]?.replace(/[\r\n]/g, "") || "book.epub";
}

class DocflowSession implements EpubFileHandle {
  readonly resourceUrl: string;
  name = "book.epub";
  private version = "";

  constructor(documentId: string) {
    this.resourceUrl = new URL(
      `/api/documents/${encodeURIComponent(documentId)}`,
      window.location.origin,
    ).href;
  }

  async openDocument(): Promise<PlatformDocument> {
    const response = await fetch(this.resourceUrl, { method: "HEAD", cache: "no-store" });
    if (!response.ok) {
      if (response.status === 410) {
        throw new Error("This EPUB was moved or deleted. Open it with Docflow again to register its new location.");
      }
      throw new Error(`Docflow could not open the document (${response.status}).`);
    }

    this.version = stripEtag(response.headers.get("ETag"));
    if (!this.version) throw new Error("Docflow did not provide a document version.");
    this.name = filenameFromDisposition(response.headers.get("Content-Disposition"));

    return {
      input: this.resourceUrl,
      sourceUrl: this.resourceUrl,
      key: `docflow:${this.resourceUrl}`,
      name: this.name,
      sourceLabel: this.name,
      fileHandle: this,
    };
  }

  async prepareWrite() {
    if (!this.version) await this.openDocument();
    return {
      saveAnnotations: (highlights: readonly ReaderHighlight[]) => this.saveAnnotations({ highlights }),
    };
  }

  private async saveAnnotations(payload: AnnotationPayload) {
    const response = await fetch(`${this.resourceUrl}/annotations`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${this.version}"`,
      },
      body: JSON.stringify(payload),
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

      const copyResponse = await fetch(`${this.resourceUrl}/annotations/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!copyResponse.ok) {
        throw new Error(`Docflow could not save an EPUB conflict copy (${copyResponse.status}).`);
      }
      const copy = await copyResponse.json() as CopyResponse;
      window.alert(`The EPUB changed on disk. Your edits were saved as:\n${copy.name}`);
      return true;
    }

    const failure = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(failure.message ?? `Docflow could not save EPUB annotations (${response.status}).`);
  }
}

function createDocflowSession() {
  const documentId = new URLSearchParams(window.location.search).get("docflowDocument");
  return documentId ? new DocflowSession(documentId) : null;
}

const docflow = createDocflowSession();

export const platform: ViewerPlatform = {
  readerProfile: createBundledReaderProfile(
    (filename) => new URL(filename, document.baseURI).href,
    16,
  ),
  translationModelPolicy: "allow-download",
  async loadInitialDocument() {
    if (!docflow) {
      throw new Error("This Docflow viewer URL is missing its document identifier.");
    }
    return docflow.openDocument();
  },
  openExternal,
  readViewerMetadata: get,
  writeViewerMetadata: set,
};
