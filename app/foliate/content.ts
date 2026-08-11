import { normalizeInlineText } from "../reader";
import { loadReaderDocumentFonts } from "../reader-fonts";
import { enhanceReaderImages } from "./image-zoom";
import { prepareMathRenderer, renderMathDocument } from "./math";
import { getEpubType, markReaderSemantics } from "./semantics";

export { closeReaderContentOverlays, disposeReaderContent } from "./image-zoom";
export { clearMathSvgCache } from "./math";

const footnotesLabeledDocs = new WeakSet<Document>();

export async function prepareReaderContentDocument(doc: Document, options: {
  fontQueries: string[];
  reflowable: boolean;
  signal: AbortSignal;
}) {
  if (options.signal.aborted) return;

  if (!options.reflowable) return;

  markReaderSemantics(doc);
  labelFootnotes(doc);
  enhanceReaderImages(doc, options.signal);

  const codeBlocks = prepareReaderCodeBlocks(doc);
  const fontsReady = loadReaderDocumentFonts(doc, options.fontQueries);
  const mathReady = doc.querySelector('math[display="block"]')
    ? prepareMathRenderer()
    : null;
  const highlighterReady = codeBlocks.length
    ? import("./highlighter")
    : null;

  await fontsReady;
  if (options.signal.aborted) return;

  const isCurrent = () => !options.signal.aborted;

  await Promise.all([
    renderMathDocument(doc, isCurrent, mathReady ?? undefined),
    highlighterReady?.then((highlighter) => {
      highlighter.highlightReaderCodeBlocks(doc, codeBlocks, isCurrent);
    }).catch((error) => {
      console.warn("Failed to load syntax highlighting; keeping the original code blocks.", error);
    }),
  ]);
}

function prepareReaderCodeBlocks(doc: Document) {
  const codeBlocks = Array.from(doc.querySelectorAll<HTMLElement>("pre"));
  for (const block of codeBlocks) trimTrailingWhitespace(block);
  return codeBlocks;
}

function trimTrailingWhitespace(block: HTMLElement) {
  const target = block.childElementCount === 1 && block.firstElementChild?.tagName === "CODE"
    ? block.firstElementChild as HTMLElement
    : block;

  while (target.lastChild?.nodeType === Node.TEXT_NODE) {
    const lastTextNode = target.lastChild as Text;
    const trimmedValue = lastTextNode.data.replace(/(?:\r?\n[^\S\r\n]*)+$/u, "");
    if (trimmedValue === lastTextNode.data) break;
    if (trimmedValue) {
      lastTextNode.data = trimmedValue;
      break;
    }
    target.removeChild(lastTextNode);
  }

  while (target.lastChild?.nodeType === Node.TEXT_NODE && !(target.lastChild as Text).data.trim()) {
    target.removeChild(target.lastChild);
  }
}

function getFootnoteTargets(doc: Document) {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      [
        `aside[epub\\:type~="footnote"]`,
        `aside[epub\\:type~="endnote"]`,
        `aside[epub\\:type~="rearnote"]`,
        `aside[role~="doc-footnote"]`,
        `aside[role~="doc-endnote"]`,
        `li[epub\\:type~="footnote"]`,
        `li[epub\\:type~="endnote"]`,
        `li[epub\\:type~="rearnote"]`,
        `li[role~="doc-footnote"]`,
        `li[role~="doc-endnote"]`,
      ].join(","),
    ),
  );
}

function isNoteref(anchor: HTMLAnchorElement) {
  return getEpubType(anchor).split(/\s+/).includes("noteref")
    || anchor.getAttribute("role")?.split(/\s+/).includes("doc-noteref")
    || false;
}

function normalizeFootnoteLabel(value: string | undefined, fallbackIndex: number) {
  const marker = value ? normalizeInlineText(value).match(/^\[?(\d+)\]?/)?.[1] : undefined;
  return `[${marker || fallbackIndex}]`;
}

function setFootnoteTargetMetadata(element: HTMLElement, label: string) {
  const labelNumber = label.match(/\d+/u)?.[0];
  const leadingNumber = normalizeInlineText(element.textContent ?? "")
    .match(/^[[(]?\s*(\d+)\s*[\])]?/u)?.[1];
  element.dataset.readerFootnoteTarget = "true";
  element.dataset.footnoteLabel = label;
  element.toggleAttribute("data-reader-footnote-generated-label", leadingNumber !== labelNumber);
}

function labelFootnotes(doc: Document) {
  if (footnotesLabeledDocs.has(doc)) return;

  const labelsByTargetId = new Map<string, string>();
  Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isNoteref).forEach((anchor, index) => {
    if (anchor.querySelector("img.epub-footnote, img[alt]")) {
      anchor.dataset.readerFootnoteImage = "true";
    }

    const href = anchor.getAttribute("href")?.trim();
    if (!href?.startsWith("#")) return;

    let targetId = href.slice(1);
    try {
      targetId = decodeURIComponent(targetId);
    } catch {
      // Keep malformed-but-usable fragment identifiers as authored.
    }
    const label = normalizeFootnoteLabel(anchor.textContent || anchor.querySelector("img")?.getAttribute("alt") || undefined, index + 1);
    labelsByTargetId.set(targetId, label);
    anchor.dataset.footnoteLabel = label;
  });

  for (const [targetId, label] of labelsByTargetId) {
    const target = doc.getElementById(targetId);
    if (!target) continue;
    setFootnoteTargetMetadata(target, label);
  }

  getFootnoteTargets(doc).forEach((element, index) => {
    setFootnoteTargetMetadata(
      element,
      labelsByTargetId.get(element.id) || normalizeFootnoteLabel(element.textContent || undefined, index + 1),
    );
  });

  footnotesLabeledDocs.add(doc);
}
