const preparedDocuments = new WeakSet<Document>();
const MIN_ZOOMABLE_IMAGE_SIZE = 160;

/** Applies image classes that can affect section layout before measurement. */
export function prepareImages(doc: Document, signal: AbortSignal) {
  if (preparedDocuments.has(doc)) return;
  preparedDocuments.add(doc);

  for (const image of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (isContentImage(image)) image.classList.add("reader-content-image");
    if (image.complete) prepareZoomableImageLayout(image);
    else image.addEventListener("load", () => prepareZoomableImageLayout(image), {
      once: true,
      signal,
    });
  }
}

export function isZoomableImage(image: HTMLImageElement) {
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  if (image.closest("a[href]")) return false;
  if (image.closest("button, input, label, summary")) return false;

  const style = image.ownerDocument.defaultView?.getComputedStyle(image);
  const renderedWidth = Number.parseFloat(style?.width ?? "");
  const renderedHeight = Number.parseFloat(style?.height ?? "");
  if (renderedWidth > 0 && renderedHeight > 0
    && renderedWidth < MIN_ZOOMABLE_IMAGE_SIZE && renderedHeight < MIN_ZOOMABLE_IMAGE_SIZE) {
    return false;
  }

  const knownWidth = image.naturalWidth || image.width;
  const knownHeight = image.naturalHeight || image.height;
  if (!knownWidth || !knownHeight) return false;
  if (knownWidth < MIN_ZOOMABLE_IMAGE_SIZE && knownHeight < MIN_ZOOMABLE_IMAGE_SIZE) {
    return false;
  }
  return true;
}

function prepareZoomableImageLayout(image: HTMLImageElement) {
  if (isZoomableImage(image)) image.classList.add("reader-content-image");
}

function isContentImage(image: HTMLImageElement) {
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  return Boolean(image.closest("figure, [data-reader-role~='figure'], [data-reader-media-block='true']"));
}
