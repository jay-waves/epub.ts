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
  private readonly heartbeatUrl: string;
  private readonly initialVersion: Promise<string>;
  private version = "";

  constructor(resourceUrl: string, heartbeatUrl: string) {
    this.resourceUrl = new URL(resourceUrl, window.location.href).href;
    this.heartbeatUrl = new URL(heartbeatUrl, window.location.href).href;
    this.initialVersion = this.readInitialVersion();
    this.startHeartbeat();
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

  private async readInitialVersion() {
    const response = await fetch(this.resourceUrl, { method: "HEAD", cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Docflow could not open the document (${response.status}).`);
    }
    const version = stripEtag(response.headers.get("ETag"));
    if (!version) throw new Error("Docflow did not provide a document version.");
    return version;
  }

  private startHeartbeat() {
    const heartbeat = () => {
      void fetch(this.heartbeatUrl, { method: "POST", cache: "no-store" }).catch(() => {});
    };
    heartbeat();
    window.setInterval(heartbeat, 15_000);
  }
}

export function createDocflowSession() {
  const query = new URLSearchParams(window.location.search);
  const resourceUrl = query.get("docflowResource");
  const heartbeatUrl = query.get("docflowHeartbeat");
  return resourceUrl && heartbeatUrl
    ? new DocflowSession(resourceUrl, heartbeatUrl)
    : null;
}
