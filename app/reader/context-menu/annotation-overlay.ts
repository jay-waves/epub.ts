import { Overlay } from "../../renderer";
import type { OverlayDrawOptions } from "../../renderer";
import {
  claimReaderPointer,
  consumeReaderEvent,
  consumeReaderPointerClaim,
} from "../interaction-arbiter";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const DEFAULT_COLOR = "var(--reader-annotation-color, #f4c430)";

type AnnotationDrawOptions = OverlayDrawOptions & {
  annotationValue?: string;
  color: string;
  onActivate?: (event: MouseEvent) => void;
  onBadgeClick?: (event: MouseEvent) => void;
  showBadge?: boolean;
};

const createSvgElement = (tagName: string) =>
  document.createElementNS(SVG_NAMESPACE, tagName);

const bindHighlightPointer = (element: SVGElement) => {
  element.addEventListener("pointerdown", (event) => claimReaderPointer(event, "highlight"));
  element.addEventListener("pointercancel", consumeReaderPointerClaim);
  element.addEventListener("pointerup", (event) => {
    queueMicrotask(() => consumeReaderPointerClaim(event));
  });
};

function constrainBadgeToPage(
  root: HTMLElement | undefined, lastRect: DOMRect,
  x: number, y: number, iconSize: number, hitSize: number, gap: number,
) {
  const style = root && root.ownerDocument.defaultView?.getComputedStyle(root);
  if (root && style && style.columnWidth !== "auto" && style.writingMode === "horizontal-tb") {
    // Coordinates belong to the expanded iframe, not the outer browser viewport.
    const pageWidth = root.getBoundingClientRect().width;
    if (pageWidth > 0) {
      const origin = root.getBoundingClientRect().left;
      const pageLeft = origin + Math.floor(((lastRect.left + lastRect.right) / 2 - origin) / pageWidth) * pageWidth;
      const inset = (hitSize - iconSize) / 2 + 2;
      const boundedX = Math.max(pageLeft + inset,
        Math.min(x, pageLeft + pageWidth - iconSize - inset));
      if (boundedX < lastRect.right && boundedX + iconSize > lastRect.left) {
        // Keep the marker outside the selection when the side gutter is too narrow.
        y = lastRect.bottom + gap;
      }
      x = boundedX;
    }
  }
  return { x, y };
}

export function drawAnnotation(
  rects: DOMRectList,
  options: AnnotationDrawOptions = { color: DEFAULT_COLOR },
  range?: Range,
) {
  const group = createSvgElement("g");
  group.append(Overlay.highlight(rects, { color: options.color }));
  if (options.annotationValue && !rangeTouchesLink(range)) {
    const hitTarget = createSvgElement("g");
    hitTarget.setAttribute("data-reader-interaction", "highlight");
    hitTarget.setAttribute("data-reader-highlight-value", options.annotationValue);
    hitTarget.style.cursor = "pointer";
    hitTarget.style.pointerEvents = "all";
    for (const rect of Array.from(rects)) {
      const hitRect = createSvgElement("rect");
      hitRect.setAttribute("x", String(rect.left));
      hitRect.setAttribute("y", String(rect.top));
      hitRect.setAttribute("width", String(rect.width));
      hitRect.setAttribute("height", String(rect.height));
      hitRect.setAttribute("fill", "transparent");
      hitRect.style.pointerEvents = "all";
      hitTarget.append(hitRect);
    }
    bindHighlightPointer(hitTarget);
    const activate = (event: MouseEvent) => {
      consumeReaderEvent(event, "immediate");
      options.onActivate?.(event);
    };
    hitTarget.addEventListener("click", activate);
    hitTarget.addEventListener("contextmenu", activate);
    group.append(hitTarget);
  }

  if (!options.showBadge || rects.length === 0) return group;
  const lastRect = rects.item(rects.length - 1);
  if (!lastRect) return group;

  const iconSize = lastRect.height * 0.68;
  const gap = lastRect.height * 0.2;
  let block = range?.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer as Element : range?.endContainer.parentElement;
  while (block?.parentElement && block.ownerDocument.defaultView?.getComputedStyle(block).display === "inline") {
    block = block.parentElement;
  }
  const blockRect = Array.from(block?.getClientRects() ?? []).find(rect =>
    rect.left <= lastRect.left && rect.right >= lastRect.right
    && rect.top <= lastRect.top && rect.bottom >= lastRect.bottom);
  const rtl = block && block.ownerDocument.defaultView?.getComputedStyle(block).direction === "rtl";
  let iconX = rtl
    ? Math.min(lastRect.left, blockRect?.left ?? lastRect.left) - gap - iconSize
    : Math.max(lastRect.right, blockRect?.right ?? lastRect.right) + gap;
  let iconY = lastRect.top + (lastRect.height - iconSize) / 2;
  const hitSize = Math.max(14, iconSize);
  ({ x: iconX, y: iconY } = constrainBadgeToPage(
    block?.ownerDocument.documentElement, lastRect,
    iconX, iconY, iconSize, hitSize, gap,
  ));
  const hitX = iconX + (iconSize - hitSize) / 2;
  const hitY = iconY + (iconSize - hitSize) / 2;
  const badge = createSvgElement("g");
  if (options.annotationValue) badge.setAttribute("data-reader-annotation-badge", options.annotationValue);
  badge.style.cursor = "pointer";
  badge.style.pointerEvents = "auto";
  bindHighlightPointer(badge);
  badge.addEventListener("click", (event) => {
    consumeReaderEvent(event, "stop");
    options.onBadgeClick?.(event);
  });
  badge.addEventListener("contextmenu", (event) => {
    consumeReaderEvent(event, "immediate");
    options.onActivate?.(event);
  });

  const hitArea = createSvgElement("rect");
  hitArea.setAttribute("x", String(hitX));
  hitArea.setAttribute("y", String(hitY));
  hitArea.setAttribute("width", String(hitSize));
  hitArea.setAttribute("height", String(hitSize));
  hitArea.setAttribute("fill", "transparent");
  hitArea.style.pointerEvents = "all";

  const icon = createSvgElement("svg");
  icon.setAttribute("x", String(iconX));
  icon.setAttribute("y", String(iconY));
  icon.setAttribute("width", String(iconSize));
  icon.setAttribute("height", String(iconSize));
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute(
    "stroke",
    "color-mix(in srgb, var(--reader-comment-color, var(--reader-accent-secondary, #f4c430)) 86%, var(--reader-fg-color, #1f2937))",
  );
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("opacity", "0.9");
  icon.style.pointerEvents = "none";

  const iconPath = createSvgElement("path");
  iconPath.setAttribute(
    "d",
    "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
  );
  icon.append(iconPath);

  badge.append(hitArea, icon);
  group.append(badge);
  return group;
}

function rangeTouchesLink(range?: Range) {
  if (!range) return false;
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.ELEMENT_NODE
    ? container as Element : container.parentElement;
  if (element?.closest("a[href]")) return true;
  return Array.from(element?.querySelectorAll("a[href]") ?? [])
    .some((anchor) => range.intersectsNode(anchor));
}
