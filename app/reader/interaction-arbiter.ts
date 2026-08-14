export type ReaderPointerIntent = "control" | "link" | "highlight" | "image" | "content";
const pointerOwners = new Map<number, ReaderPointerIntent>();

function asElement(target: EventTarget | null) {
  return target && (target as Node).nodeType === Node.ELEMENT_NODE
    ? target as Element
    : null;
}

/** Resolves one semantic owner before gesture-specific listeners take action. */
export function resolveReaderPointerIntent(
  target: EventTarget | null,
): ReaderPointerIntent {
  const element = asElement(target);
  if (!element) return "content";
  if (element.closest(
    "button, input, select, textarea, label, summary, audio[controls], video[controls], "
      + "[role='slider'], [contenteditable='true']",
  )) return "control";
  if (element.closest("a[href]")) return "link";
  if (element.closest("[data-reader-interaction='highlight'], [data-reader-annotation-badge]")) return "highlight";
  if (element.closest("img.reader-zoomable-image")) return "image";
  return "content";
}

export function consumeReaderInteraction(event: Event) {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}

export function claimReaderPointer(pointerId: number, owner: ReaderPointerIntent) {
  pointerOwners.set(pointerId, owner);
}

export function consumeReaderPointerClaim(pointerId: number) {
  const owner = pointerOwners.get(pointerId);
  pointerOwners.delete(pointerId);
  return owner;
}
