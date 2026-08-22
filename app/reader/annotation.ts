import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./events";
import type { HighlightContextAction } from "./context-menu-store";
import { contextMenuStore } from "./context-menu-store";
import type { ReaderAnnotation } from "../epub/annotation";
import { annotationRepository } from "./annotation-repository";
import type { Content, OverlayDraw, OverlayDrawOptions } from "../renderer";
import type { ReaderView } from "./model";
import { createTranslation } from "./translation";
import type { Navigation } from "./navigation";
import { TaskTracker } from "../shared/async-tasks";
import { drawAnnotation as drawAnnotationOverlay } from "./annotation-overlay";

type PointerCoordinateSpace = "content" | "viewport";

type AnnotationOptions = {
  getBookKey: () => string;
  getNavigation: () => Navigation | null;
  getProgress: () => number;
  getView: () => ReaderView | null;
  openExternal: (url: string) => void;
  translationModelPolicy: "allow-download" | "external-fallback";
};

type AnnotationContext = {
  highlight?: ReaderAnnotation;
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

const AUTO_HIGHLIGHT_COLOR = "auto";
const LEGACY_HIGHLIGHT_COLOR = "#f4c430";
const THEME_HIGHLIGHT_COLOR = "var(--reader-annotation-color, #f4c430)";

export function createAnnotations(options: AnnotationOptions) {
  const viewerEvents = new AbortController();
  let activeContext: AnnotationContext = null;
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

  const close = () => {
    activeContext = null;
    contextMenuStore.getState().close();
  };

  const dismiss = () => {
    close();
    translation.cancel();
    emitViewerEvent(VIEWER_EVENTS.translationClose);
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
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

  const getContentFrameBounds = (content: Content | undefined) =>
    content?.doc?.defaultView?.frameElement?.getBoundingClientRect();

  const getPagePoint = (
    event: MouseEvent,
    content: Content,
    coordinateSpace: PointerCoordinateSpace,
  ) => {
    const frameBounds = getContentFrameBounds(content);
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
    const frameBounds = getContentFrameBounds(content);
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
    highlight?: ReaderAnnotation;
    pageX: number;
    pageY: number;
    selection?: NonNullable<AnnotationContext>["selection"];
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

  const getAnnotationText = (highlight: ReaderAnnotation) => highlight.text?.trim() || highlight.value;

  const hasAnnotationNote = (highlight: ReaderAnnotation) => Boolean(highlight.note?.trim());

  const getHighlightColor = (highlight: ReaderAnnotation) =>
    !highlight.color || highlight.color === AUTO_HIGHLIGHT_COLOR || highlight.color === LEGACY_HIGHLIGHT_COLOR
      ? THEME_HIGHLIGHT_COLOR
      : highlight.color;

  const getViewportCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const getPagePointFromDocumentEvent = (event: MouseEvent) => {
    const doc = (event.currentTarget as Element | null)?.ownerDocument;
    const frameBounds = doc?.defaultView?.frameElement?.getBoundingClientRect();
    return {
      x: frameBounds ? frameBounds.left + event.clientX : event.clientX,
      y: frameBounds ? frameBounds.top + event.clientY : event.clientY,
    };
  };

  const openAnnotationPopover = (highlight: ReaderAnnotation, point?: { x: number; y: number }) => {
    emitViewerEvent(VIEWER_EVENTS.translationClose);
    emitViewerEvent(VIEWER_EVENTS.annotationOpen, {
      note: highlight.note ?? "",
      sourceText: getAnnotationText(highlight),
      value: highlight.value,
      ...(point ?? getViewportCenter()),
    });
  };

  const openContextMenu = (
    event: MouseEvent,
    content: Content,
    coordinateSpace: PointerCoordinateSpace,
  ) => {
    const hitPoint = getHitPoint(event, content, coordinateSpace);
    const [hitValue] = content.overlay?.hitTest?.(hitPoint) ?? [];
    const highlight = hitValue ? annotationRepository.getByCfi(hitValue) : undefined;
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
    const highlight = annotationRepository.getByCfi(detail.value);
    if (!highlight) return;

    const frameBounds = getContentFrameBounds(findContentByIndex(detail.index));
    const rangeBounds = detail.range?.getBoundingClientRect();
    const point = frameBounds && rangeBounds
      ? {
          x: frameBounds.left + rangeBounds.left + rangeBounds.width / 2,
          y: frameBounds.top + rangeBounds.bottom,
        }
      : getViewportCenter();

    open({ highlight, pageX: point.x, pageY: point.y });
  };

  const drawAnnotation = (detail: {
    annotation: ReaderAnnotation;
    draw: <Options extends OverlayDrawOptions>(func: OverlayDraw<Options>, options?: Options) => void;
  }) => {
    detail.draw(drawAnnotationOverlay, {
      annotationValue: detail.annotation.value,
      color: getHighlightColor(detail.annotation),
      hasNote: hasAnnotationNote(detail.annotation),
      onBadgeClick: (event) => {
        const highlight = annotationRepository.getByCfi(detail.annotation.value) ?? detail.annotation;
        if (!hasAnnotationNote(highlight)) return;
        openAnnotationPopover(highlight, getPagePointFromDocumentEvent(event));
        close();
      },
      onActivate: (event) => {
        const highlight = annotationRepository.getByCfi(detail.annotation.value)
          ?? detail.annotation;
        options.getNavigation()?.clearSelection();
        open({ highlight, pageX: event.clientX, pageY: event.clientY });
      },
    });
  };

  const addCurrentAnnotationsToOverlay = (view: ReaderView, index: number) => {
    for (const annotation of annotationRepository.forSection(index)) {
      const added = view.addAnnotation?.(annotation);
      if (added) run(added, "Failed to draw restored highlight.");
    }
  };

  const restore = async (view: ReaderView, bookKey: string) => {
    const savedHighlights = await annotationRepository.load(bookKey);
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

    if (shouldPersist) await annotationRepository.replace(bookKey, restoredHighlights);
  };

  const copyHighlight = async (highlight: ReaderAnnotation) => {
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

  const persistHighlight = async (highlight: ReaderAnnotation) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return false;

    const annotation = { ...highlight, updatedAt: Date.now() };
    markUnsaved();
    await view.addAnnotation?.(annotation);
    await annotationRepository.put(bookKey, annotation);
    return true;
  };

  const deleteHighlight = async (highlight: ReaderAnnotation) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return;

    markUnsaved();
    await view.deleteAnnotation?.(highlight);
    await annotationRepository.remove(bookKey, highlight.id);
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    close();
  };

  const deleteAnnotationNote = async (value: string) => {
    const existing = annotationRepository.getByCfi(value);
    if (!existing) return;

    const highlight: ReaderAnnotation = {
      ...existing,
      note: undefined,
    };
    if (!await persistHighlight(highlight)) return;
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
  };

  const saveAnnotationNote = async (value: string, note: string) => {
    const existing = annotationRepository.getByCfi(value);
    if (!existing) return;

    const cleanNote = note.trim();
    if (cleanNote === (existing.note?.trim() ?? "")) return;

    if (!cleanNote) {
      await deleteAnnotationNote(value);
      return;
    }

    const annotation: ReaderAnnotation = {
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
    const existing = annotationRepository.getByCfi(value);
    if (existing) {
      options.getNavigation()?.clearSelection();
      close();
      return existing;
    }

    const createdAt = Date.now();
    const annotation: ReaderAnnotation = {
      id: crypto.randomUUID(),
      value,
      color: AUTO_HIGHLIGHT_COLOR,
      text: selection.text,
      index: selection.index,
      fraction: options.getProgress(),
      createdAt,
      updatedAt: createdAt,
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
      const annotation: ReaderAnnotation = {
        ...context.highlight,
        note: context.highlight.note ?? "",
      };
      openAnnotationPopover(annotation, point);
      close();
      return;
    }

    if (!context.selection) return;

    const { value } = context.selection;
    const existing = annotationRepository.getByCfi(value);
    const createdAt = Date.now();
    const annotation: ReaderAnnotation = existing
      ? { ...existing, note: existing.note ?? "" }
      : {
          id: crypto.randomUUID(),
          value,
          color: AUTO_HIGHLIGHT_COLOR,
          note: "",
          text: context.selection.text,
          index: context.selection.index,
          fraction: options.getProgress(),
          createdAt,
          updatedAt: createdAt,
        };

    if (!existing) await persistHighlight(annotation);
    options.getNavigation()?.clearSelection();
    openAnnotationPopover(annotation, point);
    close();
  };

  const handleContextAction = (action: HighlightContextAction) => {
    switch (action) {
      case "copy":
        run(
          activeContext?.highlight ? copyHighlight(activeContext.highlight) : copySelectedText(),
          "Failed to copy reader text.",
        );
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
    annotationRepository.clearMemory();
    close();
  };

  return {
    addCurrentAnnotationsToOverlay,
    close,
    dismiss,
    drawAnnotation,
    destroy: () => {
      reset();
      translation.destroy();
      viewerEvents.abort();
    },
    flushPendingWrites: () => pendingWrites.idle(),
    getAll: () => annotationRepository.all(),
    openContextMenu,
    openFromAnnotation,
    reset,
    restore,
  };
}
