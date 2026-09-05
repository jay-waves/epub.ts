import { emitViewerEvent, emitViewerSignal, listenViewerEvent, VIEWER_EVENTS } from "../events";
import type { ReaderAnnotation } from "../../epub/annotation";
import { annotationRepository } from "./annotation-repository";
import type { Content, OverlayDraw, OverlayDrawOptions, ReaderView } from "../../renderer";
import type { Navigation } from "../navigation";
import { drawAnnotation as drawAnnotationOverlay } from "./annotation-overlay";
import { createTextContext, type TextContextActionDetail } from "./text-context";

type PointerCoordinateSpace = "content" | "viewport";

type AnnotationOptions = {
  getBookKey: () => string;
  getNavigation: () => Navigation | null;
  getProgress: () => number;
  getView: () => ReaderView | null;
  getTranslationSourceLanguage: () => string | undefined;
  getTranslationTargetLanguage: () => string;
  openExternal: (url: string) => void;
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

function resolveAnnotationRange(anchor: (doc: Document) => Element | Range | null, doc: Document) {
  try {
    const range = anchor(doc);
    return range && "startContainer" in range ? range : null;
  } catch (error) {
    // A stale saved locator must not prevent creating or editing other notes.
    console.warn("Could not resolve saved annotation in the current document.", error);
    return null;
  }
}

export function createAnnotations(options: AnnotationOptions) {
  const viewerEvents = new AbortController();
  const pendingWrites = new Set<Promise<unknown>>();
  const run = (task: Promise<unknown>, message: string) => {
    void task.catch((error) => console.warn(message, error));
  };
  const track = <Result>(task: Promise<Result>) => {
    pendingWrites.add(task);
    void task.finally(() => pendingWrites.delete(task)).catch(() => undefined);
    return task;
  };

  const handleTextContextAction = (detail: TextContextActionDetail<AnnotationContext>) => {
    const context = detail.context;
    if (!context) return;
    const { action, point } = detail;
    if (action === "copy" || action === "lookup" || action === "translate") {
      options.getNavigation()?.clearSelection();
    } else if (action === "highlight" && context.selection) {
      run(track(highlightSelectedText(context.selection)), "Failed to save highlight.");
    } else if (action === "annotate") {
      run(track(annotateContextText(context, point)), "Failed to create annotation.");
    } else if (action === "delete" && context.highlight) {
      run(track(deleteHighlight(context.highlight)), "Failed to delete highlight.");
    }
  };

  const textContext = createTextContext<AnnotationContext>({
    getTranslationSourceLanguage: options.getTranslationSourceLanguage,
    getTranslationTargetLanguage: options.getTranslationTargetLanguage,
    openExternal: options.openExternal,
  });
  textContext.events.addEventListener("action", ((event: CustomEvent<TextContextActionDetail<AnnotationContext>>) => {
    handleTextContextAction(event.detail);
  }) as EventListener, { signal: viewerEvents.signal });

  listenViewerEvent(VIEWER_EVENTS.annotationSave, (detail) => {
    run(track(saveAnnotationNote(detail.value, detail.note)), "Failed to save annotation note.");
  }, { signal: viewerEvents.signal });
  listenViewerEvent(VIEWER_EVENTS.annotationDelete, (detail) => {
    const annotation = annotationRepository.getByCfi(detail.value);
    if (annotation) run(track(deleteHighlight(annotation)), "Failed to delete annotation.");
  }, { signal: viewerEvents.signal });
  const getContents = () => options.getView()?.renderer?.getContents() ?? [];

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
    selection = getSelectedReaderContext() ?? undefined,
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
    textContext.open({
      canDelete: hasHighlight,
      canHighlight: hasSelection,
      context,
      point: { x: pageX, y: pageY },
      text: selection ? selection.text : getAnnotationText(highlight!),
    });
  };

  const getAnnotationText = (highlight: ReaderAnnotation) => highlight.text?.trim() || highlight.value;

  const isAnnotation = (highlight: ReaderAnnotation) => highlight.note !== undefined;

  const getHighlightColor = (highlight: ReaderAnnotation) =>
    !highlight.color || highlight.color === AUTO_HIGHLIGHT_COLOR || highlight.color === LEGACY_HIGHLIGHT_COLOR
      ? THEME_HIGHLIGHT_COLOR
      : highlight.color;

  const hasSameAppearance = (left: ReaderAnnotation, right: ReaderAnnotation) =>
    getHighlightColor(left) === getHighlightColor(right)
    && isAnnotation(left) === isAnnotation(right);

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
    emitViewerSignal(VIEWER_EVENTS.translationClose);
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
      showBadge: isAnnotation(detail.annotation),
      onBadgeClick: (event) => {
        const highlight = annotationRepository.getByCfi(detail.annotation.value);
        if (!highlight || !isAnnotation(highlight)) return;
        openAnnotationPopover(highlight, getPagePointFromDocumentEvent(event));
        textContext.close();
      },
      onActivate: (event) => {
        const highlight = annotationRepository.getByCfi(detail.annotation.value);
        if (!highlight) return;
        const point = getPagePointFromDocumentEvent(event);
        if (event.type === "click") {
          options.getNavigation()?.clearSelection();
          run(
            track(annotateContextText({ highlight }, point)),
            "Failed to open annotation.",
          );
          return;
        }
        open({ highlight, pageX: point.x, pageY: point.y });
      },
    });
  };

  const restore = async (view: ReaderView, bookKey: string) => {
    const savedHighlights = await annotationRepository.load(bookKey);
    if (options.getView() !== view || options.getBookKey() !== bookKey) return;

    let shouldPersist = false;
    const sectionFractions = options.getNavigation()?.fractions() ?? [];

    const restoredHighlights = await Promise.all(
      savedHighlights.map(async (annotation) => {
        const restored = await view.addAnnotation(annotation);
        if (annotation.fraction !== undefined) return annotation;

        const index = restored?.index ?? annotation.index;
        if (index === undefined) return annotation;
        const fraction = sectionFractions[index];
        if (fraction === undefined) return annotation;

        shouldPersist = true;
        return { ...annotation, index, fraction };
      }),
    );
    if (options.getView() !== view || options.getBookKey() !== bookKey) return;

    if (shouldPersist) await annotationRepository.replace(bookKey, restoredHighlights);
  };

  const markUnsaved = () => {
    emitViewerSignal(VIEWER_EVENTS.unsavedChange);
  };

  const persistHighlight = async (
    highlight: ReaderAnnotation,
    target?: Pick<TextSelection, "index" | "range">,
  ) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return false;

    const previous = annotationRepository.getByCfi(highlight.value);
    const annotation = { ...highlight, updatedAt: Date.now() };
    markUnsaved();
    // Publish the new logical value before painting it, so overlay callbacks
    // and persistence always observe the same annotation revision.
    const persistence = annotationRepository.put(bookKey, annotation);
    await Promise.all([
      !previous || !hasSameAppearance(previous, annotation)
        ? view.addAnnotation(annotation, false, target && {
            index: target.index,
            range: target.range,
          })
        : undefined,
      persistence,
    ]);
    return true;
  };

  const deleteHighlight = async (highlight: ReaderAnnotation) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    if (!view || !bookKey) return;

    markUnsaved();
    await view.deleteAnnotation(highlight);
    await annotationRepository.remove(bookKey, highlight.id);
    emitViewerSignal(VIEWER_EVENTS.annotationClose);
    textContext.close();
  };

  const saveAnnotationNote = async (value: string, note: string) => {
    const existing = annotationRepository.getByCfi(value);
    if (!existing) return;

    const cleanNote = note.trim();
    if (!cleanNote) {
      if (existing.note === undefined) return;
      const { note: _note, ...highlight } = existing;
      await persistHighlight(highlight);
      return;
    }
    if (cleanNote === existing.note?.trim()) return;

    const annotation: ReaderAnnotation = {
      ...existing,
      note: cleanNote,
    };
    await persistHighlight(annotation);
  };

  const highlightSelectedText = async (selection: TextSelection) => {
    const view = options.getView();
    const bookKey = options.getBookKey();
    const navigation = options.getNavigation();
    if (!view || !bookKey || !navigation) return;
    const range = selection.range.cloneRange();
    const compare = (left: Range, leftEnd: boolean, right: Range, rightEnd: boolean) => {
      const a = left.cloneRange();
      const b = right.cloneRange();
      a.collapse(!leftEnd);
      b.collapse(!rightEnd);
      return a.compareBoundaryPoints(Range.START_TO_START, b);
    };
    const merged: ReaderAnnotation[] = [];
    const candidates = annotationRepository.all().flatMap(annotation => {
      const target = navigation.resolve(annotation.value);
      if (target?.index !== selection.index || typeof target.anchor !== "function") return [];
      const existingRange = resolveAnnotationRange(target.anchor, range.startContainer.ownerDocument!);
      return existingRange
        ? [{ annotation, range: existingRange }] : [];
    });
    // Repeat after extending the union so chained overlaps become one record.
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of candidates) {
        if (merged.includes(candidate.annotation)) continue;
        if (compare(range, false, candidate.range, true) >= 0
          || compare(range, true, candidate.range, false) <= 0) continue;
        merged.push(candidate.annotation);
        if (compare(candidate.range, false, range, false) < 0)
          range.setStart(candidate.range.startContainer, candidate.range.startOffset);
        if (compare(candidate.range, true, range, true) > 0)
          range.setEnd(candidate.range.endContainer, candidate.range.endOffset);
        changed = true;
      }
    }
    merged.sort((a, b) => a.createdAt - b.createdAt);
    const note = [...new Set(merged.map(item => item.note?.trim()).filter(Boolean))].join("\n\n");
    const createdAt = Date.now();
    const annotation: ReaderAnnotation = {
      id: merged[0]?.id ?? crypto.randomUUID(),
      value: navigation.cfi(selection.index, range),
      color: AUTO_HIGHLIGHT_COLOR,
      text: range.toString(),
      ...(note ? { note } : {}),
      index: selection.index,
      fraction: options.getProgress(),
      createdAt: merged[0]?.createdAt ?? createdAt,
      updatedAt: createdAt,
    };
    markUnsaved();
    const persistence = annotationRepository.replace(bookKey, [
      ...annotationRepository.all().filter(item => !merged.includes(item)), annotation,
    ]);
    await Promise.all(merged.map(item => view.deleteAnnotation(item)));
    await view.addAnnotation(annotation, false, { index: selection.index, range });
    await persistence;
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

    if (context.highlight && !context.selection) {
      const target = options.getNavigation()?.resolve(context.highlight.value);
      const content = target && findContentByIndex(target.index);
      const range = content && typeof target?.anchor === "function"
        ? resolveAnnotationRange(target.anchor, content.doc) : null;
      if (range && target) {
        context = { selection: {
          index: target.index,
          range,
          value: context.highlight.value,
          text: range.toString(),
        } };
      } else {
        openAnnotationPopover(context.highlight, point);
        textContext.close();
        return;
      }
    }

    if (!context.selection) return;

    const annotation = await highlightSelectedText(context.selection);
    if (!annotation) return;
    options.getNavigation()?.clearSelection();
    openAnnotationPopover(annotation, point);
    textContext.close();
  };

  const reset = () => {
    annotationRepository.clearMemory();
    textContext.setTranslationSourceLanguage(undefined);
    textContext.close();
  };

  return {
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
    setTranslationSourceLanguage: textContext.setTranslationSourceLanguage,
  };
}
