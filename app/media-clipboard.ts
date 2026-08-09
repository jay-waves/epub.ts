const PNG_MIME_TYPE = "image/png";
const SVG_MIME_TYPE = "image/svg+xml";
const SVG_COPY_PADDING_RATIO = 0.015;
const SVG_RASTER_SCALE = 2;

export async function copyReaderMedia(element: Element) {
  if (element.localName === "svg") {
    await copySvg(element);
    return;
  }
  if (element.localName === "img") {
    await writeClipboardImage(renderImageElement(element as HTMLImageElement));
  }
}

async function copySvg(element: Element) {
  const bounds = element.getBoundingClientRect();
  const source = element.cloneNode(true) as SVGSVGElement;
  const geometry = getSvgCopyGeometry(element as SVGSVGElement, bounds);

  source.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  source.setAttribute("viewBox", geometry.viewBox);
  source.setAttribute("width", String(geometry.width));
  source.setAttribute("height", String(geometry.height));
  const color = element.ownerDocument.defaultView?.getComputedStyle(element).color;
  if (color) source.style.color = color;
  const blob = new Blob([new XMLSerializer().serializeToString(source)], { type: SVG_MIME_TYPE });
  const png = renderSvgBlob(blob, geometry.width, geometry.height);

  if (ClipboardItem.supports?.(SVG_MIME_TYPE)) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        [PNG_MIME_TYPE]: png,
        [SVG_MIME_TYPE]: blob,
      })]);
      return;
    } catch {
      // Some platforms advertise SVG support but reject the clipboard format.
    }
  }

  await writeClipboardImage(png);
}

function getSvgCopyGeometry(element: SVGSVGElement, bounds: DOMRect) {
  const viewBox = element.viewBox.baseVal;
  const original = viewBox.width > 0 && viewBox.height > 0
    ? { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height }
    : {
        x: 0,
        y: 0,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
      };
  let content = original;

  try {
    const box = element.getBBox();
    if (box.width > 0 && box.height > 0) {
      const padding = box.height * SVG_COPY_PADDING_RATIO;
      content = {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + 2 * padding,
        height: box.height + 2 * padding,
      };
    }
  } catch {
    // Keep the original view box when the embedded SVG cannot expose its bounds.
  }

  const width = Math.max(1, Math.ceil(content.width * bounds.width / original.width));
  const height = Math.max(1, Math.ceil(content.height * bounds.height / original.height));
  return {
    height,
    viewBox: `${content.x} ${content.y} ${content.width} ${content.height}`,
    width,
  };
}

async function writeClipboardImage(blob: Promise<Blob>) {
  await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME_TYPE]: blob })]);
}

async function renderImageElement(image: HTMLImageElement) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("The image has no copyable dimensions.");
  return renderToPng(image, width, height);
}

async function renderSvgBlob(blob: Blob, width: number, height: number) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await renderToPng(
      image,
      Math.ceil(width * SVG_RASTER_SCALE),
      Math.ceil(height * SVG_RASTER_SCALE),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderToPng(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is not available.");
  context.drawImage(source, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode the copied image."));
    }, PNG_MIME_TYPE);
  });
}
