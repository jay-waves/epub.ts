import { Overlayer } from "./foliate";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import {
  getSavedHighlights,
  saveHighlight,
  setSavedHighlights,
} from "./viewer-storage";
import type { HighlightContextAction } from "./viewer-events";
import type { ReaderHighlight } from "./reader";
import type { FoliateViewElement } from "./foliate";

type ReaderContent = {
  doc?: Document;
  index: number;
  overlayer?: {
    element?: SVGSVGElement;
    hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
  };
};

type BuiltInAiGlobals = typeof globalThis & {
  LanguageDetector?: LanguageDetectorConstructor;
  Translator?: TranslatorConstructor;
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
  getBookKey: () => string;
  getProgress: () => number;
  getReaderView: () => FoliateViewElement | null;
  runWhenIdle: (callback: () => void, timeout?: number) => void;
}) {
  const defaultHighlightColor = "#f4c430";
  const contextTargets = new WeakSet<EventTarget>();
  let activeContext: HighlightContext = null;
  let currentHighlights: ReaderHighlight[] = [];
  let pendingAnnotationSave: Promise<void> = Promise.resolve();
  let translationRunId = 0;

  listenViewerEvent(VIEWER_EVENTS.highlightContextClose, () => {
    activeContext = null;
  });

  listenViewerEvent(VIEWER_EVENTS.annotationSave, (detail) => {
    pendingAnnotationSave = saveAnnotationNote(detail.value, detail.note).catch((error) => {
      console.warn("Failed to save annotation note.", error);
    });
  });

  listenViewerEvent(VIEWER_EVENTS.annotationDelete, (detail) => {
    void deleteAnnotationNote(detail.value);
  });

  listenViewerEvent(VIEWER_EVENTS.translationClose, () => {
    ++translationRunId;
  });

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
      x: point?.x ?? window.innerWidth / 2,
      y: point?.y ?? window.innerHeight / 2,
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
    const hasBounds = Boolean(frameBounds && rangeBounds);

    const point = {
      x: hasBounds ? frameBounds!.left + rangeBounds!.left + rangeBounds!.width / 2 : window.innerWidth / 2,
      y: hasBounds ? frameBounds!.top + rangeBounds!.bottom : window.innerHeight / 2,
    };

    open({ highlight, pageX: point.x, pageY: point.y });
  };

  const bindContextTargets = () => {
    for (const content of getContents()) {
      const { doc } = content;
      if (!doc) continue;

      if (!contextTargets.has(doc)) {
        contextTargets.add(doc);
        doc.addEventListener("pointerdown", () => {
          close();
          emitViewerEvent(VIEWER_EVENTS.translationClose);
          emitViewerEvent(VIEWER_EVENTS.annotationClose);
        }, true);
        doc.addEventListener("keydown", () => {
          close();
          emitViewerEvent(VIEWER_EVENTS.translationClose);
          emitViewerEvent(VIEWER_EVENTS.annotationClose);
        }, true);
        doc.addEventListener("scroll", () => {
          close();
          emitViewerEvent(VIEWER_EVENTS.translationClose);
          emitViewerEvent(VIEWER_EVENTS.annotationClose);
        }, true);
        doc.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentContent = findContentByDocument(doc);
          if (currentContent) openFromPointer(event, currentContent);
        });
      }

      const frameElement = doc.defaultView?.frameElement;
      if (frameElement && !contextTargets.has(frameElement)) {
        contextTargets.add(frameElement);
        frameElement.addEventListener("contextmenu", (event) => {
          if (!(event instanceof MouseEvent)) return;
          event.preventDefault();
          event.stopPropagation();
          const currentContent = findContentByFrame(frameElement);
          if (currentContent) openFromPointer(event, currentContent, true);
        });
      }
    }
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
    const text = highlight.text?.trim() || highlight.value;
    await navigator.clipboard.writeText(text);
    close();
  };

  const copySelectedText = async () => {
    const text = activeContext?.selection?.text.trim();
    if (!text) return;

    await navigator.clipboard.writeText(text);
    options.getReaderView()?.deselect?.();
    close();
  };

  const getContextText = () => activeContext?.highlight?.text?.trim()
    || activeContext?.selection?.text.trim()
    || activeContext?.highlight?.value.trim()
    || "";

  const detectLanguage = async (text: string) => {
    const builtInAi = globalThis as BuiltInAiGlobals;
    if (!builtInAi.LanguageDetector) return "en";

    const availability = await builtInAi.LanguageDetector.availability();
    if (availability === "unavailable") return "en";

    const detector = await builtInAi.LanguageDetector.create();
    const [result] = await detector.detect(text);
    return result?.confidence && result.confidence >= 0.45 ? result.detectedLanguage : "en";
  };

  const translateContextText = async () => {
    const text = getContextText();
    if (!text) return;

    const runId = ++translationRunId;
    const targetLanguage = "zh";
    const point = activeContext?.point ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const baseDetail = {
      sourceText: text,
      status: "loading" as const,
      targetLanguage,
      x: point.x,
      y: point.y,
    };

    emitViewerEvent(VIEWER_EVENTS.translationOpen, {
      ...baseDetail,
      message: "Translating to Chinese...",
    });
    options.getReaderView()?.deselect?.();
    close();

    try {
      const builtInAi = globalThis as BuiltInAiGlobals;
      if (!builtInAi.Translator) {
        throw new Error("Chrome Translator API is not available in this browser.");
      }

      const sourceLanguage = await detectLanguage(text);
      if (runId !== translationRunId) return;
      if (sourceLanguage === targetLanguage || sourceLanguage.toLowerCase().startsWith("zh")) {
        emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
          ...baseDetail,
          message: "Selected text is already Chinese.",
          sourceLanguage,
          status: "success",
          translatedText: text,
        });
        return;
      }

      const availability = await builtInAi.Translator.availability({
        sourceLanguage,
        targetLanguage,
      });
      if (runId !== translationRunId) return;
      if (availability === "unavailable") {
        throw new Error(`Chrome cannot translate from ${sourceLanguage} to Chinese on this device.`);
      }

      const translator = await builtInAi.Translator.create({
        sourceLanguage,
        targetLanguage,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (runId !== translationRunId) return;
            emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
              ...baseDetail,
              message: "Downloading Chrome translation model...",
              progress: event.loaded,
              sourceLanguage,
            });
          });
        },
      });
      await translator.ready;
      if (runId !== translationRunId) return;

      const translatedText = await translator.translate(text);
      if (runId !== translationRunId) return;
      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        sourceLanguage,
        status: "success",
        translatedText,
      });
    } catch (error) {
      if (runId !== translationRunId) return;
      emitViewerEvent(VIEWER_EVENTS.translationUpdate, {
        ...baseDetail,
        message: error instanceof Error ? error.message : "Translation failed.",
        status: "error",
      });
    }
  };

  const markUnsaved = () => {
    emitViewerEvent(VIEWER_EVENTS.unsavedChange);
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
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey) return;

    const existing = currentHighlights.find((item) => item.value === value);
    if (!existing) return;

    const highlight: ReaderHighlight = {
      ...existing,
      color: getHighlightColor(existing),
      kind: "highlight",
      note: undefined,
    };
    currentHighlights = currentHighlights.map((item) => (item.value === value ? highlight : item));
    removeAnnotationBadges(value);
    await readerView.addAnnotation?.(highlight);
    await setSavedHighlights(bookKey, currentHighlights);
    markUnsaved();
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
  };

  const saveAnnotationNote = async (value: string, note: string) => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey) return;

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
    currentHighlights = currentHighlights.map((item) => (item.value === value ? annotation : item));
    await readerView.addAnnotation?.(annotation);
    await setSavedHighlights(bookKey, currentHighlights);
    markUnsaved();
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

    currentHighlights = [...currentHighlights, annotation];
    await readerView.addAnnotation?.(annotation);
    await saveHighlight(bookKey, annotation);
    markUnsaved();
    readerView.deselect?.();
    close();
    return annotation;
  };

  const annotateContextText = async () => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    const context = activeContext;
    const point = context?.point ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (!readerView || !bookKey || !context) return;

    if (context.highlight) {
      const annotation: ReaderHighlight = {
        ...context.highlight,
        color: getHighlightColor(context.highlight),
        kind: "highlight",
        note: context.highlight.note ?? "",
      };
      currentHighlights = currentHighlights.map((item) => (item.value === annotation.value ? annotation : item));
      await readerView.addAnnotation?.(annotation);
      await setSavedHighlights(bookKey, currentHighlights);
      markUnsaved();
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

    currentHighlights = existing
      ? currentHighlights.map((item) => (item.value === value ? annotation : item))
      : [...currentHighlights, annotation];
    await readerView.addAnnotation?.(annotation);
    await setSavedHighlights(bookKey, currentHighlights);
    markUnsaved();
    readerView.deselect?.();
    openAnnotationPopover(annotation, point);
    close();
  };

  const handleContextAction = (action: HighlightContextAction) => {
    if (action === "copy") {
      if (activeContext?.highlight) {
        void copyHighlight(activeContext.highlight);
      } else {
        void copySelectedText();
      }
      return;
    }

    if (action === "highlight") {
      void highlightSelectedText();
      return;
    }

    if (action === "translate") {
      void translateContextText();
      return;
    }

    if (action === "annotate") {
      void annotateContextText();
      return;
    }

    if (action === "delete" && activeContext?.highlight) {
      void deleteHighlight(activeContext.highlight);
    }
  };

  const reset = () => {
    currentHighlights = [];
    close();
  };

  return {
    addCurrentHighlightsToOverlay,
    bindContextTargets,
    close,
    drawAnnotation,
    flushPendingAnnotationSave: () => pendingAnnotationSave,
    handleContextAction,
    openFromAnnotation,
    reset,
    scheduleRestore,
  };
}
