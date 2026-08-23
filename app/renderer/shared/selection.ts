/** Expands a collapsed cross-frame range enough for reliable client geometry. */
export function uncollapseRange(target: Node | Range): Node | Range {
  if (!("startContainer" in target) || !target.collapsed) return target;
  const range = target;
  const { endOffset, endContainer } = range;
  if (endContainer.nodeType === Node.ELEMENT_NODE) {
    const node = endContainer.childNodes[endOffset];
    if (node?.nodeType === Node.ELEMENT_NODE) return node;
    return endContainer;
  }
  if (endOffset + 1 < (endContainer.nodeValue?.length ?? 0)) range.setEnd(endContainer, endOffset + 1);
  else if (endOffset > 1) range.setStart(endContainer, endOffset - 1);
  else return endContainer.parentNode ?? endContainer;
  return range;
}

export function setSelectionTarget(
  target: number | Node | Range | null | undefined,
  collapse: -1 | 0 | 1,
) {
  let range: Range | undefined;
  if (typeof target === "object" && target && "startContainer" in target) range = target.cloneRange();
  else if (typeof target === "object" && target?.nodeType && target.ownerDocument) {
    const createdRange = target.ownerDocument.createRange();
    createdRange.selectNode(target);
    range = createdRange;
  }
  if (!range) return;
  const resolvedRange = range;
  const selection = resolvedRange.startContainer.ownerDocument?.defaultView?.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (collapse === -1) resolvedRange.collapse(true);
  else if (collapse === 1) resolvedRange.collapse();
  selection.addRange(resolvedRange);
}
