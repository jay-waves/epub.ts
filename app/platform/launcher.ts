import { get, set } from "idb-keyval";
import { openExternal } from "./external";
import { createBundledReaderProfile } from "./reader-profile";
import type { ReaderHighlight } from "../epub/annotations";
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

class EpubLauncherSession implements EpubFileHandle {
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
        throw new Error("This EPUB was moved or deleted. Open it with EPUB.ts again to register its new location.");
      }
      throw new Error(`EPUB.ts could not open the document (${response.status}).`);
    }

    this.version = stripEtag(response.headers.get("ETag"));
    if (!this.version) throw new Error("EPUB.ts did not provide a document version.");
    this.name = filenameFromDisposition(response.headers.get("Content-Disposition"));

    return {
      input: this.resourceUrl,
      sourceUrl: this.resourceUrl,
      key: `epub.ts:${this.resourceUrl}`,
      name: this.name,
      sourceLabel: this.name,
      fileHandle: this,
    };
  }

  async prepareWrite() {
    if (!this.version) await this.openDocument();
    return {
      saveAnnotations: (highlights: readonly ReaderHighlight[]) => this.saveAnnotations(highlights),
    };
  }

  private async saveAnnotations(highlights: readonly ReaderHighlight[]) {
    const body = JSON.stringify({ highlights });
    const response = await fetch(`${this.resourceUrl}/annotations`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${this.version}"`,
      },
      body,
    });
    if (response.ok) {
      const result = await response.json() as WriteResponse;
      this.version = result.version;
      return true;
    }

    if (response.status === 409) {
      const conflict = await response.json().catch(() => ({})) as ConflictResponse;
      const shouldSaveCopy = window.confirm(
        `${conflict.message ?? "This EPUB was modified by another program or launcher window."}\n\n`
        + "The original will not be overwritten. Save your changes as a conflict copy beside it?",
      );
      if (!shouldSaveCopy) return false;

      const copyResponse = await fetch(`${this.resourceUrl}/annotations/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!copyResponse.ok) {
        throw new Error(`EPUB.ts could not save an EPUB conflict copy (${copyResponse.status}).`);
      }
      const copy = await copyResponse.json() as CopyResponse;
      window.alert(`The EPUB changed on disk. Your edits were saved as:\n${copy.name}`);
      return true;
    }

    const failure = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(failure.message ?? `EPUB.ts could not save EPUB annotations (${response.status}).`);
  }
}

function createEpubLauncherSession() {
  const documentId = new URLSearchParams(window.location.search).get("launcherDocument");
  return documentId ? new EpubLauncherSession(documentId) : null;
}

const launcher = createEpubLauncherSession();

function getViewerAssetUrl(filename: string) {
  const url = new URL(filename, document.baseURI);
  url.searchParams.set("v", `${__EPUB_TS_VERSION__}-${__EPUB_TS_BUILD_TIME__}`);
  return url.href;
}

export const platform: ViewerPlatform = {
  readerProfile: createBundledReaderProfile(getViewerAssetUrl, 16),
  translationModelPolicy: "allow-download",
  async loadInitialDocument() {
    if (!launcher) {
      throw new Error("This EPUB.ts viewer URL is missing its document identifier.");
    }
    return launcher.openDocument();
  },
  openExternal,
  readViewerMetadata: get,
  writeViewerMetadata: set,
};
