import { normalizeInlineText, runWhenIdle } from "../reader";
import { enhanceReaderImages } from "./image-zoom";
import { renderMathDocument } from "./math";
import { getEpubType, markReaderSemantics } from "./semantics";

export { closeReaderContentOverlays, disposeReaderContent } from "./image-zoom";

const footnotesLabeledDocs = new WeakSet<Document>();

export async function prepareReaderContentDocument(doc: Document, options: {
  isCurrent: () => boolean;
}) {
  if (!options.isCurrent()) return;

  markReaderSemantics(doc);
  labelFootnotes(doc);
  await renderMathDocument(doc, options.isCurrent);
  enhanceReaderImages(doc);

  const codeBlocks = prepareReaderCodeBlocks(doc);
  if (!codeBlocks.length) return;
  runWhenIdle(() => {
    if (!options.isCurrent()) return;
    void import("./highlighter")
      .then((module) => module.highlightReaderCodeBlocks(doc, codeBlocks, options.isCurrent))
      .catch((error) => console.warn("Failed to highlight reader code blocks.", error));
  }, 600);
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

function labelFootnotes(doc: Document) {
  if (footnotesLabeledDocs.has(doc)) return;

  const labelsByTargetId = new Map<string, string>();
  Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isNoteref).forEach((anchor, index) => {
    if (anchor.querySelector("img.epub-footnote, img[alt]")) {
      anchor.dataset.readerFootnoteImage = "true";
    }

    const href = anchor.getAttribute("href")?.trim();
    if (!href?.startsWith("#")) return;

    const targetId = decodeURIComponent(href.slice(1));
    const label = normalizeFootnoteLabel(anchor.textContent || anchor.querySelector("img")?.getAttribute("alt") || undefined, index + 1);
    labelsByTargetId.set(targetId, label);
    anchor.dataset.footnoteLabel = label;
  });

  for (const [targetId, label] of labelsByTargetId) {
    const target = doc.getElementById(targetId);
    if (!target) continue;
    target.dataset.readerFootnoteTarget = "true";
    target.dataset.footnoteLabel = label;
  }

  getFootnoteTargets(doc).forEach((element, index) => {
    element.dataset.readerFootnoteTarget = "true";
    element.dataset.footnoteLabel = labelsByTargetId.get(element.id)
      || normalizeFootnoteLabel(element.textContent || undefined, index + 1);
  });

  footnotesLabeledDocs.add(doc);
}
