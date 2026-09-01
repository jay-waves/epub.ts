import type { Book, BookSection } from "../../renderer";

const MAX_SAMPLE_SECTIONS = 5;
const MAX_SECTION_CHARS = 3_000;
const MAX_SAMPLE_CHARS = 12_000;

function publicationLanguage(book: Book) {
  const value = Array.isArray(book.metadata?.language)
    ? book.metadata.language[0]
    : book.metadata?.language;
  if (!value || value === "und") return undefined;
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function sampleSections(sections: BookSection[]) {
  const available = sections.filter((section) => section.createDocument);
  const linear = available.filter((section) => section.linear !== "no");
  const readable = linear.length ? linear : available;
  const count = Math.min(MAX_SAMPLE_SECTIONS, readable.length);
  if (count < 2) return readable.slice(0, count);
  return Array.from({ length: count }, (_, index) =>
    readable[Math.round(index * (readable.length - 1) / (count - 1))]!,
  );
}

async function sampleBookText(book: Book, signal: AbortSignal) {
  let sample = "";
  for (const section of sampleSections(book.sections)) {
    signal.throwIfAborted();
    const doc = await section.createDocument!();
    const text = (doc.body ?? doc.documentElement).textContent
      ?.replaceAll(/\s+/gu, " ")
      .trim()
      .slice(0, MAX_SECTION_CHARS);
    if (text) sample += `${text}\n`;
    if (sample.length >= MAX_SAMPLE_CHARS) break;
  }
  return sample.slice(0, MAX_SAMPLE_CHARS);
}

/** Detects one publication-wide source language without delaying reader paint. */
export async function detectDocumentLanguage(book: Book, signal: AbortSignal) {
  const fallback = publicationLanguage(book);
  if (!("LanguageDetector" in globalThis)) return fallback;

  let detector: LanguageDetector | undefined;
  try {
    const text = await sampleBookText(book, signal);
    if (!text) return fallback;
    if (await LanguageDetector.availability() === "unavailable") return fallback;
    signal.throwIfAborted();
    detector = await LanguageDetector.create({ signal });
    const [result] = await detector.detect(text, { signal });
    return result && result.detectedLanguage !== "und" && (result.confidence ?? 0) >= 0.45
      ? result.detectedLanguage
      : fallback;
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") {
      console.warn("Could not detect the document language; using EPUB metadata instead.", error);
    }
    return fallback;
  } finally {
    detector?.destroy?.();
  }
}
