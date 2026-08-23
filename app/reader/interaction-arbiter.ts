export type ReaderPointerIntent = "control" | "link" | "highlight" | "image" | "content";
const pointerOwners = new WeakMap<Document, Map<number, ReaderPointerIntent>>();

export function eventTargetElement(target: EventTarget | null) {
  return target && (target as Node).nodeType === Node.ELEMENT_NODE
    ? target as Element
    : null;
}

/** Resolves one semantic owner before gesture-specific listeners take action. */
export function resolveReaderPointerIntent(
  target: EventTarget | null,
): ReaderPointerIntent {
  const element = eventTargetElement(target);
  if (!element) return "content";
  if (element.closest(
    "button, input, select, textarea, label, summary, audio[controls], video[controls], object, embed, "
      + "[role='button'], [role='checkbox'], [role='menuitem'], [role='option'], [role='radio'], "
      + "[role='slider'], [role='switch'], [role='tab'], [contenteditable='true'], [onclick], "
      + "[tabindex]:not([tabindex='-1'])",
  )) return "control";
  if (element.closest("a[href]")) return "link";
  if (element.closest("[data-reader-interaction='highlight'], [data-reader-annotation-badge]")) return "highlight";
  if (element.closest("img.reader-zoomable-image")) return "image";
  return "content";
}

type ReaderEventPropagation = "none" | "stop" | "immediate";

/** Applies the routing decision in one place after an input owner accepts an event. */
export function consumeReaderEvent(event: Event, propagation: ReaderEventPropagation = "none") {
  if (event.cancelable) event.preventDefault();
  if (propagation === "immediate") event.stopImmediatePropagation();
  else if (propagation === "stop") event.stopPropagation();
}

function pointerDocument(event: PointerEvent) {
  const target = eventTargetElement(event.target);
  return target?.ownerDocument ?? document;
}

export function claimReaderPointer(event: PointerEvent, owner = resolveReaderPointerIntent(event.target)) {
  const doc = pointerDocument(event);
  let owners = pointerOwners.get(doc);
  if (!owners) {
    owners = new Map();
    pointerOwners.set(doc, owners);
  }
  owners.set(event.pointerId, owner);
  return owner;
}

export function consumeReaderPointerClaim(event: PointerEvent) {
  const doc = pointerDocument(event);
  const owners = pointerOwners.get(doc);
  const owner = owners?.get(event.pointerId);
  owners?.delete(event.pointerId);
  if (owners && !owners.size) pointerOwners.delete(doc);
  return owner;
}
