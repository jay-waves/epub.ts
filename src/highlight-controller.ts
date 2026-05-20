import { Overlayer } from "foliate-js/overlayer.js";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import {
  getSavedHighlights,
  saveHighlight,
  setSavedHighlights,
} from "./viewer-storage";
import type { HighlightContextAction } from "./viewer-events";
import type { FoliateViewElement, ReaderHighlight } from "./viewer-types";

type ReaderContent = {
  doc?: Document;
  index: number;
  overlayer?: {
    hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
  };
};

type HighlightContext = {
  highlight?: ReaderHighlight;
  selection?: {
    index: number;
    range: Range;
    text: string;
    value: string;
  };
} | null;

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

  listenViewerEvent(VIEWER_EVENTS.highlightContextClose, () => {
    activeContext = null;
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
    const value = selection && readerView.getCFI?.(selection.index, selection.range);
    if (!selection || !value) return null;
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
    activeContext = { highlight, selection };

    const hasSelection = Boolean(selection);
    const hasHighlight = Boolean(highlight);
    if (!hasSelection && !hasHighlight) {
      close();
      return;
    }

    emitViewerEvent(VIEWER_EVENTS.highlightContextOpen, {
      canCopy: hasSelection || hasHighlight,
      canDelete: hasHighlight,
      canHighlight: hasSelection,
      x: pageX,
      y: pageY,
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

    open({
      highlight,
      pageX: hasBounds ? frameBounds!.left + rangeBounds!.left + rangeBounds!.width / 2 : window.innerWidth / 2,
      pageY: hasBounds ? frameBounds!.top + rangeBounds!.bottom : window.innerHeight / 2,
    });
  };

  const bindContextTargets = () => {
    for (const content of getContents()) {
      const { doc } = content;
      if (!doc) continue;

      if (!contextTargets.has(doc)) {
        contextTargets.add(doc);
        doc.addEventListener("pointerdown", close, true);
        doc.addEventListener("keydown", close, true);
        doc.addEventListener("scroll", close, true);
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
    draw: (func: typeof Overlayer.highlight, options: { color: string }) => void;
  }) => {
    detail.draw(Overlayer.highlight, { color: detail.annotation.color });
  };

  const addCurrentHighlightsToOverlay = (view: FoliateViewElement, index: number) => {
    for (const annotation of currentHighlights) {
      if (annotation.index === index) void view.addAnnotation?.(annotation);
    }
    bindContextTargets();
  };

  const restore = async (view: FoliateViewElement, bookKey: string) => {
    currentHighlights = await getSavedHighlights(bookKey);
    let shouldPersist = false;
    const sectionFractions = view.getSectionFractions?.() ?? [];

    currentHighlights = await Promise.all(
      currentHighlights.map(async (annotation) => {
        const restored = await view.addAnnotation?.(annotation);
        if (typeof annotation.fraction === "number") return annotation;

        const index = restored?.index ?? annotation.index;
        const fraction = typeof index === "number" ? sectionFractions[index] : undefined;
        if (typeof fraction !== "number") return annotation;

        shouldPersist = true;
        return { ...annotation, index, fraction };
      }),
    );
    if (shouldPersist) await setSavedHighlights(bookKey, currentHighlights);
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

  const translateContextText = () => {
    const text = getContextText();
    if (!text) return;

    const url = `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(text)}&op=translate`;
    if (globalThis.chrome?.tabs?.create) {
      void globalThis.chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    close();
  };

  const deleteHighlight = async (highlight: ReaderHighlight) => {
    const readerView = options.getReaderView();
    const bookKey = options.getBookKey();
    if (!readerView || !bookKey) return;

    await readerView.deleteAnnotation?.(highlight);
    currentHighlights = currentHighlights.filter((item) => item.value !== highlight.value);
    await setSavedHighlights(bookKey, currentHighlights);
    close();
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
    readerView.deselect?.();
    close();
    return annotation;
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
      translateContextText();
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
    handleContextAction,
    openFromAnnotation,
    reset,
    scheduleRestore,
  };
}
