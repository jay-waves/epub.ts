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
};

const WORDS_PER_MINUTE = 250;
const CHARS_PER_WORD = 6;

type BookInfoSource = {
  book?: Book;
  sourceLabel: string;
};

export function createBookInfo({ book, sourceLabel }: BookInfoSource): BookInfo {
  if (!book) return { metadataRows: [], statsRows: [], title: "Book information" };

  const metadata = book.metadata;
  const title = formatMetadataValue(metadata?.title) || "Untitled Book";
  const author = formatMetadataValue(metadata?.author);
  const sectionCount = book.sections.length;
  const estimatedWords = estimateWords(book.sections);
  const estimatedMinutes = estimatedWords
    ? Math.max(1, Math.ceil(estimatedWords / WORDS_PER_MINUTE))
    : null;
  const sourcePath = sourceLabel;

  return {
    title,
    subtitle: author || sourcePath || undefined,
    statsRows: compactRows([
      estimatedMinutes ? ["Estimated reading time", formatDuration(estimatedMinutes)] : null,
      estimatedWords ? ["Estimated words", formatNumber(estimatedWords)] : null,
      sectionCount ? ["Sections", formatNumber(sectionCount)] : null,
    ]),
    metadataRows: compactRows([
      ["Title", title],
      ["Author", author],
      ["Publisher", formatMetadataValue(metadata?.publisher)],
      ["Language", formatMetadataValue(metadata?.language)],
      ["Published", formatMetadataValue(metadata?.published)],
      ["Modified", formatMetadataValue(metadata?.modified)],
      ["Identifier", formatMetadataValue(metadata?.identifier)],
      ["Subject", formatMetadataValue(metadata?.subject)],
      ["Source", sourcePath],
      ["epub.ts", `v${__EPUB_TS_VERSION__} · ${formatBuildTime(__EPUB_TS_BUILD_TIME__)}`],
    ]),
  };
}

function formatBuildTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactRows(rows: Array<readonly [label: string, value: string] | null>) {
  return rows.flatMap((row) => row?.[1] ? [{ label: row[0], value: row[1] }] : []);
}

function estimateWords(sections: BookSection[]) {
  const totalSize = sections.reduce(
    (sum, section) => sum + (Number.isFinite(section.size) ? Number(section.size) : 0),
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
