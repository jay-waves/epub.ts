/** A stable reading edge inside one spine section. */
export type ReadingPosition = {
  index: number;
  fraction: number;
  range?: Range;
};

/** A transient navigation request before it is measured as a ReadingPosition. */
export type NavigationAnchor = number | Node | Range;

/** Renderer relocation payload. Physical offsets never cross this boundary. */
export type RelocateDetail = ReadingPosition & {
  reason?: string;
  size: number;
};

export function clampFraction(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : fallback;
}

export function createReadingPosition(
  index: number,
  fraction: number | undefined,
  range?: Range,
): ReadingPosition {
  return { index, fraction: clampFraction(fraction), ...(range ? { range } : {}) };
}

export function rangeBelongsToDocument(range: Range | undefined, doc: Document) {
  if (!range || range.startContainer.ownerDocument !== doc
    || range.endContainer.ownerDocument !== doc) return false;
  return doc.contains(range.startContainer) && doc.contains(range.endContainer);
}

/** Returns an exact anchor only while it still belongs to the same live section. */
export function anchorForPosition(
  position: ReadingPosition | undefined,
  index: number,
  doc: Document,
): NavigationAnchor {
  if (!position || position.index !== index) return 0;
  return rangeBelongsToDocument(position.range, doc)
    ? position.range!.cloneRange()
    : position.fraction;
}

/** Prefer the requested edge while retaining a measured DOM range for CFI/reflow. */
export function resolveReadingPosition(
  measured: ReadingPosition,
  preferred?: Partial<ReadingPosition> & Pick<ReadingPosition, "index">,
) {
  const index = preferred?.index ?? measured.index;
  const range = preferred?.range ?? (measured.index === index ? measured.range : undefined);
  return createReadingPosition(index, preferred?.fraction ?? measured.fraction, range);
}
