/** Expands a collapsed cross-frame range enough for reliable client geometry. */
export function uncollapseRange(range: any): any {
  if (!range?.collapsed) return range;
  const { endOffset, endContainer } = range;
  if (endContainer.nodeType === Node.ELEMENT_NODE) {
    const node = endContainer.childNodes[endOffset];
    if (node?.nodeType === Node.ELEMENT_NODE) return node;
    return endContainer;
  }
  if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1);
  else if (endOffset > 1) range.setStart(endContainer, endOffset - 1);
  else return endContainer.parentNode;
  return range;
}

export function setSelectionTarget(target: any, collapse: -1 | 0 | 1) {
  let range: Range | undefined;
  if (target?.startContainer) range = target.cloneRange();
  else if (target?.nodeType) {
    const createdRange = target.ownerDocument.createRange() as Range;
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
