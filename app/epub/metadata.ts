import type { Book, Contributor, Identifier, LocalizedText } from "../renderer";

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeTocHref(href?: string) {
  if (!href) return "";
  const value = href.trim();
  const base = "https://reader.local/";
  if (!URL.canParse(value, base)) return value;
  const url = new URL(value, base);
  return `${url.pathname}${url.hash}`;
}

function formatLocalized(value?: string | Record<string, string>) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const [firstKey] = Object.keys(value);
  return firstKey ? value[firstKey] : "";
}

function formatContributor(value?: Contributor | Contributor[]): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => formatContributor(item)).filter(Boolean).join(", ");
  return "name" in value
    ? formatLocalized(value.name)
    : formatLocalized(value as LocalizedText);
}

function collectIdentifiers(value: Identifier | Identifier[] | undefined, identifiers: string[] = []) {
  if (!value) return identifiers;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized) identifiers.push(normalized);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectIdentifiers(item, identifiers));
  } else collectIdentifiers(value.value, identifiers);
  return identifiers;
}

async function hash(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getBookKey(book: Book | undefined, fallback: string) {
  const metadata = book?.metadata;
  const identifier = [
    ...collectIdentifiers(metadata?.identifier),
    ...collectIdentifiers(metadata?.altIdentifier),
  ].map(normalizeInlineText).find(Boolean);

  if (identifier) return `book:id:${identifier.toLocaleLowerCase()}`;

  const sections = book?.sections ?? [];
  const fingerprint = {
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
  if (!Object.values(fingerprint).some(Boolean)) return fallback;

  return `book:fingerprint:${(await hash(JSON.stringify(fingerprint))).slice(0, 24)}`;
}
