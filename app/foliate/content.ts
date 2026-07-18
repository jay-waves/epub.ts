import type { HighlightJs } from "./highlighter";
import { normalizeInlineText } from "../reader";

type MediumZoomFactory = typeof import("medium-zoom").default;
type MediumZoomInstance = ReturnType<MediumZoomFactory>;

let highlightJsReady: Promise<HighlightJs> | null = null;
let mediumZoomReady: Promise<MediumZoomFactory> | null = null;
let readerImageZoom: MediumZoomInstance | null = null;
let activeZoomProxy: HTMLImageElement | null = null;
let imageZoomRunId = 0;
let readerContentDisposed = false;
const codeEnhancedDocs = new WeakSet<Document>();
const footnotesLabeledDocs = new WeakSet<Document>();
const imagesEnhancedDocs = new WeakSet<Document>();
const cjkSpacingEnhancedDocs = new WeakSet<Document>();
const MIN_ZOOMABLE_IMAGE_SIZE = 160;
const CJK_CHAR_PATTERN = "[\\u2E80-\\u2EFF\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]";
const HALF_WIDTH_WORD_PATTERN = "[A-Za-z0-9]";
const HALF_WIDTH_TRAILING_PATTERN = String.raw`[A-Za-z0-9.,:;!?%\)\]\}]`;
const CJK_TO_HALF_WIDTH_RE = new RegExp(`(${CJK_CHAR_PATTERN})(${HALF_WIDTH_WORD_PATTERN})`, "gu");
const HALF_WIDTH_TO_CJK_RE = new RegExp(`(${HALF_WIDTH_TRAILING_PATTERN})(${CJK_CHAR_PATTERN})`, "gu");
const CJK_SPACING_SKIP_SELECTOR = "script, style";
const MEDIA_SPACING_PARENT_TAGS = new Set(["A", "DIV", "P", "FIGURE", "SECTION", "ARTICLE", "ASIDE", "LI"]);

export async function prepareReaderContentDocument(doc: Document, options: {
  isCurrent: () => boolean;
  interactive?: boolean;
}) {
  if (!options.isCurrent()) return;

  labelFootnotes(doc);
  addCjkHalfWidthSpacing(doc);

  if (options.interactive === false) return;
  beautifyImages(doc);
  await beautifyCodeBlocks(doc);
}

function ensureHighlightJs() {
  highlightJsReady ??= import("./highlighter").then((module) => module.default);
  return highlightJsReady;
}

function ensureMediumZoom() {
  mediumZoomReady ??= import("medium-zoom").then((module) => module.default);
  return mediumZoomReady;
}

async function ensureReaderImageZoom() {
  if (readerContentDisposed) return null;
  if (readerImageZoom) return readerImageZoom;

  const mediumZoom = await ensureMediumZoom();
  if (readerContentDisposed) return null;
  readerImageZoom = mediumZoom({
    background: "color-mix(in srgb, var(--reader-chrome-bg, #fffefd) 72%, rgb(15 23 42) 28%)",
    margin: 28,
    scrollOffset: 24,
  });
  readerImageZoom.on("open", handleImageZoomOpen);
  readerImageZoom.on("closed", handleImageZoomClosed);

  return readerImageZoom;
}

function handleImageZoomOpen() {
  document.body.classList.add("reader-image-zoom-open");
}

function handleImageZoomClosed(event: Event) {
  const proxy = event.target;
  if (proxy instanceof HTMLImageElement) {
    readerImageZoom?.detach(proxy);
    proxy.remove();
    if (activeZoomProxy === proxy) activeZoomProxy = null;
  }
  document.body.classList.remove("reader-image-zoom-open");
}

export async function closeReaderContentOverlays() {
  ++imageZoomRunId;
  const zoom = readerImageZoom;
  const proxy = activeZoomProxy;
  activeZoomProxy = null;
  document.body.classList.remove("reader-image-zoom-open");
  if (!zoom || !proxy) return;

  try {
    await zoom.close();
  } catch {
    // The proxy may already be detached while its document is closing.
  } finally {
    zoom.detach(proxy);
    proxy.remove();
  }
}

export async function disposeReaderContent() {
  readerContentDisposed = true;
  await closeReaderContentOverlays();
  readerImageZoom?.off("open", handleImageZoomOpen);
  readerImageZoom?.off("closed", handleImageZoomClosed);
  readerImageZoom?.detach();
  readerImageZoom = null;
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

function beautifyImages(doc: Document) {
  if (imagesEnhancedDocs.has(doc)) return;
  imagesEnhancedDocs.add(doc);

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>("img")).filter(isZoomableImage);
  if (!images.length) return;

  for (const image of images) {
    image.classList.add("reader-zoomable-image");
    markMediaSpacingBlock(image);
    image.addEventListener("click", handleReaderImageClick, { passive: false });
  }
}

function markMediaSpacingBlock(image: HTMLImageElement) {
  const parent = image.parentElement;
  if (!parent || !MEDIA_SPACING_PARENT_TAGS.has(parent.tagName)) return;

  const block = parent.tagName === "A" && parent.parentElement
    ? parent.parentElement
    : parent;
  if (!MEDIA_SPACING_PARENT_TAGS.has(block.tagName)) return;

  block.dataset.readerMediaBlock = "true";
}

function beautifyCodeBlock(block: HTMLElement, hljs: HighlightJs) {
  const source = extractCodeBlockText(block);
  if (!source.trim()) return;

  const target = resolveCodeBlockTrimTarget(block);
  const language = resolveHighlightLanguage(block, target, hljs);
  const result = language
    ? hljs.highlight(source, { ignoreIllegals: true, language })
    : hljs.highlightAuto(source);

  block.innerHTML = result.value;
  block.classList.add("hljs");
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
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  if (image.closest("a[role~='doc-noteref'], a[epub\\:type~='noteref']")) return false;
  if (image.closest("button, input, label, summary")) return false;

  const knownWidth = image.naturalWidth || image.width;
  const knownHeight = image.naturalHeight || image.height;
  if (knownWidth && knownHeight && knownWidth < MIN_ZOOMABLE_IMAGE_SIZE && knownHeight < MIN_ZOOMABLE_IMAGE_SIZE) return false;

  return true;
}

function handleReaderImageClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  void openReaderImageZoom(event.currentTarget as HTMLImageElement);
}

async function openReaderImageZoom(image: HTMLImageElement) {
  const runId = ++imageZoomRunId;
  const zoom = await ensureReaderImageZoom();
  if (!zoom || runId !== imageZoomRunId || !image.isConnected) return;
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
  if (runId !== imageZoomRunId) {
    zoom.detach(proxy);
    proxy.remove();
    if (activeZoomProxy === proxy) activeZoomProxy = null;
    return;
  }
  await zoom.open({ target: proxy });
}

function createReaderImageZoomProxy(image: HTMLImageElement) {
  const frameElement = image.ownerDocument.defaultView?.frameElement;
  if (!(frameElement instanceof Element)) return null;

  const imageRect = image.getBoundingClientRect();
  const frameRect = frameElement.getBoundingClientRect();
  const proxy = document.createElement("img");
  proxy.src = image.currentSrc || image.src;
  proxy.alt = image.alt;
  proxy.decoding = "async";
  proxy.className = "reader-image-zoom-proxy";
  const imageStyle = getComputedStyle(image);
  Object.assign(proxy.style, {
    position: "fixed",
    top: `${frameRect.top + imageRect.top}px`,
    left: `${frameRect.left + imageRect.left}px`,
    width: `${imageRect.width}px`,
    height: `${imageRect.height}px`,
    maxWidth: "none",
    maxInlineSize: "none",
    pointerEvents: "none",
    margin: "0",
    transform: "translateZ(0)",
    zIndex: "2147483646",
    borderRadius: imageStyle.borderRadius,
    objectFit: imageStyle.objectFit || "contain",
  });

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

function normalizeFootnoteLabel(value: string | undefined, fallbackIndex: number) {
  const marker = value ? normalizeInlineText(value).match(/^\[?(\d+)\]?/)?.[1] : undefined;
  return `[${marker || fallbackIndex}]`;
}

function labelFootnotes(doc: Document) {
  if (footnotesLabeledDocs.has(doc)) return;

  const labelsByTargetId = new Map<string, string>();
  Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isNoteref).forEach((anchor, index) => {
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

function addCjkHalfWidthSpacing(doc: Document) {
  if (cjkSpacingEnhancedDocs.has(doc)) return;
  cjkSpacingEnhancedDocs.add(doc);

  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent?.closest(CJK_SPACING_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    textNode.data = addCjkHalfWidthSpacingToText(textNode.data);
  }
}

function addCjkHalfWidthSpacingToText(value: string) {
  return value
    .replace(CJK_TO_HALF_WIDTH_RE, "$1 $2")
    .replace(HALF_WIDTH_TO_CJK_RE, "$1 $2");
}
