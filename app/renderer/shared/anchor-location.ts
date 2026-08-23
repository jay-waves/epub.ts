/** Converts a section-relative fraction to a stable track coordinate. */
export function getFractionTarget(entryOffset: number, entryExtent: number, fraction: number) {
  return entryOffset + fraction * entryExtent;
}

/** Converts a rendered document rect to a stable track coordinate. */
export function getRectTarget(entryOffset: number, mappedStart: number, margin: number) {
  return entryOffset + mappedStart - margin;
}

export function getAnchorTurn(entryOffset: number, anchorOffset: number, turnSize: number) {
  return Math.floor((entryOffset + anchorOffset) / turnSize);
}

type RectTarget = {
  getBoundingClientRect?: () => DOMRect;
  getClientRects?: () => DOMRectList | DOMRect[];
  ownerDocument?: Document | null;
};

function usableRect(rect: DOMRect | undefined): rect is DOMRect {
  return Boolean(rect && Number.isFinite(rect.top) && Number.isFinite(rect.left));
}

/** Resolves elements and ranges, including empty EPUB fragment anchors, to a layout rect. */
export function getAnchorRect(target: RectTarget | null | undefined): DOMRect | undefined {
  if (!target) return undefined;
  const rects = Array.from(target.getClientRects?.() ?? []);
  const rendered = rects.find((rect) => rect.width > 0 || rect.height > 0);
  if (rendered) return rendered;
  if (usableRect(rects[0])) return rects[0];

  const bounds = target.getBoundingClientRect?.();
  if (usableRect(bounds) && (bounds.width > 0 || bounds.height > 0 || bounds.top !== 0 || bounds.left !== 0)) {
    return bounds;
  }

  // Some engines give an empty named anchor no rect at all. Its next rendered
  // element is the closest stable representation of the fragment position.
  const node = target as Node;
  const doc = node.ownerDocument;
  if (!doc || typeof node.nodeType !== "number") return usableRect(bounds) ? bounds : undefined;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = node;
  for (let current = walker.nextNode(), attempts = 0;
    current && attempts < 64;
    current = walker.nextNode(), attempts += 1) {
    const candidate = (current as Element).getBoundingClientRect();
    if (usableRect(candidate) && (candidate.width > 0 || candidate.height > 0)) return candidate;
  }
  return usableRect(bounds) ? bounds : undefined;
}
