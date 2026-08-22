const EPUB_NAMESPACE = "http://www.idpf.org/2007/ops";
const processedDocuments = new WeakSet<Document>();
const MEDIA_PARENT_TAGS = new Set(["a", "div", "p", "figure", "section", "article", "aside", "li"]);
const NOTE_CONTAINER_TAGS = new Set(["aside", "details", "section", "article", "div", "li"]);

const EPUB_ROLE_TYPES = {
  caption: new Set(["caption", "credit"]),
  heading: new Set(["title", "subtitle"]),
  note: new Set(["note", "footnote", "endnote", "rearnote", "sidebar", "annotation", "z3998:annotation"]),
} as const;

const CLASS_ROLE_FRAGMENTS = {
  caption: ["caption", "figcaption", "legend", "credit"],
  figure: ["figure", "illustration", "image"],
  heading: ["title", "heading", "chaptertitle", "sectiontitle"],
  mono: ["code", "codeblock", "source", "sourcecode", "program", "verbatim", "mono"],
  note: ["note", "footnote", "endnote", "rearnote", "sidenote", "annotation", "comment", "remark", "sidebar"],
  quote: ["quote", "blockquote"],
  sans: ["sans"],
  table: ["table"],
} as const;

export function markReaderSemantics(doc: Document) {
  if (processedDocuments.has(doc)) return;
  processedDocuments.add(doc);

  const root = doc.body ?? doc.documentElement;
  for (const element of root.getElementsByTagName("*")) classifyElement(element);
}

function classifyElement(element: Element) {
  const tagName = element.localName.toLowerCase();
  const classTokens = getClassSegments(element);
  const epubTypes = new Set(getEpubType(element).toLowerCase().split(/\s+/u).filter(Boolean));
  const roles = new Set(element.getAttribute("data-reader-role")?.split(/\s+/u).filter(Boolean));

  if (tagName === "figcaption" || tagName === "caption") roles.add("caption");
  if (tagName === "figure") roles.add("figure");
  if (element.getAttribute("role")?.split(/\s+/u).includes("heading")) roles.add("heading");
  if (hasEpubRole(epubTypes, "caption")) roles.add("caption");
  if (hasEpubRole(epubTypes, "heading")) roles.add("heading");
  if (hasEpubRole(epubTypes, "note")) {
    roles.add("note");
    if (["footnote", "endnote", "rearnote"].some((type) => epubTypes.has(type))) roles.add("footnote");
  }
  if (hasParagraphClass(classTokens)) roles.add("paragraph");

  const classRoles = Object.entries(CLASS_ROLE_FRAGMENTS)
    .filter(([, fragments]) => fragments.some((fragment) => classTokens.has(fragment)))
    .map(([role]) => role);
  if (classRoles.includes("caption")) roles.add("caption");
  // Class names such as `_idFootnoteLink` describe an inline reference, not a
  // note container. Only block-like elements participate in this heuristic.
  if (classRoles.includes("note") && NOTE_CONTAINER_TAGS.has(tagName)) roles.add("note");
  if (looksLikeFootnoteEntry(element, tagName, classTokens)) roles.add("footnote");
  for (const role of classRoles) {
    if (role === "caption" || role === "note") continue;
    if (isSuppressedClassRole(roles, role)) continue;
    roles.add(role);
  }
  if (roles.size) element.setAttribute("data-reader-role", Array.from(roles).join(" "));

  if (tagName === "img" || tagName === "video" || (tagName === "svg" && !element.closest("mjx-container"))) {
    markMediaBlock(element);
  }
}

function looksLikeFootnoteEntry(element: Element, tagName: string, classTokens: Set<string>) {
  if (!NOTE_CONTAINER_TAGS.has(tagName)) return false;
  if (classTokens.has("footnote") || classTokens.has("endnote") || classTokens.has("rearnote")) return true;
  if (tagName !== "aside" || !classTokens.has("note") || !classTokens.has("entry")) return false;
  return Boolean(element.querySelector('[id*="footnote" i], [id^="fn" i], [id*="-fn-" i]'));
}

function isSuppressedClassRole(roles: Set<string>, role: string) {
  if (roles.has("caption")) return role !== "caption";
  if (roles.has("note")) return role === "heading" || role === "figure" || role === "mono" || role === "sans" || role === "table";
  return false;
}

function hasEpubRole(types: Set<string>, role: keyof typeof EPUB_ROLE_TYPES) {
  return !types.isDisjointFrom(EPUB_ROLE_TYPES[role]);
}

function getClassSegments(element: Element) {
  const segments = new Set<string>();
  for (const token of element.classList) {
    const normalized = token.replace(/([a-z\d])([A-Z])/gu, "$1-$2").toLowerCase();
    segments.add(normalized);
    for (const segment of normalized.split(/[-_:]+/u)) {
      if (segment) segments.add(segment);
    }
  }
  return segments;
}

function hasParagraphClass(classTokens: Set<string>) {
  return ["para", "paragraph", "bodytext", "body-text"].some((token) => classTokens.has(token));
}

function markMediaBlock(media: Element) {
  const parent = media.parentElement;
  if (!parent || !MEDIA_PARENT_TAGS.has(parent.localName)) return;

  const block = parent.localName === "a" && containsOnlyMedia(parent)
    ? parent.parentElement
    : parent;
  if (!block || !MEDIA_PARENT_TAGS.has(block.localName)) return;
  const roles = block.getAttribute("data-reader-role")?.split(/\s+/u) ?? [];
  if (!roles.includes("figure") && containsOnlyMedia(block)) {
    block.setAttribute("data-reader-media-block", "true");
  }
}

function containsOnlyMedia(element: Element): boolean {
  return Array.from(element.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return true;

    const child = node as Element;
    if (["img", "svg", "video"].includes(child.localName)) return true;
    return child.localName === "a" && containsOnlyMedia(child);
  });
}

export function getEpubType(element: Element) {
  return element.getAttributeNS(EPUB_NAMESPACE, "type")
    || element.getAttribute("epub:type")
    || "";
}
