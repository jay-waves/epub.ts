import type { HighlightJs } from "./code-highlighter";
import { normalizeInlineText } from "./text-utils";

type MediumZoomFactory = typeof import("medium-zoom").default;
type MediumZoomInstance = ReturnType<MediumZoomFactory>;

let highlightJsReady: Promise<HighlightJs> | null = null;
let mediumZoomReady: Promise<MediumZoomFactory> | null = null;
let readerImageZoom: MediumZoomInstance | null = null;
let activeZoomProxy: HTMLImageElement | null = null;
const codeEnhancedDocs = new WeakSet<Document>();
const footnotesLabeledDocs = new WeakSet<Document>();
const imagesEnhancedDocs = new WeakSet<Document>();

export function enhanceReaderContent(doc: Document, options: {
  isCurrent: () => boolean;
  runWhenIdle: (callback: () => void, timeout?: number) => void;
}) {
  options.runWhenIdle(() => {
    if (!options.isCurrent()) return;
    void beautifyCodeBlocks(doc);
  }, 250);

  options.runWhenIdle(() => {
    if (!options.isCurrent()) return;
    void beautifyImages(doc);
  }, 400);

  options.runWhenIdle(() => {
    if (!options.isCurrent()) return;
    labelFootnotes(doc);
  }, 1500);
}

function trimCodeBlockTrailingWhitespace(doc: Document) {
  const codeBlocks = doc.querySelectorAll<HTMLElement>("pre");
  for (const block of codeBlocks) {
    trimTrailingWhitespaceFromCodeBlock(block);
  }
}

function ensureHighlightJs() {
  highlightJsReady ??= import("./code-highlighter").then((module) => module.ensureHighlightJs());
  return highlightJsReady;
}

function ensureMediumZoom() {
  mediumZoomReady ??= import("medium-zoom").then((module) => module.default);
  return mediumZoomReady;
}

async function ensureReaderImageZoom() {
  if (readerImageZoom) return readerImageZoom;

  const mediumZoom = await ensureMediumZoom();
  readerImageZoom = mediumZoom({
    background: "color-mix(in srgb, var(--reader-chrome-bg, #fffefd) 72%, rgb(15 23 42) 28%)",
    margin: 28,
    scrollOffset: 24,
  });
  readerImageZoom.on("open", () => {
    document.body.classList.add("reader-image-zoom-open");
  });
  readerImageZoom.on("closed", () => {
    document.body.classList.remove("reader-image-zoom-open");
    activeZoomProxy?.remove();
    activeZoomProxy = null;
  });

  return readerImageZoom;
}

async function beautifyCodeBlocks(doc: Document) {
  if (codeEnhancedDocs.has(doc)) return;
  codeEnhancedDocs.add(doc);

  const codeBlocks = Array.from(doc.querySelectorAll<HTMLElement>("pre"));
  if (!codeBlocks.length) return;

  for (const block of codeBlocks) {
    trimTrailingWhitespaceFromCodeBlock(block);
  }

  const hljs = await ensureHighlightJs();
  for (const block of codeBlocks) {
    beautifyCodeBlock(block, hljs);
  }
}

async function beautifyImages(doc: Document) {
  if (imagesEnhancedDocs.has(doc)) return;
  imagesEnhancedDocs.add(doc);

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>("img")).filter(isZoomableImage);
  if (!images.length) return;

  for (const image of images) {
    applyReaderImageSizing(image);
    image.dataset.readerZoomEnhanced = "true";
    image.dataset.readerZoomable = "true";
    image.addEventListener("click", handleReaderImageClick, { passive: false });
  }
}

function beautifyCodeBlock(block: HTMLElement, hljs: HighlightJs) {
  if (block.dataset.readerCodeEnhanced === "true") return;

  const source = extractCodeBlockText(block);
  if (!source.trim()) {
    block.dataset.readerCodeEnhanced = "true";
    return;
  }

  const target = resolveCodeBlockTrimTarget(block);
  const language = resolveHighlightLanguage(block, target, hljs);
  const result = language
    ? hljs.highlight(source, { ignoreIllegals: true, language })
    : hljs.highlightAuto(source);

  block.innerHTML = result.value;
  block.classList.add("hljs");
  if (result.language) block.dataset.highlightLanguage = result.language;
  block.dataset.readerCodeEnhanced = "true";
}

function extractCodeBlockText(block: HTMLElement) {
  const target = resolveCodeBlockTrimTarget(block);
  const structuralText = collectCodeText(target);
  const renderedText = target.innerText || "";

  return countLineBreaks(renderedText) > countLineBreaks(structuralText)
    ? renderedText
    : structuralText;
}

function collectCodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";

  let output = "";
  for (const child of element.childNodes) output += collectCodeText(child);
  return output;
}

function countLineBreaks(value: string) {
  return value.match(/\n/gu)?.length ?? 0;
}

function trimTrailingWhitespaceFromCodeBlock(block: HTMLElement) {
  const target = resolveCodeBlockTrimTarget(block);
  if (!target) return;

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

function resolveCodeBlockTrimTarget(block: HTMLElement) {
  if (block.childElementCount !== 1) return block;

  const onlyChild = block.firstElementChild;
  if (onlyChild?.tagName !== "CODE") return block;

  return onlyChild as HTMLElement;
}

function resolveHighlightLanguage(block: HTMLElement, codeElement: HTMLElement, hljs: HighlightJs) {
  const candidates = [
    codeElement.getAttribute("data-language"),
    block.getAttribute("data-language"),
    codeElement.className,
    block.className,
  ].filter(Boolean) as string[];

  for (const value of candidates) {
    const language = extractLanguageCandidate(value, hljs);
    if (language) return language;
  }

  return undefined;
}

function extractLanguageCandidate(value: string, hljs: HighlightJs) {
  const normalized = value.toLowerCase();
  const matcher = /(?:language-|lang-)([a-z0-9_+#-]+)/giu;
  for (const match of normalized.matchAll(matcher)) {
    const candidate = match[1];
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }

  for (const token of normalized.split(/\s+/u)) {
    const candidate = token.replace(/^[^a-z0-9]+|[^a-z0-9+#-]+$/giu, "");
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }

  return undefined;
}

function isZoomableImage(image: HTMLImageElement) {
  if (image.dataset.readerZoomEnhanced === "true") return false;
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  if (image.closest("a[role~='doc-noteref'], a[epub\\:type~='noteref']")) return false;
  if (image.closest("button, input, label, summary")) return false;

  const knownWidth = image.naturalWidth || image.width;
  const knownHeight = image.naturalHeight || image.height;
  if (knownWidth && knownHeight && knownWidth < 48 && knownHeight < 48) return false;

  return true;
}

function applyReaderImageSizing(image: HTMLImageElement) {
  image.style.setProperty("width", "auto", "important");
  image.style.setProperty("inline-size", "auto", "important");
  image.style.setProperty("max-width", "66.6667%", "important");
  image.style.setProperty("max-inline-size", "66.6667%", "important");
  image.style.setProperty("height", "auto", "important");
  image.style.setProperty("block-size", "auto", "important");
}

function handleReaderImageClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  void openReaderImageZoom(event.currentTarget as HTMLImageElement);
}

async function openReaderImageZoom(image: HTMLImageElement) {
  const zoom = await ensureReaderImageZoom();
  const proxy = createReaderImageZoomProxy(image);
  if (!proxy) return;

  if (activeZoomProxy) {
    try {
      readerImageZoom?.detach(activeZoomProxy);
    } catch {
      // noop
    }
    activeZoomProxy.remove();
  }

  activeZoomProxy = proxy;
  document.body.appendChild(proxy);
  zoom.attach(proxy);
  await ensureImageReady(proxy);
  await zoom.open({ target: proxy });
}

function createReaderImageZoomProxy(image: HTMLImageElement) {
  const frameElement = image.ownerDocument.defaultView?.frameElement;
  if (!(frameElement instanceof Element)) return null;

  const imageRect = image.getBoundingClientRect();
  const frameRect = frameElement.getBoundingClientRect();
  const proxy = document.createElement("img");
  const source = image.currentSrc || image.src;

  proxy.src = source;
  proxy.alt = image.alt;
  proxy.decoding = "async";
  proxy.className = "reader-image-zoom-proxy";
  proxy.style.position = "fixed";
  proxy.style.top = `${frameRect.top + imageRect.top}px`;
  proxy.style.left = `${frameRect.left + imageRect.left}px`;
  proxy.style.width = `${imageRect.width}px`;
  proxy.style.height = `${imageRect.height}px`;
  proxy.style.maxWidth = "none";
  proxy.style.maxInlineSize = "none";
  proxy.style.pointerEvents = "none";
  proxy.style.margin = "0";
  proxy.style.transform = "translateZ(0)";
  proxy.style.zIndex = "2147483646";
  proxy.style.borderRadius = getComputedStyle(image).borderRadius;
  proxy.style.objectFit = getComputedStyle(image).objectFit || "contain";

  return proxy;
}

async function ensureImageReady(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return;

  try {
    await image.decode();
    return;
  } catch {
    // Fall through to load/error events for browsers or image types decode() cannot resolve.
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      image.removeEventListener("load", handleDone);
      image.removeEventListener("error", handleDone);
    };
    const handleDone = () => {
      cleanup();
      resolve();
    };

    image.addEventListener("load", handleDone, { once: true });
    image.addEventListener("error", handleDone, { once: true });
  });
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

function getEpubType(element: Element) {
  return element.getAttributeNS("http://www.idpf.org/2007/ops", "type")
    || element.getAttribute("epub:type")
    || "";
}

function isNoteref(anchor: HTMLAnchorElement) {
  return getEpubType(anchor).split(/\s+/).includes("noteref")
    || anchor.getAttribute("role")?.split(/\s+/).includes("doc-noteref")
    || false;
}

function getFootnoteReferenceAnchors(doc: Document) {
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isNoteref);
}

function normalizeFootnoteLabel(value: string | undefined, fallbackIndex: number) {
  const marker = value ? normalizeInlineText(value).match(/^\[?(\d+)\]?/)?.[1] : undefined;
  const label = marker || String(fallbackIndex);
  return /^\[.*\]$/.test(label) ? label : `[${label}]`;
}

function labelFootnotes(doc: Document) {
  if (footnotesLabeledDocs.has(doc)) return;

  const labelsByTargetId = new Map<string, string>();
  getFootnoteReferenceAnchors(doc).forEach((anchor, index) => {
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
