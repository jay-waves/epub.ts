import { Overlay } from "../renderer";
import type { OverlayDrawOptions } from "../renderer";
import {
  claimReaderPointer,
  consumeReaderEvent,
  consumeReaderPointerClaim,
} from "./interaction-arbiter";

export const ANNOTATION_BADGE_SELECTOR = "[data-reader-annotation-badge]";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const DEFAULT_COLOR = "var(--reader-annotation-color, #f4c430)";

export type AnnotationDrawOptions = OverlayDrawOptions & {
  annotationValue?: string;
  color: string;
  hasNote?: boolean;
  onActivate?: (event: MouseEvent) => void;
  onBadgeClick?: (event: MouseEvent) => void;
};

const createSvgElement = (tagName: string) =>
  document.createElementNS(SVG_NAMESPACE, tagName);

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
    hitTarget.addEventListener("pointerdown", (event) => claimReaderPointer(event, "highlight"));
    hitTarget.addEventListener("pointercancel", consumeReaderPointerClaim);
    hitTarget.addEventListener("pointerup", (event) => {
      queueMicrotask(() => consumeReaderPointerClaim(event));
    });
    const activate = (event: MouseEvent) => {
      consumeReaderEvent(event, "immediate");
      options.onActivate?.(event);
    };
    hitTarget.addEventListener("click", activate);
    hitTarget.addEventListener("contextmenu", activate);
    group.append(hitTarget);
  }

  if (!options.hasNote || rects.length === 0) return group;
  const lastRect = rects.item(rects.length - 1);
  if (!lastRect) return group;

  const size = 10;
  const x = Math.max(lastRect.left, lastRect.right - size + 2);
  const y = Math.max(lastRect.top, lastRect.top - 2);
  const badge = createSvgElement("g");
  if (options.annotationValue) badge.setAttribute("data-reader-annotation-badge", options.annotationValue);
  badge.setAttribute("opacity", "0.86");
  badge.style.cursor = "pointer";
  badge.style.pointerEvents = "auto";
  badge.addEventListener("click", (event) => {
    consumeReaderEvent(event, "stop");
    options.onBadgeClick?.(event);
  });
  badge.addEventListener("contextmenu", (event) => consumeReaderEvent(event, "stop"));

  const box = createSvgElement("rect");
  box.setAttribute("x", String(x));
  box.setAttribute("y", String(y));
  box.setAttribute("width", String(size));
  box.setAttribute("height", String(size));
  box.setAttribute("rx", "2.5");
  box.setAttribute("fill", "var(--reader-comment-color, #f4c430)");

  const lineTop = createSvgElement("path");
  lineTop.setAttribute("d", `M${x + 2.4} ${y + 3.3}H${x + 7.6}`);
  lineTop.setAttribute("stroke", "var(--reader-comment-ink, white)");
  lineTop.setAttribute("stroke-linecap", "round");
  lineTop.setAttribute("stroke-width", "1.1");

  const lineBottom = createSvgElement("path");
  lineBottom.setAttribute("d", `M${x + 2.4} ${y + 5.9}H${x + 6.4}`);
  lineBottom.setAttribute("stroke", "var(--reader-comment-ink, white)");
  lineBottom.setAttribute("stroke-linecap", "round");
  lineBottom.setAttribute("stroke-width", "1.1");

  badge.append(box, lineTop, lineBottom);
  group.append(badge);
  queueMicrotask(() => {
    const root = group.parentElement;
    if (!root) return;
    if (options.annotationValue) {
      for (const existing of root.querySelectorAll(ANNOTATION_BADGE_SELECTOR)) {
        if (existing !== badge
          && existing.getAttribute("data-reader-annotation-badge") === options.annotationValue) {
          existing.remove();
        }
      }
    }
    root.append(badge);
  });
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
