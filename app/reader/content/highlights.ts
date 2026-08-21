import { Overlay } from "../../renderer";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../../viewer-events";
import {
  getSavedHighlights,
  setSavedHighlights,
} from "../../viewer-storage";
import type { HighlightContextAction } from "../context-menu-store";
import { contextMenuStore } from "../context-menu-store";
import type { ReaderHighlight } from "../../epub/annotations";
import {
  claimReaderPointer,
  consumeReaderEvent,
  consumeReaderPointerClaim,
} from "../interaction-arbiter";
import type { Content, OverlayDraw, OverlayDrawOptions } from "../../renderer";
import type { ReaderView } from "../model";
import { createTranslation } from "../translation";
import { copyReaderMedia } from "../media-clipboard";
import type { Navigation } from "../navigation";
import { observeRenderedDocuments } from "../documents";
import { TaskTracker } from "../../shared/async-tasks";

type PointerCoordinateSpace = "content" | "viewport";

type HighlightOptions = {
  getBookKey: () => string;
  getNavigation: () => Navigation | null;
  getProgress: () => number;
  getView: () => ReaderView | null;
  openExternal: (url: string) => void;
  translationModelPolicy: "allow-download" | "external-fallback";
};

type HighlightContext = {
  highlight?: ReaderHighlight;
  media?: Element;
  point?: {
    x: number;
    y: number;
  };
  selection?: {
    index: number;
    range: Range;
    text: string;
    value: string;
  };
} | null;

const ANNOTATION_BADGE_SELECTOR = "[data-reader-annotation-badge]";
const AUTO_HIGHLIGHT_COLOR = "auto";
const LEGACY_HIGHLIGHT_COLOR = "#f4c430";
const THEME_HIGHLIGHT_COLOR = "var(--reader-annotation-color, #f4c430)";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

type HighlightDrawOptions = OverlayDrawOptions & {
  annotationValue?: string;
  color: string;
  hasNote?: boolean;
  onActivate?: (event: MouseEvent) => void;
  onBadgeClick?: (event: MouseEvent) => void;
};

function createSvgElement(tagName: string) {
  return document.createElementNS(SVG_NAMESPACE, tagName);
}

function drawHighlightWithAnnotationBadge(
  rects: DOMRectList,
  options: HighlightDrawOptions = { color: THEME_HIGHLIGHT_COLOR },
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
    hitTarget.addEventListener("pointerdown", (event) => {
      claimReaderPointer(event, "highlight");
    });
    hitTarget.addEventListener("pointercancel", (event) => {
      consumeReaderPointerClaim(event);
    });
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
  badge.addEventListener("contextmenu", (event) => {
    consumeReaderEvent(event, "stop");
  });

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
      const existingBadges = Array.from(root.querySelectorAll(ANNOTATION_BADGE_SELECTOR))
        .filter((item) => item.getAttribute("data-reader-annotation-badge") === options.annotationValue);
      for (const existingBadge of existingBadges) {
        if (existingBadge !== badge) existingBadge.remove();
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
    ? container as Element
    : container.parentElement;
  if (element?.closest("a[href]")) return true;
  return Array.from(element?.querySelectorAll("a[href]") ?? [])
    .some((anchor) => range.intersectsNode(anchor));
}

export function createHighlights(options: HighlightOptions) {
  const viewerEvents = new AbortController();
  let contextView: ReaderView | null = null;
  let stopContextDocuments: (() => void) | null = null;
  let activeContext: HighlightContext = null;
  let currentHighlights: ReaderHighlight[] = [];
  const pendingWrites = new TaskTracker();
  const translation = createTranslation({
    modelPolicy: options.translationModelPolicy,
    openExternal: options.openExternal,
  });
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const track = <Result>(task: Promise<Result>) => {
    return pendingWrites.track(task);
  };

  listenViewerEvent(VIEWER_EVENTS.annotationSave, (detail) => {
    run(track(saveAnnotationNote(detail.value, detail.note)), "Failed to save annotation note.");
  }, { signal: viewerEvents.signal });
  listenViewerEvent(VIEWER_EVENTS.annotationDelete, (detail) => {
    run(track(deleteAnnotationNote(detail.value)), "Failed to delete annotation note.");
  }, { signal: viewerEvents.signal });

  const getContents = () => options.getView()?.renderer?.getContents?.() ?? [];

  const findContentByIndex = (index: number) => getContents().find((item) => item.index === index);

  const findContentByDocument = (doc: Document) => getContents().find((item) => item.doc === doc);

  const findContentByFrame = (frame: Element) =>
    getContents().find((item) => item.doc?.defaultView?.frameElement === frame);

  const close = () => {
    activeContext = null;
    contextMenuStore.getState().close();
  };

  const getSelectedReaderRange = () => {
    for (const { doc, index } of getContents()) {
      const selection = doc?.defaultView?.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) continue;

      const range = selection.getRangeAt(0);
      const text = selection.toString().trim();
      if (text) return { index, range: range.cloneRange(), text };
    }

    return null;
  };

  const getSelectedReaderContext = () => {
    const navigation = options.getNavigation();
    if (!navigation) return null;

    const selection = getSelectedReaderRange();
    if (!selection) return null;
    const value = navigation.cfi(selection.index, selection.range);
    return { ...selection, value };
  };

  const getContentFrameBounds = (index: number) =>
    findContentByIndex(index)?.doc?.defaultView?.frameElement?.getBoundingClientRect();

  const getPagePoint = (
    event: MouseEvent,
    content: Content,
    coordinateSpace: PointerCoordinateSpace,
  ) => {
    const frameBounds = getContentFrameBounds(content.index);
    return {
      x: frameBounds && coordinateSpace === "content" ? frameBounds.left + event.clientX : event.clientX,
      y: frameBounds && coordinateSpace === "content" ? frameBounds.top + event.clientY : event.clientY,
    };
  };

  const getHitPoint = (
    event: MouseEvent,
    content: Content,
    coordinateSpace: PointerCoordinateSpace,
  ) => {
    const frameBounds = getContentFrameBounds(content.index);
    if (coordinateSpace === "viewport" && frameBounds) {
      return { x: event.clientX - frameBounds.left, y: event.clientY - frameBounds.top };
    }
    return { x: event.clientX, y: event.clientY };
  };

  const open = ({
    highlight,
    pageX,
    pageY,
    selection,
  }: {
    highlight?: ReaderHighlight;
    pageX: number;
    pageY: number;
    selection?: NonNullable<HighlightContext>["selection"];
  }) => {
    const hasSelection = Boolean(selection);
    const hasHighlight = Boolean(highlight);
    if (!hasSelection && !hasHighlight) {
      close();
      return;
    }

    activeContext = { highlight, point: { x: pageX, y: pageY }, selection };
    contextMenuStore.getState().openMenu({
      canCopy: hasSelection || hasHighlight,
      canDelete: hasHighlight,
      canHighlight: hasSelection,
      kind: "text",
      x: pageX,
      y: pageY,
    }, handleContextAction, () => { activeContext = null; });
  };

  const openMedia = (media: Element, pageX: number, pageY: number) => {
    activeContext = { media, point: { x: pageX, y: pageY } };
    contextMenuStore.getState().openMenu({
      canCopy: true,
      canDelete: false,
      canHighlight: false,
      kind: "media",
      x: pageX,
      y: pageY,
    }, handleContextAction, () => { activeContext = null; });
  };

  const getAnnotationText = (highlight: ReaderHighlight) => highlight.text?.trim() || highlight.value;

  const hasAnnotationNote = (highlight: ReaderHighlight) => Boolean(highlight.note?.trim());

  const getHighlightColor = (highlight: ReaderHighlight) =>
    !highlight.color || highlight.color === AUTO_HIGHLIGHT_COLOR || highlight.color === LEGACY_HIGHLIGHT_COLOR
      ? THEME_HIGHLIGHT_COLOR
      : highlight.color;

  const getViewportCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const removeAnnotationBadges = (value: string) => {
    for (const { doc, overlay } of getContents()) {
      for (const root of [doc, overlay?.element]) {
        root?.querySelectorAll(ANNOTATION_BADGE_SELECTOR).forEach((badge) => {
          if (badge.getAttribute("data-reader-annotation-badge") === value) badge.remove();
        });
      }
    }
  };

  const getPagePointFromDocumentEvent = (event: MouseEvent) => {
    const doc = (event.currentTarget as Element | null)?.ownerDocument;
    const frameBounds = doc?.defaultView?.frameElement?.getBoundingClientRect();
    return {
      x: frameBounds ? frameBounds.left + event.clientX : event.clientX,
      y: frameBounds ? frameBounds.top + event.clientY : event.clientY,
    };
  };

  const openAnnotationPopover = (highlight: ReaderHighlight, point?: { x: number; y: number }) => {
    emitViewerEvent(VIEWER_EVENTS.translationClose);
    emitViewerEvent(VIEWER_EVENTS.annotationOpen, {
      note: highlight.note ?? "",
      sourceText: getAnnotationText(highlight),
      value: highlight.value,
      ...(point ?? getViewportCenter()),
    });
  };

  const openFromPointer = (
    event: MouseEvent,
    content: Content,
    coordinateSpace: PointerCoordinateSpace,
  ) => {
    const hitPoint = getHitPoint(event, content, coordinateSpace);
    const [hitValue] = content.overlay?.hitTest?.(hitPoint) ?? [];
    const highlight = hitValue ? currentHighlights.find((item) => item.value === hitValue) : undefined;
    const selection = getSelectedReaderContext();
    const pagePoint = getPagePoint(event, content, coordinateSpace);

    open({
      highlight,
      pageX: pagePoint.x,
      pageY: pagePoint.y,
      selection: selection ?? undefined,
    });
  };

  const openFromAnnotation = (detail: { index: number; range?: Range; value: string }) => {
    const highlight = currentHighlights.find((item) => item.value === detail.value);
    if (!highlight) return;

    const frameBounds = getContentFrameBounds(detail.index);
    const rangeBounds = detail.range?.getBoundingClientRect();
    const point = frameBounds && rangeBounds
      ? {
          x: frameBounds.left + rangeBounds.left + rangeBounds.width / 2,
          y: frameBounds.top + rangeBounds.bottom,
        }
      : getViewportCenter();

    open({ highlight, pageX: point.x, pageY: point.y });
  };

  const bindContextDocument = (content: Content & { doc: Document }, signal: AbortSignal) => {
      const { doc } = content;
        const dismissPopovers = () => {
          close();
          emitViewerEvent(VIEWER_EVENTS.translationClose);
          emitViewerEvent(VIEWER_EVENTS.annotationClose);
        };
        doc.addEventListener("pointerdown", dismissPopovers, { capture: true, signal });
        doc.addEventListener("keydown", dismissPopovers, { capture: true, signal });
        doc.addEventListener("scroll", dismissPopovers, { capture: true, signal });
        const openContextMenu = (event: MouseEvent) => {
          const currentContent = findContentByDocument(doc);
          const ElementClass = doc.defaultView?.Element;
          const media = ElementClass && event.target instanceof ElementClass
            ? event.target.closest("img, svg")
            : null;
          consumeReaderEvent(event, "stop");
          if (media && media !== currentContent?.overlay?.element) {
            if (!currentContent) return;
            const pagePoint = getPagePoint(event, currentContent, "content");
            openMedia(media, pagePoint.x, pagePoint.y);
            return;
          }
          if (currentContent) openFromPointer(event, currentContent, "content");
        };
        doc.addEventListener("contextmenu", openContextMenu, { signal });

      const frameElement = doc.defaultView?.frameElement;
      if (frameElement) {
        const openContextMenu = (event: Event) => {
          if (!(event instanceof MouseEvent)) return;
          consumeReaderEvent(event, "stop");
          const currentContent = findContentByFrame(frameElement);
          if (currentContent) openFromPointer(event, currentContent, "viewport");
        };
        frameElement.addEventListener("contextmenu", openContextMenu, { signal });
      }
      signal.addEventListener("abort", () => {
        close();
        emitViewerEvent(VIEWER_EVENTS.translationClose);
        emitViewerEvent(VIEWER_EVENTS.annotationClose);
      }, { once: true });
  };

  const bindContextTargets = () => {
    const view = options.getView();
    if (!view || view === contextView) return;
    stopContextDocuments?.();
    contextView = view;
    stopContextDocuments = observeRenderedDocuments(view, bindContextDocument);
  };

  const unbindContextTargets = () => {
    stopContextDocuments?.();
    stopContextDocuments = null;
    contextView = null;
  };

  const drawAnnotation = (detail: {
    annotation: ReaderHighlight;
    draw: <Options extends OverlayDrawOptions>(func: OverlayDraw<Options>, options?: Options) => void;
  }) => {
    detail.draw(drawHighlightWithAnnotationBadge, {
      annotationValue: detail.annotation.value,
      color: getHighlightColor(detail.annotation),
      hasNote: hasAnnotationNote(detail.annotation),
      onBadgeClick: (event) => {
        const highlight = currentHighlights.find((item) => item.value === detail.annotation.value) ?? detail.annotation;
        if (!hasAnnotationNote(highlight)) return;
        openAnnotationPopover(highlight, getPagePointFromDocumentEvent(event));
        close();
      },
      onActivate: (event) => {
        const highlight = currentHighlights.find((item) => item.value === detail.annotation.value)
          ?? detail.annotation;
        options.getNavigation()?.clearSelection();
        open({ highlight, pageX: event.clientX, pageY: event.clientY });
      },
    });
  };

  const addCurrentHighlightsToOverlay = (view: ReaderView, index: number) => {
    for (const annotation of currentHighlights) {
      if (annotation.index === index) {
        const added = view.addAnnotation?.(annotation);
        if (added) run(added, "Failed to draw restored highlight.");
      }
    }
    bindContextTargets();
  };

  const restore = async (view: ReaderView, bookKey: string) => {
    const savedHighlights = await getSavedHighlights(bookKey);
    if (options.getView() !== view || options.getBookKey() !== bookKey) return;

    let shouldPersist = false;
    const sectionFractions = options.getNavigation()?.fractions() ?? [];

    const restoredHighlights = await Promise.all(
      savedHighlights.map(async (annotation) => {
        const restored = await view.addAnnotation?.(annotation);
        if (typeof annotation.fraction === "number") return annotation;

        const index = restored?.index ?? annotation.index;
        const fraction = typeof index === "number" ? sectionFractions[index] : undefined;
        if (typeof fraction !== "number") return annotation;

        shouldPersist = true;
        return { ...annotation, index, fraction };
      }),
    );
    if (options.getView() !== view || options.getBookKey() !== bookKey) return;

    currentHighlights = restoredHighlights;
    if (shouldPersist) await setSavedHighlights(bookKey, restoredHighlights);
    bindContextTargets();
  };

  const copyHighlight = async (highlight: ReaderHighlight) => {
    await navigator.clipboard.writeText(getAnnotationText(highlight));
    close();
  };

  const copySelectedText = async () => {
    const text = activeContext?.selection?.text.trim();
    if (!text) return;

    await navigator.clipboard.writeText(text);
    options.getNavigation()?.clearSelection();
    close();
  };

  const copyMedia = async (media: Element) => {
    try {
      await copyReaderMedia(media);
    } finally {
      close();
    }
  };

  const translateContextText = () => {
    const text = activeContext?.highlight?.text?.trim()
      || activeContext?.selection?.text.trim()
      || activeContext?.highlight?.value.trim()
      || "";
    if (!text) return;

    const point = activeContext?.point ?? getViewportCenter();
    void translation.translate({
      sourceText: text,
      x: point.x,
      y: point.y,
    });
    options.getNavigation()?.clearSelection();
    close();
  };

  const markUnsaved = () => {
    emitViewerEvent(VIEWER_EVENTS.unsavedChange);
  };

  const persistHighlight = async (highlight: ReaderHighlight) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return false;

    const exists = currentHighlights.some((item) => item.value === highlight.value);
    const nextHighlights = exists
      ? currentHighlights.map((item) => (item.value === highlight.value ? highlight : item))
      : [...currentHighlights, highlight];
    currentHighlights = nextHighlights;
    markUnsaved();
    await view.addAnnotation?.(highlight);
    await setSavedHighlights(bookKey, nextHighlights);
    return true;
  };

  const deleteHighlight = async (highlight: ReaderHighlight) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return;

    currentHighlights = currentHighlights.filter((item) => item.value !== highlight.value);
    markUnsaved();
    await view.deleteAnnotation?.(highlight);
    removeAnnotationBadges(highlight.value);
    await setSavedHighlights(bookKey, currentHighlights);
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    close();
  };

  const deleteAnnotationNote = async (value: string) => {
    const existing = currentHighlights.find((item) => item.value === value);
    if (!existing) return;

    const highlight: ReaderHighlight = {
      ...existing,
      note: undefined,
    };
    removeAnnotationBadges(value);
    if (!await persistHighlight(highlight)) return;
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
  };

  const saveAnnotationNote = async (value: string, note: string) => {
    const existing = currentHighlights.find((item) => item.value === value);
    if (!existing) return;

    const cleanNote = note.trim();
    if (cleanNote === (existing.note?.trim() ?? "")) return;

    if (!cleanNote) {
      await deleteAnnotationNote(value);
      return;
    }

    const annotation: ReaderHighlight = {
      ...existing,
      note: cleanNote,
    };
    await persistHighlight(annotation);
  };

  const highlightSelectedText = async () => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey || !activeContext?.selection) return;

    const selection = activeContext.selection;
    const { value } = selection;
    const existing = currentHighlights.find((item) => item.value === value);
    if (existing) {
      options.getNavigation()?.clearSelection();
      close();
      return existing;
    }

    const annotation: ReaderHighlight = {
      value,
      color: AUTO_HIGHLIGHT_COLOR,
      text: selection.text,
      index: selection.index,
      fraction: options.getProgress(),
      createdAt: Date.now(),
    };

    await persistHighlight(annotation);
    options.getNavigation()?.clearSelection();
    close();
    return annotation;
  };

  const annotateContextText = async () => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    const context = activeContext;
    const point = context?.point ?? getViewportCenter();
    if (!view || !bookKey || !context) return;

    if (context.highlight) {
      const annotation: ReaderHighlight = {
        ...context.highlight,
        note: context.highlight.note ?? "",
      };
      openAnnotationPopover(annotation, point);
      close();
      return;
    }

    if (!context.selection) return;

    const { value } = context.selection;
    const existing = currentHighlights.find((item) => item.value === value);
    const annotation: ReaderHighlight = existing
      ? { ...existing, note: existing.note ?? "" }
      : {
          value,
          color: AUTO_HIGHLIGHT_COLOR,
          note: "",
          text: context.selection.text,
          index: context.selection.index,
          fraction: options.getProgress(),
          createdAt: Date.now(),
        };

    if (!existing) await persistHighlight(annotation);
    options.getNavigation()?.clearSelection();
    openAnnotationPopover(annotation, point);
    close();
  };

  const handleContextAction = (action: HighlightContextAction) => {
    switch (action) {
      case "copy":
        if (activeContext?.media) {
          run(copyMedia(activeContext.media), "Failed to copy reader media.");
        } else {
          run(
            activeContext?.highlight ? copyHighlight(activeContext.highlight) : copySelectedText(),
            "Failed to copy reader text.",
          );
        }
        break;
      case "highlight":
        run(track(highlightSelectedText()), "Failed to save highlight.");
        break;
      case "translate":
        translateContextText();
        break;
      case "annotate":
        run(track(annotateContextText()), "Failed to create annotation.");
        break;
      case "delete":
        if (activeContext?.highlight) {
          run(track(deleteHighlight(activeContext.highlight)), "Failed to delete highlight.");
        }
    }
  };

  const reset = () => {
    translation.cancel();
    unbindContextTargets();
    currentHighlights = [];
    close();
  };

  return {
    addCurrentHighlightsToOverlay,
    bindContextTargets,
    close,
    drawAnnotation,
    destroy: () => {
      reset();
      translation.destroy();
      viewerEvents.abort();
    },
    flushPendingWrites: () => pendingWrites.idle(),
    getAll: () => currentHighlights.slice(),
    openFromAnnotation,
    reset,
    restore,
  };
}
