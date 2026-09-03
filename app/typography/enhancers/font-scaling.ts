const READER_STYLES_SELECTOR = "style[data-reader-book-styles]";
const scaledDocuments = new WeakSet<Document>();

type FontMeasurement = {
  element: HTMLElement;
  size: number;
};

const MIN_PUBLISHER_FONT_SIZE = "12px";
const MIN_PUBLISHER_FONT_SCALE = 0.72;

/**
 * Preserves the publisher's computed font-size hierarchy while routing its
 * overall scale through --reader-font-size. Each size is anchored directly to
 * the publication body so deeply nested relative sizes do not compound after
 * reader styles are applied. Publisher small text also receives a readable
 * floor. Measurements happen without the reader stylesheet so fixed px/pt
 * sizes and relative em/% sizes behave alike.
 */
export function preservePublisherFontScale(doc: Document) {
  if (scaledDocuments.has(doc) || !doc.body || !doc.defaultView) return;
  scaledDocuments.add(doc);

  const readerStyles = Array.from(
    doc.querySelectorAll<HTMLStyleElement>(READER_STYLES_SELECTOR),
  );
  for (const style of readerStyles) style.disabled = true;

  const elements = [doc.body, ...doc.body.querySelectorAll<HTMLElement>("*")];
  const measurements: FontMeasurement[] = [];
  let bodySize = 0;

  try {
    bodySize = Number.parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize);
    if (!Number.isFinite(bodySize) || bodySize <= 0) return;
    measurements.push({ element: doc.body, size: bodySize });

    for (const element of elements.slice(1)) {
      const size = Number.parseFloat(doc.defaultView.getComputedStyle(element).fontSize);
      if (Number.isFinite(size) && size > 0) measurements.push({ element, size });
    }
  } finally {
    for (const style of readerStyles) style.disabled = false;
  }

  for (const { element, size } of measurements) {
    const scale = Number((size / bodySize).toFixed(5));
    const scaledSize = `calc(var(--reader-font-size) * ${scale})`;
    const value = element === doc.body
      ? "var(--reader-font-size)"
      : scale < 1
        ? `max(${MIN_PUBLISHER_FONT_SIZE}, calc(var(--reader-font-size) * ${MIN_PUBLISHER_FONT_SCALE}), ${scaledSize})`
        : scaledSize;
    element.style.setProperty("font-size", value, "important");
  }
}
