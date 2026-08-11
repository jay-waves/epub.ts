type TextSegment = {
  index: number;
  length: number;
  node: Text;
  segment: string;
};

const SHOW_TEXT = NodeFilter.SHOW_TEXT;

export function* findText(doc: Document, query: string, locale = "en"): Iterable<Range> {
  const nodes = getTextNodes(doc);
  if (!nodes.length || !query) return;

  if (typeof Intl.Segmenter === "function") {
    yield* findWithSegmenter(doc, nodes, query, locale);
  } else {
    yield* findSimple(doc, nodes, query, locale);
  }
}

function getTextNodes(doc: Document) {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement?.localName;
      return parent === "script" || parent === "style" || node.parentElement?.closest("math")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof (doc.defaultView?.Text ?? Text)) nodes.push(node as Text);
  }
  return nodes;
}

function* findWithSegmenter(doc: Document, nodes: Text[], query: string, locale: string) {
  let segmenter: Intl.Segmenter;
  let collator: Intl.Collator;
  try {
    segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
    collator = new Intl.Collator(locale, { sensitivity: "base" });
  } catch {
    segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    collator = new Intl.Collator("en", { sensitivity: "base" });
  }

  const needle = normalizeSegments(segmenter.segment(query));
  if (!needle.length) return;
  const needleText = needle.join("");

  const haystack: TextSegment[] = [];
  for (const node of nodes) {
    for (const part of segmenter.segment(node.data)) {
      const segment = normalizeSegment(part.segment);
      if (!segment || segment === " " && haystack.at(-1)?.segment === " ") continue;
      haystack.push({ index: part.index, length: part.segment.length, node, segment });
    }
  }

  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    const parts = haystack.slice(index, index + needle.length);
    if (collator.compare(needleText, parts.map((part) => part.segment).join("")) !== 0) continue;
    const first = parts[0];
    const last = parts.at(-1);
    if (!first || !last) continue;
    const range = doc.createRange();
    range.setStart(first.node, first.index);
    range.setEnd(last.node, last.index + last.length);
    yield range;
  }
}

function normalizeSegments(segments: Intl.Segments) {
  const normalized: string[] = [];
  for (const part of segments) {
    const segment = normalizeSegment(part.segment);
    if (!segment || segment === " " && normalized.at(-1) === " ") continue;
    normalized.push(segment);
  }
  return normalized;
}

function normalizeSegment(segment: string) {
  if (!/[^\p{Format}]/u.test(segment)) return "";
  return /\s/u.test(segment) ? " " : segment;
}

function* findSimple(doc: Document, nodes: Text[], query: string, locale: string) {
  const text = nodes.map((node) => node.data).join("");
  const haystack = lower(text, locale);
  const needle = lower(query, locale);
  let start = haystack.indexOf(needle);
  while (start >= 0) {
    const end = start + needle.length;
    const startPoint = locate(nodes, start, false);
    const endPoint = locate(nodes, end, true);
    if (startPoint && endPoint) {
      const range = doc.createRange();
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      yield range;
    }
    start = haystack.indexOf(needle, start + 1);
  }
}

function locate(nodes: Text[], position: number, end: boolean) {
  let offset = 0;
  for (const [index, node] of nodes.entries()) {
    const next = offset + node.length;
    if (position < next || end && position === next || index === nodes.length - 1) {
      return { node, offset: Math.max(0, Math.min(node.length, position - offset)) };
    }
    offset = next;
  }
  return undefined;
}

function lower(value: string, locale: string) {
  try {
    return value.toLocaleLowerCase(locale);
  } catch {
    return value.toLocaleLowerCase();
  }
}
