import type { Book, BookSection } from "../renderer";
export type BookInfo = {
  metadataRows: BookInfoRow[];
  statsRows: BookInfoRow[];
  subtitle?: string;
  title: string;
};

type BookInfoRow = {
  label: string;
  value: string;
  wide?: boolean;
};

const WORDS_PER_MINUTE = 250;
const CHARS_PER_WORD = 6;

export function createBookInfo(book?: Book): BookInfo {
  if (!book) return { metadataRows: [], statsRows: [], title: "Book information" };

  const metadata = book.metadata;
  const title = formatMetadataValue(metadata?.title) || "Untitled Book";
  const author = formatMetadataValue(metadata?.author);
  const sectionCount = book.sections.length;
  const estimatedWords = estimateWords(book.sections);
  const estimatedMinutes = estimatedWords
    ? Math.max(1, Math.ceil(estimatedWords / WORDS_PER_MINUTE))
    : null;

  return {
    title,
    subtitle: author || undefined,
    statsRows: compactRows([
      estimatedMinutes ? ["Estimated reading time", formatDuration(estimatedMinutes)] : null,
      estimatedWords ? ["Estimated words", formatNumber(estimatedWords)] : null,
      sectionCount ? ["Sections", formatNumber(sectionCount)] : null,
    ]),
    metadataRows: compactRows([
      ["Publisher", formatMetadataValue(metadata?.publisher)],
      ["Language", formatMetadataValue(metadata?.language)],
      ["Published", formatPublishedDate(metadata?.published)],
      ["Modified", formatMetadataValue(metadata?.modified)],
      ["Identifier", formatMetadataValue(metadata?.identifier), true],
      ["Subject", formatMetadataValue(metadata?.subject), true],
    ]),
  };
}

function compactRows(rows: Array<readonly [label: string, value: string, wide?: boolean] | null>) {
  return rows.flatMap((row) => row?.[1]
    ? [{ label: row[0], value: row[1], wide: row[2] || row[1].length > 36 }]
    : []);
}

function formatPublishedDate(value: unknown) {
  const text = formatMetadataValue(value);
  if (!text) return "";
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/u.exec(text)?.[1];
  if (dateOnly) return dateOnly;
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? text
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function estimateWords(sections: BookSection[]) {
  const totalSize = sections.reduce(
    (sum, section) => sum + (Number.isFinite(section.size) ? section.size : 0),
    0,
  );
  return totalSize > 0 ? Math.max(1, Math.round(totalSize / CHARS_PER_WORD)) : null;
}

function formatDuration(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatMetadataValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatMetadataValue).filter(Boolean).join(", ");
  if (typeof value !== "object") return "";

  const values = Object.values(value as Record<string, unknown>);
  const namedValue = "name" in value
    ? formatMetadataValue((value as Record<string, unknown>).name)
    : "";
  return namedValue
    || values.find((item): item is string => typeof item === "string" && Boolean(item.trim()))
    || values.map(formatMetadataValue).filter(Boolean).join(", ");
}
