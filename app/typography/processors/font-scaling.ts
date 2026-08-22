const READER_STYLES_SELECTOR = "style[data-reader-book-styles]";
const scaledDocuments = new WeakSet<Document>();

type FontMeasurement = {
  element: HTMLElement;
  size: number;
  parentSize: number;
};

/**
 * Preserves the publisher's computed font-size hierarchy while routing its
 * overall scale through --reader-font-size. Measurements happen without the
 * reader stylesheet so fixed px/pt sizes and relative em/% sizes behave alike.
 */
export function preservePublisherFontScale(doc: Document) {
  if (scaledDocuments.has(doc) || !doc.body || !doc.defaultView) return;
  scaledDocuments.add(doc);

  const readerStyles = Array.from(
    doc.querySelectorAll<HTMLStyleElement>(READER_STYLES_SELECTOR),
  );
  for (const style of readerStyles) style.disabled = true;

  const elements = [doc.body, ...doc.body.querySelectorAll<HTMLElement>("*")];
  const sizes = new Map<HTMLElement, number>();
  const measurements: FontMeasurement[] = [];

  try {
    for (const element of elements) {
      const size = Number.parseFloat(doc.defaultView.getComputedStyle(element).fontSize);
      if (Number.isFinite(size) && size > 0) sizes.set(element, size);
    }

    const bodySize = sizes.get(doc.body);
    if (!bodySize) return;
    measurements.push({ element: doc.body, size: bodySize, parentSize: bodySize });

    for (const element of elements.slice(1)) {
      const size = sizes.get(element);
      const parent = element.parentElement;
      const parentSize = parent ? sizes.get(parent) : undefined;
      if (size && parentSize) measurements.push({ element, size, parentSize });
    }
  } finally {
    for (const style of readerStyles) style.disabled = false;
  }

  for (const { element, size, parentSize } of measurements) {
    const value = element === doc.body
      ? "var(--reader-font-size)"
      : `${Number((size / parentSize * 100).toFixed(5))}%`;
    element.style.setProperty("font-size", value, "important");
  }
}
