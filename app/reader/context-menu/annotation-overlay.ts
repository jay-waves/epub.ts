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
  const iconInset = lastRect.height * 0.08;
  const iconX = Math.max(0, lastRect.right - iconSize - iconInset);
  const iconY = lastRect.bottom - iconSize - iconInset;
  const hitSize = 14;
  const hitX = Math.max(0, lastRect.right - Math.min(hitSize, Math.max(lastRect.width, hitSize / 2)));
  const hitY = lastRect.top + (lastRect.height - hitSize) / 2;
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
