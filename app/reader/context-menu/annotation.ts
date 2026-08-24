import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "../events";
import type { ReaderAnnotation } from "../../epub/annotation";
import { annotationRepository } from "./annotation-repository";
import type { Content, OverlayDraw, OverlayDrawOptions } from "../../renderer";
import type { ReaderView } from "../model";
import type { Navigation } from "../navigation";
import { drawAnnotation as drawAnnotationOverlay } from "./annotation-overlay";
import { createTextContext, type TextContextActionDetail } from "./text-context";

type PointerCoordinateSpace = "content" | "viewport";

type AnnotationOptions = {
  getBookKey: () => string;
  getNavigation: () => Navigation | null;
  getProgress: () => number;
  getView: () => ReaderView | null;
  openExternal: (url: string) => void;
  translationModelPolicy: "allow-download" | "external-fallback";
};

type TextSelection = {
  index: number;
  range: Range;
  text: string;
  value: string;
};

type AnnotationContext = {
  highlight?: ReaderAnnotation;
  selection?: TextSelection;
};

const AUTO_HIGHLIGHT_COLOR = "auto";
const LEGACY_HIGHLIGHT_COLOR = "#f4c430";
const THEME_HIGHLIGHT_COLOR = "var(--reader-annotation-color, #f4c430)";

export function createAnnotations(options: AnnotationOptions) {
  const viewerEvents = new AbortController();
  let activeContext: AnnotationContext | null = null;
  const pendingWrites = new Set<Promise<unknown>>();
  const textContext = createTextContext({
    openExternal: options.openExternal,
    translationModelPolicy: options.translationModelPolicy,
  });
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const track = <Result>(task: Promise<Result>) => {
    pendingWrites.add(task);
    void task.finally(() => pendingWrites.delete(task)).catch(() => undefined);
    return task;
  };

  listenViewerEvent(VIEWER_EVENTS.annotationSave, (detail) => {
    run(track(saveAnnotationNote(detail.value, detail.note)), "Failed to save annotation note.");
  }, { signal: viewerEvents.signal });
  listenViewerEvent(VIEWER_EVENTS.annotationDelete, (detail) => {
    run(track(deleteAnnotationNote(detail.value)), "Failed to delete annotation note.");
  }, { signal: viewerEvents.signal });
  textContext.events.addEventListener("action", ((event: CustomEvent<TextContextActionDetail>) => {
    const context = activeContext;
    if (!context) return;
    const { action, point } = event.detail;
    if (action === "copy" || action === "translate") {
      options.getNavigation()?.clearSelection();
    } else if (action === "highlight" && context.selection) {
      run(track(highlightSelectedText(context.selection)), "Failed to save highlight.");
    } else if (action === "annotate") {
      run(track(annotateContextText(context, point)), "Failed to create annotation.");
    } else if (action === "delete" && context.highlight) {
      run(track(deleteHighlight(context.highlight)), "Failed to delete highlight.");
    }
  }) as EventListener, { signal: viewerEvents.signal });
  textContext.events.addEventListener("close", () => { activeContext = null; }, {
    signal: viewerEvents.signal,
  });

  const getContents = () => options.getView()?.renderer?.getContents?.() ?? [];

  const findContentByIndex = (index: number) => getContents().find((item) => item.index === index);

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
    selection?: TextSelection;
  }) => {
    const hasSelection = Boolean(selection);
    const hasHighlight = Boolean(highlight);
    if (!hasSelection && !hasHighlight) {
      textContext.close();
      return;
    }
    const context = { highlight, selection };
    activeContext = context;
    textContext.open({
      canDelete: hasHighlight,
      canHighlight: hasSelection,
      point: { x: pageX, y: pageY },
      text: highlight ? getAnnotationText(highlight) : selection!.text,
    });
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
        textContext.close();
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
    textContext.close();
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

  const highlightSelectedText = async (selection: TextSelection) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return;
    const { value } = selection;
    const existing = annotationRepository.getByCfi(value);
    if (existing) {
      options.getNavigation()?.clearSelection();
      textContext.close();
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
    textContext.close();
    return annotation;
  };

  const annotateContextText = async (
    context: AnnotationContext,
    point = getViewportCenter(),
  ) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return;

    if (context.highlight) {
      const annotation: ReaderAnnotation = {
        ...context.highlight,
        note: context.highlight.note ?? "",
      };
      openAnnotationPopover(annotation, point);
      textContext.close();
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
    textContext.close();
  };

  const reset = () => {
    annotationRepository.clearMemory();
    textContext.close();
  };

  return {
    addCurrentAnnotationsToOverlay,
    close: textContext.close,
    dismiss: textContext.dismiss,
    drawAnnotation,
    destroy: () => {
      reset();
      textContext.destroy();
      viewerEvents.abort();
    },
    flushPendingWrites: () => Promise.allSettled(pendingWrites).then(() => undefined),
    getAll: () => annotationRepository.all(),
    openContextMenu,
    openFromAnnotation,
    reset,
    restore,
  };
}
