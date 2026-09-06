import { browserLocalDocumentCapabilities } from "./browser-files";
import { openExternal, createBundledReaderProfile } from "./shared";
import type { ReaderAnnotation } from "../epub/annotation";
import type {
  EpubFileHandle,
  PlatformDocument,
  ViewerPlatform,
} from "./types";
import { startupTrace } from "../startup-trace";

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
    startupTrace.start("launcher-resource-check", {
      method: "HEAD",
      url: this.resourceUrl,
    });
    let response: Response;
    try {
      response = await fetch(this.resourceUrl, { method: "HEAD", cache: "no-store" });
    } catch (error) {
      startupTrace.fail("launcher-resource-check", error, { url: this.resourceUrl });
      throw error;
    }
    startupTrace.complete("launcher-resource-check", {
      contentLengthBytes: Number(response.headers.get("Content-Length")) || undefined,
      status: response.status,
      version: stripEtag(response.headers.get("ETag")) || undefined,
    });
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
      saveAnnotations: (highlights: readonly ReaderAnnotation[]) => this.saveAnnotations(highlights),
    };
  }

  async readMetadata<Value>(key: string): Promise<Value | undefined> {
    const url = new URL(`${this.resourceUrl}/metadata`);
    url.searchParams.set("key", key);
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`EPUB.ts could not read viewer metadata (${response.status}).`);
    const result = await response.json() as { value: Value };
    return result.value;
  }

  async writeMetadata<Value>(key: string, value: Value): Promise<void> {
    const response = await fetch(`${this.resourceUrl}/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!response.ok) throw new Error(`EPUB.ts could not write viewer metadata (${response.status}).`);
  }

  private async saveAnnotations(highlights: readonly ReaderAnnotation[]) {
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
  readerProfile: createBundledReaderProfile(getViewerAssetUrl),
  loadInitialDocument: () => launcher?.openDocument(),
  ...browserLocalDocumentCapabilities,
  openExternal,
  readViewerMetadata: (key) => launcher
    ? launcher.readMetadata(key)
    : Promise.resolve(undefined),
  writeViewerMetadata: (key, value) => launcher
    ? launcher.writeMetadata(key, value)
    : Promise.reject(new Error("The launcher document is unavailable.")),
};
