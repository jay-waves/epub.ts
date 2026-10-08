/** Restore shell focus without scrolling or stealing focus from a newer interaction. */
export function focusReaderAfterAction(source?: Element | null) {
  requestAnimationFrame(() => {
    if (source && document.activeElement !== source) {
      if (document.activeElement !== document.body) return;
      if (source.isConnected && !source.matches(":disabled")) return;
    }
    if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
    if (document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    document.getElementById("reader-root")?.focus({ preventScroll: true });
  });
}
