import type { FoliateViewElement as BaseFoliateViewElement } from "../../foliate-js/view.js";
import { normalizeInlineText } from "../reader";
import type { ReaderHighlight } from "../reader";

export type FoliateViewElement = BaseFoliateViewElement<ReaderHighlight>;

export { Overlay, Overlayer } from "./overlay";
export type {
  FoliateBook,
  BookSection,
  FoliateContent,
  RelocateDetail,
  SearchHit,
  TocItem,
} from "../../foliate-js/view.js";

export async function createFoliateView() {
  await import("../../foliate-js/view.js");
  return document.createElement("foliate-view") as FoliateViewElement;
}

export function normalizeTocHref(href?: string) {
  if (!href) return "";

  try {
    const url = new URL(href, "https://reader.local/");
    return `${url.pathname}${url.hash}`;
  } catch {
    return href.trim();
  }
}

function formatLocalized(value?: string | Record<string, string>) {
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
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectIdentifierCandidates(item, candidates));
  } else if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectIdentifierCandidates(item, candidates));
  }
  return candidates;
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveBookKey(book: FoliateViewElement["book"], fallbackKey: string) {
  const metadata = book?.metadata;
  const stableIdentifier = [
    ...collectIdentifierCandidates(metadata?.identifier),
    ...collectIdentifierCandidates(metadata?.altIdentifier),
  ].map(normalizeInlineText).find(Boolean);

  if (stableIdentifier) return `book:id:${stableIdentifier.toLocaleLowerCase()}`;

  const sections = book?.sections ?? [];
  const fingerprintParts = {
    author: formatContributor(metadata?.author),
    sectionCount: sections.length,
    sectionSignature: sections.slice(0, 4)
      .map((section) => `${String(section.id ?? "")}:${section.size ?? 0}:${section.cfi ?? ""}`)
      .join("|"),
    title: formatLocalized(metadata?.title),
    tocSignature: (book?.toc ?? []).slice(0, 4)
      .map((item) => normalizeTocHref(item.href) || item.label || "")
      .join("|"),
  };
  if (!Object.values(fingerprintParts).some(Boolean)) return fallbackKey;

  return `book:fingerprint:${(await sha256Hex(JSON.stringify(fingerprintParts))).slice(0, 24)}`;
}
