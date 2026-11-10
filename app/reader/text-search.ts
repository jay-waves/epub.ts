type TextSegment = {
  index: number;
  length: number;
  node: Text;
  segment: string;
};

const SHOW_TEXT = NodeFilter.SHOW_TEXT;

/** Compile locale and query once; document scans share no mutable matching state. */
export function createTextSearch(query: string, locale = "en") {
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
  const needleText = needle.join("");
  function* scan(doc: Document): Generator<Range | null> {
    if (!needle.length) return;
    const window: TextSegment[] = [];
    let candidate = "";
    for (const part of textSegments(doc, segmenter)) {
      if (!part) { yield null; continue; }
      window.push(part);
      candidate += part.segment;
      if (window.length > needle.length) candidate = candidate.slice(window.shift()!.segment.length);
      if (window.length < needle.length || collator.compare(needleText, candidate) !== 0) continue;
      const first = window[0]!;
      const range = doc.createRange();
      range.setStart(first.node, first.index);
      range.setEnd(part.node, part.index + part.length);
      yield range;
    }
  }
  return {
    scan,
    *find(doc: Document): Generator<Range> {
      for (const range of scan(doc)) if (range) yield range;
    },
  };
}

function* textSegments(doc: Document, segmenter: Intl.Segmenter): Generator<TextSegment | null> {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement?.localName;
      return parent === "script" || parent === "style" || node.parentElement?.closest("math")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  let previous = "";
  let processed = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text; // SHOW_TEXT only yields text nodes, including iframe realms.
    for (const part of segmenter.segment(text.data)) {
      // Checkpoints also cover long runs of ignored whitespace/format characters.
      if (++processed % 2048 === 0) yield null;
      const segment = normalizeSegment(part.segment);
      if (!segment || segment === " " && previous === " ") continue;
      previous = segment;
      yield { index: part.index, length: part.segment.length, node: text, segment };
    }
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
