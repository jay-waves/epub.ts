import { consumeReaderEvent, resolveReaderPointerIntent } from "./interaction-arbiter";
import { isZoomableImage } from "../typography/enhancers/images";

type MediumZoomFactory = typeof import("medium-zoom").default;
type MediumZoomInstance = ReturnType<MediumZoomFactory>;

let mediumZoomReady: Promise<MediumZoomFactory> | null = null;
let readerImageZoom: MediumZoomInstance | null = null;
let activeZoomProxy: HTMLImageElement | null = null;
let imageZoomRunId = 0;
let disposed = false;
const IMAGE_ZOOM_MARGIN = 28;
const MIN_ZOOMED_IMAGE_LONG_EDGE = 320;

/** Binds zoom behavior after the renderer has laid out and published a section. */
export function bindImageInteractions(doc: Document, signal: AbortSignal) {
  for (const image of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (image.complete) markZoomableImage(image, signal);
    else image.addEventListener("load", () => markZoomableImage(image, signal), {
      once: true,
      signal,
    });
  }
}

function markZoomableImage(image: HTMLImageElement, signal: AbortSignal) {
  if (!isZoomableImage(image)) return;
  image.classList.add("reader-zoomable-image");
  image.addEventListener("click", handleReaderImageClick, { passive: false, signal });
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

function handleReaderImageClick(event: MouseEvent) {
  if (resolveReaderPointerIntent(event.target) !== "image") return;
  consumeReaderEvent(event, "immediate");
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

  if (activeZoomProxy) removeZoomProxy(zoom, activeZoomProxy);

  activeZoomProxy = proxy;
  document.body.appendChild(proxy);
  zoom.attach(proxy);
  try {
    await ensureImageReady(proxy);
    if (runId !== imageZoomRunId) {
      removeZoomProxy(zoom, proxy);
      return;
    }
    await zoom.open({ target: proxy });
    if (runId !== imageZoomRunId || activeZoomProxy !== proxy) return;
    enlargeSmallZoomedImage(zoom.getZoomedImage());
  } catch (error) {
    removeZoomProxy(zoom, proxy);
    throw error;
  }
}

function removeZoomProxy(zoom: MediumZoomInstance, proxy: HTMLImageElement) {
  try {
    zoom.detach(proxy);
  } catch {
    // A concurrent close may already have detached the proxy.
  }
  proxy.remove();
  if (activeZoomProxy === proxy) activeZoomProxy = null;
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
  await image.decode();
}
