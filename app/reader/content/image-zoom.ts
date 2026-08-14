import { consumeReaderInteraction, resolveReaderPointerIntent } from "../interaction-arbiter";

type MediumZoomFactory = typeof import("medium-zoom").default;
type MediumZoomInstance = ReturnType<MediumZoomFactory>;

let mediumZoomReady: Promise<MediumZoomFactory> | null = null;
let readerImageZoom: MediumZoomInstance | null = null;
let activeZoomProxy: HTMLImageElement | null = null;
let imageZoomRunId = 0;
let disposed = false;
const enhancedDocuments = new WeakSet<Document>();
const IMAGE_ZOOM_MARGIN = 28;
const MIN_ZOOMABLE_IMAGE_SIZE = 160;
const MIN_ZOOMED_IMAGE_LONG_EDGE = 320;

export function enhanceImages(doc: Document, signal: AbortSignal) {
  if (enhancedDocuments.has(doc)) return;
  enhancedDocuments.add(doc);

  for (const image of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (isContentImage(image)) image.classList.add("reader-content-image");
    if (image.complete) {
      markZoomableImage(image, signal);
    } else {
      image.addEventListener("load", () => markZoomableImage(image, signal), { once: true, signal });
    }
  }
}

function markZoomableImage(image: HTMLImageElement, signal?: AbortSignal) {
  if (!isZoomableImage(image)) return;
  image.classList.add("reader-content-image");
  image.classList.add("reader-zoomable-image");
  image.addEventListener("click", handleReaderImageClick, { passive: false, signal });
}

function isContentImage(image: HTMLImageElement) {
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  return Boolean(image.closest("figure, [data-reader-role~='figure'], [data-reader-media-block='true']"));
}

function ensureMediumZoom() {
  mediumZoomReady ??= import("medium-zoom").then((module) => module.default);
  return mediumZoomReady;
}

async function ensureReaderImageZoom() {
  if (disposed) return null;
  if (readerImageZoom) return readerImageZoom;

  const mediumZoom = await ensureMediumZoom();
  if (disposed) return null;
  readerImageZoom = mediumZoom({
    background: "color-mix(in srgb, var(--reader-chrome-bg, #fffefd) 72%, rgb(15 23 42) 28%)",
    margin: IMAGE_ZOOM_MARGIN,
    scrollOffset: 24,
  });
  readerImageZoom.on("open", handleImageZoomOpen);
  readerImageZoom.on("closed", handleImageZoomClosed);
  return readerImageZoom;
}

function handleImageZoomOpen() {
  document.body.classList.add("reader-image-zoom-open");
}

function handleImageZoomClosed(event: Event) {
  const proxy = event.target;
  if (proxy instanceof HTMLImageElement) {
    readerImageZoom?.detach(proxy);
    proxy.remove();
    if (activeZoomProxy === proxy) activeZoomProxy = null;
  }
  document.body.classList.remove("reader-image-zoom-open");
}

export async function closeContentOverlays() {
  ++imageZoomRunId;
  const zoom = readerImageZoom;
  const proxy = activeZoomProxy;
  activeZoomProxy = null;
  document.body.classList.remove("reader-image-zoom-open");
  if (!zoom || !proxy) return;

  try {
    await zoom.close();
  } catch {
    // The proxy may already be detached while its document is closing.
  } finally {
    zoom.detach(proxy);
    proxy.remove();
  }
}

export async function disposeContent() {
  disposed = true;
  await closeContentOverlays();
  readerImageZoom?.off("open", handleImageZoomOpen);
  readerImageZoom?.off("closed", handleImageZoomClosed);
  readerImageZoom?.detach();
  readerImageZoom = null;
}

function isZoomableImage(image: HTMLImageElement) {
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

function handleReaderImageClick(event: MouseEvent) {
  if (resolveReaderPointerIntent(event.target) !== "image") return;
  consumeReaderInteraction(event);
  const image = event.currentTarget as HTMLImageElement;
  image.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
  void openReaderImageZoom(image).catch((error) => {
    console.warn("Failed to open reader image zoom.", error);
  });
}

async function openReaderImageZoom(image: HTMLImageElement) {
  const runId = ++imageZoomRunId;
  const zoom = await ensureReaderImageZoom();
  if (!zoom || runId !== imageZoomRunId || !image.isConnected) return;
  const proxy = createReaderImageZoomProxy(image);
  if (!proxy) return;

  if (activeZoomProxy) {
    try {
      readerImageZoom?.detach(activeZoomProxy);
    } catch {
      // The previous proxy may already be detached.
    }
    activeZoomProxy.remove();
  }

  activeZoomProxy = proxy;
  document.body.appendChild(proxy);
  zoom.attach(proxy);
  await ensureImageReady(proxy);
  if (runId !== imageZoomRunId) {
    zoom.detach(proxy);
    proxy.remove();
    if (activeZoomProxy === proxy) activeZoomProxy = null;
    return;
  }
  await zoom.open({ target: proxy });
  if (runId !== imageZoomRunId || activeZoomProxy !== proxy) return;
  enlargeSmallZoomedImage(zoom.getZoomedImage());
}

function enlargeSmallZoomedImage(image: HTMLElement | null) {
  if (!image) return;

  const bounds = image.getBoundingClientRect();
  const longEdge = Math.max(bounds.width, bounds.height);
  if (!bounds.width || !bounds.height || longEdge >= MIN_ZOOMED_IMAGE_LONG_EDGE) return;

  const availableWidth = document.documentElement.clientWidth - IMAGE_ZOOM_MARGIN * 2;
  const availableHeight = document.documentElement.clientHeight - IMAGE_ZOOM_MARGIN * 2;
  const minimumScale = MIN_ZOOMED_IMAGE_LONG_EDGE / longEdge;
  const viewportScale = Math.min(
    availableWidth / bounds.width,
    availableHeight / bounds.height,
  );
  const scale = Math.min(minimumScale, viewportScale);
  if (scale <= 1) return;

  image.style.transform = `${image.style.transform} scale(${scale})`;
}

function createReaderImageZoomProxy(image: HTMLImageElement) {
  const frameElement = image.ownerDocument.defaultView?.frameElement;
  if (!(frameElement instanceof Element)) return null;

  const imageRect = image.getBoundingClientRect();
  const frameRect = frameElement.getBoundingClientRect();
  const proxy = document.createElement("img");
  proxy.src = image.currentSrc || image.src;
  proxy.alt = image.alt;
  proxy.decoding = "async";
  proxy.className = "reader-image-zoom-proxy";
  const imageStyle = getComputedStyle(image);
  Object.assign(proxy.style, {
    position: "fixed",
    top: `${frameRect.top + imageRect.top}px`,
    left: `${frameRect.left + imageRect.left}px`,
    width: `${imageRect.width}px`,
    height: `${imageRect.height}px`,
    maxWidth: "none",
    maxInlineSize: "none",
    pointerEvents: "none",
    margin: "0",
    zIndex: "2147483646",
    borderRadius: imageStyle.borderRadius,
    objectFit: imageStyle.objectFit || "contain",
  });
  return proxy;
}

async function ensureImageReady(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return;

  try {
    await image.decode();
    return;
  } catch {
    // Fall through for browsers or image types decode() cannot resolve.
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      image.removeEventListener("load", handleDone);
      image.removeEventListener("error", handleDone);
    };
    const handleDone = () => {
      cleanup();
      resolve();
    };
    image.addEventListener("load", handleDone, { once: true });
    image.addEventListener("error", handleDone, { once: true });
  });
}
