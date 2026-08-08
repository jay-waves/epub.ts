import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

type HighlightJs = typeof hljs;
const enhancedDocuments = new WeakSet<Document>();
const languages = {
  bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin,
  markdown, plaintext, python, rust, sql, typescript, xml, yaml,
};

for (const [name, language] of Object.entries(languages)) {
  hljs.registerLanguage(name, language);
}

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
  const source = extractCodeBlockText(block);
  if (!source.trim()) return;

  const target = resolveCodeBlockTarget(block);
  const language = resolveHighlightLanguage(block, target, hljs);
  const result = language
    ? hljs.highlight(source, { ignoreIllegals: true, language })
    : hljs.highlightAuto(source);

  block.innerHTML = result.value;
  block.classList.add("hljs");
}

function extractCodeBlockText(block: HTMLElement) {
  const target = resolveCodeBlockTarget(block);
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

function resolveHighlightLanguage(block: HTMLElement, codeElement: HTMLElement, highlighter: HighlightJs) {
  const candidates = [
    codeElement.getAttribute("data-language"),
    block.getAttribute("data-language"),
    codeElement.className,
    block.className,
  ].filter(Boolean) as string[];

  for (const value of candidates) {
    const language = extractLanguageCandidate(value, highlighter);
    if (language) return language;
  }
  return undefined;
}

function extractLanguageCandidate(value: string, highlighter: HighlightJs) {
  const normalized = value.toLowerCase();
  for (const match of normalized.matchAll(/(?:language-|lang-)([a-z0-9_+#-]+)/giu)) {
    const candidate = match[1];
    if (candidate && highlighter.getLanguage(candidate)) return candidate;
  }

  for (const token of normalized.split(/\s+/u)) {
    const candidate = token.replace(/^[^a-z0-9]+|[^a-z0-9+#-]+$/giu, "");
    if (candidate && highlighter.getLanguage(candidate)) return candidate;
  }
  return undefined;
}
