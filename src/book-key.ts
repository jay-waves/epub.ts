import { normalizeTocHref } from "./toc-controller";
import { normalizeInlineText } from "./text-utils";
import type { FoliateViewElement } from "./viewer-types";

export function formatLocalized(value?: string | Record<string, string>) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const [firstKey] = Object.keys(value);
  return firstKey ? value[firstKey] : "";
}

function formatContributor(
  value?: string | { name?: string | Record<string, string> } | Array<string | { name?: string | Record<string, string> }>,
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => formatContributor(item)).filter(Boolean).join(", ");
  return formatLocalized(value.name);
}

function collectIdentifierCandidates(value: unknown, candidates: string[] = []) {
  if (!value) return candidates;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) candidates.push(normalized);
    return candidates;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectIdentifierCandidates(item, candidates));
    return candidates;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectIdentifierCandidates(item, candidates));
  }
  return candidates;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveBookKey(book: FoliateViewElement["book"], legacyKey: string): Promise<string> {
  const metadata = book?.metadata;
  const identifiers = [
    ...collectIdentifierCandidates(metadata?.identifier),
    ...collectIdentifierCandidates(metadata?.altIdentifier),
  ];
  const stableIdentifier = identifiers
    .map(normalizeInlineText)
    .find(Boolean);

  if (stableIdentifier) {
    return `book:id:${stableIdentifier.toLocaleLowerCase()}`;
  }

  const sections = book?.sections ?? [];
  const sectionSignature = sections
    .slice(0, 4)
    .map((section) => `${String(section.id ?? "")}:${section.size ?? 0}:${section.cfi ?? ""}`)
    .join("|");
  const tocSignature = (book?.toc ?? [])
    .slice(0, 4)
    .map((item) => normalizeTocHref(item.href) || item.label || "")
    .join("|");
  const fingerprintParts = {
    author: formatContributor(metadata?.author),
    sectionCount: sections.length,
    sectionSignature,
    title: formatLocalized(metadata?.title),
    tocSignature,
  };
  const hasFingerprintData = Boolean(
    fingerprintParts.title
      || fingerprintParts.author
      || fingerprintParts.sectionCount
      || fingerprintParts.sectionSignature
      || fingerprintParts.tocSignature,
  );

  if (hasFingerprintData) {
    const fingerprintSource = JSON.stringify(fingerprintParts);
    return `book:fingerprint:${(await sha256Hex(fingerprintSource)).slice(0, 24)}`;
  }

  return legacyKey;
}
