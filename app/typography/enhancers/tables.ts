const OVERSIZED_ROW_ATTRIBUTE = "data-reader-oversized-row";

export function enhanceTables(doc: Document, paginated: boolean, signal: AbortSignal) {
  const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>(
    ':is(table, [data-reader-role~="table"]) tr',
  ));
  if (!rows.length) return;

  if (!paginated) return;

  let frame = 0;
  const scan = () => {
    frame = 0;
    if (signal.aborted) return;
    const root = doc.documentElement;
    const vertical = doc.defaultView?.getComputedStyle(root).writingMode.startsWith("vertical") ?? false;
    const availableBlockSize = vertical ? root.clientWidth : root.clientHeight;
    if (!availableBlockSize) return;
    for (const row of rows) {
      if (row.hasAttribute(OVERSIZED_ROW_ATTRIBUTE)) continue;
      const rect = row.getBoundingClientRect();
      const rowBlockSize = vertical ? rect.width : rect.height;
      if (rowBlockSize > availableBlockSize) row.setAttribute(OVERSIZED_ROW_ATTRIBUTE, "");
    }
  };
  const scheduleScan = () => {
    if (!frame) frame = doc.defaultView?.requestAnimationFrame(scan) ?? 0;
  };
  const observer = new ResizeObserver(scheduleScan);
  observer.observe(doc.documentElement);
  scheduleScan();
  signal.addEventListener("abort", () => {
    observer.disconnect();
    if (frame) doc.defaultView?.cancelAnimationFrame(frame);
  }, { once: true });
}
