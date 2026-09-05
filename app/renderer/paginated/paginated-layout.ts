/** Geometry for one stable paginated spread. */
type PaginatedColumnGeometry = {
  columnCount: number;
  columnStep: number;
  columnWidth: number;
  gap: number;
  pageSize: number;
};

/** Aligns the anchor's column to the reading edge, limited by the track ends. */
export function getPaginatedAnchorOffset(
  entryOffset: number,
  localOffset: number,
  columnStep: number,
  trackSize: number,
  viewportSize: number,
) {
  const step = Math.max(1, columnStep);
  const column = entryOffset + Math.floor(localOffset / step) * step;
  return Math.max(0, Math.min(Math.max(0, trackSize - viewportSize), column));
}

/** Keeps physical page pitch stable while changing the preferred text width. */
export function getPaginatedColumnGeometry(
  viewportSize: number,
  requestedColumnCount: number,
  preferredColumnWidth: number,
  minimumGap: number,
): PaginatedColumnGeometry {
  // CSS multicol layout quantizes used column sizes, while scroll offsets can
  // retain the fractional width reported by getBoundingClientRect(). Keeping
  // that fraction in the page pitch makes a sub-pixel error accumulate over a
  // long chapter. Use one whole-CSS-pixel page size throughout the layout and
  // navigation coordinate system; flooring also guarantees it never exceeds
  // the physical viewport.
  const pageSize = Math.max(1, Math.floor(viewportSize));
  const columnCount = Math.max(1, Math.floor(requestedColumnCount) || 1);
  const columnStep = pageSize / columnCount;
  const availableWidth = Math.max(1, columnStep - Math.max(0, minimumGap));
  const columnWidth = Math.max(1, Math.min(availableWidth, preferredColumnWidth));
  return {
    columnCount,
    columnStep,
    columnWidth,
    gap: columnStep - columnWidth,
    pageSize,
  };
}
