type MediumZoomFactory = typeof import("medium-zoom").default;
type MediumZoomInstance = ReturnType<MediumZoomFactory>;

let mediumZoomReady: Promise<MediumZoomFactory> | null = null;
let readerImageZoom: MediumZoomInstance | null = null;
let activeZoomProxy: HTMLImageElement | null = null;
let imageZoomRunId = 0;
let disposed = false;
const enhancedDocuments = new WeakSet<Document>();
const MIN_ZOOMABLE_IMAGE_SIZE = 160;

export function enhanceReaderImages(doc: Document) {
  if (enhancedDocuments.has(doc)) return;
  enhancedDocuments.add(doc);

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>("img")).filter(isZoomableImage);
  for (const image of images) {
    image.classList.add("reader-zoomable-image");
    image.addEventListener("click", handleReaderImageClick, { passive: false });
  }
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
    margin: 28,
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

export async function closeReaderContentOverlays() {
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

export async function disposeReaderContent() {
  disposed = true;
  await closeReaderContentOverlays();
  readerImageZoom?.off("open", handleImageZoomOpen);
  readerImageZoom?.off("closed", handleImageZoomClosed);
  readerImageZoom?.detach();
  readerImageZoom = null;
}

function isZoomableImage(image: HTMLImageElement) {
  if (image.closest("[data-reader-footnote-target='true']")) return false;
  if (image.closest("a[role~='doc-noteref'], a[epub\\:type~='noteref']")) return false;
  if (image.closest("button, input, label, summary")) return false;

  const knownWidth = image.naturalWidth || image.width;
  const knownHeight = image.naturalHeight || image.height;
  if (knownWidth && knownHeight && knownWidth < MIN_ZOOMABLE_IMAGE_SIZE && knownHeight < MIN_ZOOMABLE_IMAGE_SIZE) {
    return false;
  }
  return true;
}

function handleReaderImageClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  void openReaderImageZoom(event.currentTarget as HTMLImageElement);
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
    transform: "translateZ(0)",
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
