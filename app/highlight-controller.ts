import { Overlayer } from "./foliate";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import {
  getSavedHighlights,
  setSavedHighlights,
} from "./viewer-storage";
import type { HighlightContextAction } from "./viewer-events";
import type { ReaderHighlight } from "./reader";
import type { FoliateViewElement } from "./foliate";
import { createTranslationController } from "./translation-controller";

type ReaderContent = {
  doc?: Document;
  index: number;
  overlayer?: {
    element?: SVGSVGElement;
    hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
  };
};

type HighlightContext = {
  highlight?: ReaderHighlight;
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

type AnnotationDrawOptions = {
  annotationValue?: string;
  color: string;
  hasNote?: boolean;
  onBadgeClick?: (event: MouseEvent) => void;
  width?: number;
};

type AnnotationDrawFunction = (
  rects: DOMRectList,
  options?: AnnotationDrawOptions,
) => SVGElement;

const svgNamespace = "http://www.w3.org/2000/svg";

function createSvgElement(tagName: string) {
  return document.createElementNS(svgNamespace, tagName);
}

const annotationBadgeSelector = "[data-reader-annotation-badge]";

function drawHighlightWithAnnotationBadge(rects: DOMRectList, options: AnnotationDrawOptions = { color: "#f4c430" }) {
  const group = createSvgElement("g");
  group.append(Overlayer.highlight(rects, { color: options.color }));

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
    event.preventDefault();
    event.stopPropagation();
    options.onBadgeClick?.(event);
  });
  badge.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  const box = createSvgElement("rect");
  box.setAttribute("x", String(x));
  box.setAttribute("y", String(y));
  box.setAttribute("width", String(size));
  box.setAttribute("height", String(size));
  box.setAttribute("rx", "2.5");
  box.setAttribute("fill", "#6f7782");

  const lineTop = createSvgElement("path");
  lineTop.setAttribute("d", `M${x + 2.4} ${y + 3.3}H${x + 7.6}`);
  lineTop.setAttribute("stroke", "white");
  lineTop.setAttribute("stroke-linecap", "round");
  lineTop.setAttribute("stroke-width", "1.1");

  const lineBottom = createSvgElement("path");
  lineBottom.setAttribute("d", `M${x + 2.4} ${y + 5.9}H${x + 6.4}`);
  lineBottom.setAttribute("stroke", "white");
  lineBottom.setAttribute("stroke-linecap", "round");
  lineBottom.setAttribute("stroke-width", "1.1");

  badge.append(box, lineTop, lineBottom);
  group.append(badge);

  queueMicrotask(() => {
    const root = group.parentElement;
    if (!root) return;
    if (options.annotationValue) {
      const existingBadges = Array.from(root.querySelectorAll(annotationBadgeSelector))
        .filter((item) => item.getAttribute("data-reader-annotation-badge") === options.annotationValue);
      for (const existingBadge of existingBadges) {
        if (existingBadge !== badge) existingBadge.remove();
      }
    }
    root.append(badge);
  });

  return group;
}

export function createHighlightController(options: {
  allowTranslationModelDownload: boolean;
  getBookKey: () => string;
  getProgress: () => number;
  getReaderView: () => FoliateViewElement | null;
  runWhenIdle: (callback: () => void, timeout?: number) => void;
}) {
  const defaultHighlightColor = "#f4c430";
  let contextTargets = new WeakMap<EventTarget, () => void>();
  const contextDisposers = new Set<() => void>();
  let activeContext: HighlightContext = null;
  let currentHighlights: ReaderHighlight[] = [];
  let pendingAnnotationSave: Promise<void> = Promise.resolve();
  const translationController = createTranslationController({
    allowModelDownload: options.allowTranslationModelDownload,
  });

  const viewerEventDisposers = [
    listenViewerEvent(VIEWER_EVENTS.highlightContextClose, () => {
      activeContext = null;
    }),
    listenViewerEvent(VIEWER_EVENTS.annotationSave, (detail) => {
      pendingAnnotationSave = saveAnnotationNote(detail.value, detail.note).catch((error) => {
        console.warn("Failed to save annotation note.", error);
      });
    }),
    listenViewerEvent(VIEWER_EVENTS.annotationDelete, (detail) => {
      void deleteAnnotationNote(detail.value);
    }),
  ];

  const getContents = () => options.getReaderView()?.renderer?.getContents?.() ?? [];

  const findContentByIndex = (index: number) => getContents().find((item) => item.index === index);

  const findContentByDocument = (doc: Document) => getContents().find((item) => item.doc === doc);

  const findContentByFrame = (frame: Element) =>
    getContents().find((item) => item.doc?.defaultView?.frameElement === frame);

  const close = () => {
    activeContext = null;
    emitViewerEvent(VIEWER_EVENTS.highlightContextClose);
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
    const readerView = options.getReaderView();
    if (!readerView) return null;

    const selection = getSelectedReaderRange();
    if (!selection) return null;
    const value = readerView.getCFI?.(selection.index, selection.range);
    if (!value) return null;
    return { ...selection, value };
  };

  const getContentFrameBounds = (index: number) =>
    findContentByIndex(index)?.doc?.defaultView?.frameElement?.getBoundingClientRect();

  const getPagePoint = (event: MouseEvent, content: ReaderContent, convertFromFrame: boolean) => {
    const frameBounds = getContentFrameBounds(content.index);
    return {
      x: frameBounds && !convertFromFrame ? frameBounds.left + event.clientX : event.clientX,
      y: frameBounds && !convertFromFrame ? frameBounds.top + event.clientY : event.clientY,
    };
  };

  const getHitPoint = (event: MouseEvent, content: ReaderContent, convertFromFrame: boolean) => {
    const frameBounds = getContentFrameBounds(content.index);
    if (convertFromFrame && frameBounds) {
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
    emitViewerEvent(VIEWER_EVENTS.highlightContextOpen, {
      canCopy: hasSelection || hasHighlight,
      canDelete: hasHighlight,
      canHighlight: hasSelection,
      x: pageX,
      y: pageY,
    });
  };

  const getAnnotationText = (highlight: ReaderHighlight) => highlight.text?.trim() || highlight.value;

  const hasAnnotationNote = (highlight: ReaderHighlight) => Boolean(highlight.note?.trim());

  const getHighlightColor = (highlight: ReaderHighlight) => highlight.color || defaultHighlightColor;

  const getViewportCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const removeAnnotationBadges = (value: string) => {
    for (const { doc, overlayer } of getContents()) {
      for (const root of [doc, overlayer?.element]) {
        root?.querySelectorAll(annotationBadgeSelector).forEach((badge) => {
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

  const openFromPointer = (event: MouseEvent, content: ReaderContent, convertFromFrame = false) => {
    const hitPoint = getHitPoint(event, content, convertFromFrame);
    const [hitValue] = content.overlayer?.hitTest?.(hitPoint) ?? [];
    const highlight = hitValue ? currentHighlights.find((item) => item.value === hitValue) : undefined;
    const selection = getSelectedReaderContext();
    const pagePoint = getPagePoint(event, content, convertFromFrame);

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

  const bindContextTargets = () => {
    for (const content of getContents()) {
      const { doc } = content;
      if (!doc) continue;

      if (!contextTargets.has(doc)) {
        const dismissPopovers = () => {
          close();
          emitViewerEvent(VIEWER_EVENTS.translationClose);
          emitViewerEvent(VIEWER_EVENTS.annotationClose);
        };
        doc.addEventListener("pointerdown", dismissPopovers, true);
        doc.addEventListener("keydown", dismissPopovers, true);
        doc.addEventListener("scroll", dismissPopovers, true);
        const openContextMenu = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          const currentContent = findContentByDocument(doc);
          if (currentContent) openFromPointer(event, currentContent);
        };
        doc.addEventListener("contextmenu", openContextMenu);
        const dispose = () => {
          doc.removeEventListener("pointerdown", dismissPopovers, true);
          doc.removeEventListener("keydown", dismissPopovers, true);
          doc.removeEventListener("scroll", dismissPopovers, true);
          doc.removeEventListener("contextmenu", openContextMenu);
        };
        contextTargets.set(doc, dispose);
        contextDisposers.add(dispose);
      }

      const frameElement = doc.defaultView?.frameElement;
      if (frameElement && !contextTargets.has(frameElement)) {
        const openContextMenu = (event: Event) => {
          if (!(event instanceof MouseEvent)) return;
          event.preventDefault();
          event.stopPropagation();
          const currentContent = findContentByFrame(frameElement);
          if (currentContent) openFromPointer(event, currentContent, true);
        };
        frameElement.addEventListener("contextmenu", openContextMenu);
        const dispose = () => frameElement.removeEventListener("contextmenu", openContextMenu);
        contextTargets.set(frameElement, dispose);
        contextDisposers.add(dispose);
      }
    }
  };

  const unbindContextTargets = () => {
    contextDisposers.forEach((dispose) => dispose());
    contextDisposers.clear();
    contextTargets = new WeakMap();
  };

  const drawAnnotation = (detail: {
    annotation: ReaderHighlight;
    draw: (func: AnnotationDrawFunction, options: AnnotationDrawOptions) => void;
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
    });
  };

  const addCurrentHighlightsToOverlay = (view: FoliateViewElement, index: number) => {
    for (const annotation of currentHighlights) {
      if (annotation.index === index) void view.addAnnotation?.(annotation);
    }
    bindContextTargets();
  };

  const restore = async (view: FoliateViewElement, bookKey: string) => {
    const savedHighlights = await getSavedHighlights(bookKey);
    if (options.getReaderView() !== view || options.getBookKey() !== bookKey) return;

    let shouldPersist = false;
    const sectionFractions = view.getSectionFractions?.() ?? [];

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
    if (options.getReaderView() !== view || options.getBookKey() !== bookKey) return;

    currentHighlights = restoredHighlights;
    if (shouldPersist) await setSavedHighlights(bookKey, restoredHighlights);
    bindContextTargets();
  };

  const scheduleRestore = (view: FoliateViewElement, bookKey: string) => {
    options.runWhenIdle(() => {
      if (options.getReaderView() !== view || options.getBookKey() !== bookKey) return;
      void restore(view, bookKey).catch((error) => {
        console.warn("Failed to restore highlights.", error);
      });
    }, 800);
  };

  const copyHighlight = async (highlight: ReaderHighlight) => {
    await navigator.clipboard.writeText(getAnnotationText(highlight));
    close();
  };

  const copySelectedText = async () => {
    const text = activeContext?.selection?.text.trim();
    if (!text) return;

    await navigator.clipboard.writeText(text);
    options.getReaderView()?.deselect?.();
    close();
  };

  const translateContextText = () => {
    const text = activeContext?.highlight?.text?.trim()
      || activeContext?.selection?.text.trim()
      || activeContext?.highlight?.value.trim()
      || "";
    if (!text) return;

    const point = activeContext?.point ?? getViewportCenter();
    void translationController.translate({
      sourceText: text,
      x: point.x,
      y: point.y,
    });
    options.getReaderView()?.deselect?.();
    close();
  };

  const markUnsaved = () => {
    emitViewerEvent(VIEWER_EVENTS.unsavedChange);
  };

  const persistHighlight = async (highlight: ReaderHighlight) => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey) return false;

    const exists = currentHighlights.some((item) => item.value === highlight.value);
    const nextHighlights = exists
      ? currentHighlights.map((item) => (item.value === highlight.value ? highlight : item))
      : [...currentHighlights, highlight];
    currentHighlights = nextHighlights;
    await readerView.addAnnotation?.(highlight);
    await setSavedHighlights(bookKey, nextHighlights);
    markUnsaved();
    return true;
  };

  const deleteHighlight = async (highlight: ReaderHighlight) => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey) return;

    await readerView.deleteAnnotation?.(highlight);
    removeAnnotationBadges(highlight.value);
    currentHighlights = currentHighlights.filter((item) => item.value !== highlight.value);
    await setSavedHighlights(bookKey, currentHighlights);
    markUnsaved();
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    close();
  };

  const deleteAnnotationNote = async (value: string) => {
    const existing = currentHighlights.find((item) => item.value === value);
    if (!existing) return;

    const highlight: ReaderHighlight = {
      ...existing,
      color: getHighlightColor(existing),
      kind: "highlight",
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
      color: getHighlightColor(existing),
      kind: "highlight",
      note: cleanNote,
    };
    await persistHighlight(annotation);
  };

  const highlightSelectedText = async () => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey || !activeContext?.selection) return;

    const selection = activeContext.selection;
    const { value } = selection;
    const existing = currentHighlights.find((item) => item.value === value);
    if (existing) {
      readerView.deselect?.();
      close();
      return existing;
    }

    const annotation: ReaderHighlight = {
      value,
      color: defaultHighlightColor,
      text: selection.text,
      index: selection.index,
      fraction: options.getProgress(),
      createdAt: Date.now(),
    };

    await persistHighlight(annotation);
    readerView.deselect?.();
    close();
    return annotation;
  };

  const annotateContextText = async () => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    const context = activeContext;
    const point = context?.point ?? getViewportCenter();
    if (!readerView || !bookKey || !context) return;

    if (context.highlight) {
      const annotation: ReaderHighlight = {
        ...context.highlight,
        color: getHighlightColor(context.highlight),
        kind: "highlight",
        note: context.highlight.note ?? "",
      };
      await persistHighlight(annotation);
      openAnnotationPopover(annotation, point);
      close();
      return;
    }

    if (!context.selection) return;

    const { value } = context.selection;
    const existing = currentHighlights.find((item) => item.value === value);
    const annotation: ReaderHighlight = existing
      ? { ...existing, color: getHighlightColor(existing), kind: "highlight", note: existing.note ?? "" }
      : {
          value,
          color: defaultHighlightColor,
          kind: "highlight",
          note: "",
          text: context.selection.text,
          index: context.selection.index,
          fraction: options.getProgress(),
          createdAt: Date.now(),
        };

    await persistHighlight(annotation);
    readerView.deselect?.();
    openAnnotationPopover(annotation, point);
    close();
  };

  const handleContextAction = (action: HighlightContextAction) => {
    switch (action) {
      case "copy":
        void (activeContext?.highlight ? copyHighlight(activeContext.highlight) : copySelectedText());
        break;
      case "highlight":
        void highlightSelectedText();
        break;
      case "translate":
        translateContextText();
        break;
      case "annotate":
        void annotateContextText();
        break;
      case "delete":
        if (activeContext?.highlight) void deleteHighlight(activeContext.highlight);
    }
  };

  const reset = () => {
    translationController.cancel();
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
      translationController.destroy();
      viewerEventDisposers.forEach((dispose) => dispose());
    },
    flushPendingAnnotationSave: () => pendingAnnotationSave,
    handleContextAction,
    openFromAnnotation,
    reset,
    scheduleRestore,
  };
}
