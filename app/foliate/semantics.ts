const EPUB_NAMESPACE = "http://www.idpf.org/2007/ops";
const processedDocuments = new WeakSet<Document>();
const MEDIA_PARENT_TAGS = new Set(["a", "div", "p", "figure", "section", "article", "aside", "li"]);

const EPUB_ROLE_TYPES = {
  caption: new Set(["caption", "credit"]),
  heading: new Set(["title", "subtitle"]),
  note: new Set(["note", "footnote", "endnote", "rearnote", "sidebar", "annotation", "z3998:annotation"]),
} as const;

const CLASS_ROLE_FRAGMENTS = {
  caption: ["caption", "legend", "credit"],
  figure: ["figure", "illustration", "image"],
  heading: ["title", "heading", "chapter"],
  mono: ["code", "source", "program", "verbatim", "mono"],
  note: ["note", "annotation", "comment", "remark", "sidebar"],
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
  const className = element.getAttribute("class")?.toLowerCase() ?? "";
  const epubTypes = new Set(getEpubType(element).toLowerCase().split(/\s+/u).filter(Boolean));

  if (tagName === "figcaption" || tagName === "caption") addReaderRole(element, "caption");
  if (tagName === "figure") addReaderRole(element, "figure");
  if (element.getAttribute("role")?.split(/\s+/u).includes("heading")) addReaderRole(element, "heading");
  if (hasEpubRole(epubTypes, "caption")) addReaderRole(element, "caption");
  if (hasEpubRole(epubTypes, "heading")) addReaderRole(element, "heading");
  if (hasEpubRole(epubTypes, "note")) addReaderRole(element, "note");
  if (hasParagraphClass(className)) addReaderRole(element, "paragraph");

  const classRoles = Object.entries(CLASS_ROLE_FRAGMENTS)
    .filter(([, fragments]) => fragments.some((fragment) => className.includes(fragment)))
    .map(([role]) => role);
  if (classRoles.includes("caption")) addReaderRole(element, "caption");
  if (classRoles.includes("note")) addReaderRole(element, "note");
  for (const role of classRoles) {
    if (role === "caption" || role === "note") continue;
    if (isSuppressedClassRole(element, role)) continue;
    addReaderRole(element, role);
  }

  if (tagName === "img" || tagName === "video" || (tagName === "svg" && !element.closest("mjx-container"))) {
    markMediaBlock(element);
  }
}

function isSuppressedClassRole(element: Element, role: string) {
  const roles = new Set(element.getAttribute("data-reader-role")?.split(/\s+/u).filter(Boolean));
  if (roles.has("caption")) return role !== "caption";
  if (roles.has("note")) return role === "heading" || role === "figure" || role === "mono" || role === "sans" || role === "table";
  return false;
}

function hasEpubRole(types: Set<string>, role: keyof typeof EPUB_ROLE_TYPES) {
  for (const type of EPUB_ROLE_TYPES[role] as ReadonlySet<string>) {
    if (types.has(type)) return true;
  }
  return false;
}

function hasParagraphClass(className: string) {
  return className.split(/\s+/u).includes("para")
    || ["para-", "paragraph", "bodytext", "body-text"].some((fragment) => className.includes(fragment));
}

function addReaderRole(element: Element, role: string) {
  const roles = new Set(element.getAttribute("data-reader-role")?.split(/\s+/u).filter(Boolean));
  roles.add(role);
  element.setAttribute("data-reader-role", Array.from(roles).join(" "));
}

function markMediaBlock(media: Element) {
  const parent = media.parentElement;
  if (!parent || !MEDIA_PARENT_TAGS.has(parent.localName)) return;

  const block = parent.localName === "a" ? parent.parentElement : parent;
  if (block && MEDIA_PARENT_TAGS.has(block.localName)) block.setAttribute("data-reader-media-block", "true");
}

export function getEpubType(element: Element) {
  return element.getAttributeNS(EPUB_NAMESPACE, "type")
    || element.getAttribute("epub:type")
    || "";
}
