import hljs from "highlight.js/lib/common";

const enhancedDocuments = new WeakSet<Document>();
const MAX_AUTO_HIGHLIGHT_LENGTH = 20_000;
export function highlightReaderCodeBlocks(
  doc: Document,
  codeBlocks: HTMLElement[],
  isCurrent: () => boolean,
) {
  if (!isCurrent() || enhancedDocuments.has(doc)) return;
  enhancedDocuments.add(doc);
  for (const block of codeBlocks) highlightCodeBlock(block);
}

function highlightCodeBlock(block: HTMLElement) {
  const target = resolveCodeBlockTarget(block);
  const source = extractCodeBlockText(target);
  if (!source.trim()) return;

  const language = resolveHighlightLanguage(block, target);
  if (!language && source.length > MAX_AUTO_HIGHLIGHT_LENGTH) return;
  const result = language
    ? hljs.highlight(source, { ignoreIllegals: true, language })
    : hljs.highlightAuto(source);

  target.innerHTML = result.value;
  block.classList.add("hljs");
}

function extractCodeBlockText(target: HTMLElement) {
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

function resolveCodeBlockTarget(block: HTMLElement) {
  if (block.childElementCount !== 1) return block;
  const onlyChild = block.firstElementChild;
  return onlyChild?.tagName === "CODE" ? onlyChild as HTMLElement : block;
}

function resolveHighlightLanguage(block: HTMLElement, codeElement: HTMLElement) {
  const candidates = [
    codeElement.getAttribute("data-language"),
    block.getAttribute("data-language"),
    codeElement.className,
    block.className,
  ].filter(Boolean) as string[];

  for (const value of candidates) {
    const language = extractLanguageCandidate(value);
    if (language) return language;
  }
  return undefined;
}

function extractLanguageCandidate(value: string) {
  const normalized = value.toLowerCase();
  for (const match of normalized.matchAll(/(?:language-|lang-)([a-z0-9_+#-]+)/giu)) {
    const candidate = match[1];
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }

  for (const token of normalized.split(/\s+/u)) {
    const candidate = token.replace(/^[^a-z0-9]+|[^a-z0-9+#-]+$/giu, "");
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }
  return undefined;
}
