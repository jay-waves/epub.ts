import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFlow,
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayout,
  applyReaderTheme,
  canChangeReaderFontSize,
  canChangeReaderLayoutLevel,
  changeReaderFlow,
  getBookStyles,
  getNextReaderThemeId,
  READER_FONT_SIZE_STEP,
  READER_LAYOUT_LEVEL_STEP,
} from "./reader-settings";
import {
  READER_FONT_FAMILY,
  READER_LATIN_FONT_FAMILY,
  READER_LATIN_FONT_FORMAT,
  READER_LATIN_ITALIC_FONT_FORMAT,
  READER_LATIN_ITALIC_FONT_URL,
  READER_LATIN_FONT_URL,
  READER_MONO_FONT_FAMILY,
  READER_MONO_FONT_FORMAT,
  READER_MONO_FONT_WEIGHT,
  READER_MONO_FONT_URL,
} from "./reader-book-styles";
import {
  createAnnotatedEpub,
  getEpubBlob,
  readEmbeddedHighlights,
} from "./epub-annotations";
import {
  createFoliateView,
  deriveBookKey,
} from "./foliate";
import { createHighlightController } from "./highlight-controller";
import {
  clearMathSvgCache,
  closeReaderContentOverlays,
  disposeReaderContent,
  prepareReaderContentDocument,
} from "./foliate/content";
import { createSearchController } from "./search-controller";
import { createBookInfo } from "./book-info";
import { App } from "./App";
import { createReadingProgressController } from "./components/reading-progress";
import type { ReadingProgressElements } from "./components/reading-progress";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { createReaderInteractions } from "./reader-interactions";
import {
  getSavedPosition,
  getSavedHighlights,
  saveReaderSettings,
  saveReadingPosition,
  setSavedHighlights,
} from "./viewer-storage";
import type { ReaderSettings, ReadingPosition } from "./reader";
import type { FoliateViewElement, RelocateDetail } from "./foliate";
import type { DockAction } from "./viewer-events";
import { createDebouncedTask, DEFAULT_READER_SETTINGS, readerSettings, runWhenIdle } from "./reader";
import { createBookSession, resetBookSession } from "./viewer-session";
import { createReaderRenderController } from "./reader-render";
import { platform } from "#platform";
import type { PlatformDocument } from "./platform/types";
import "./viewer.css";

type ViewerRuntime = {
  bookOpenToken: number;
  criticalInteractions: AbortController | null;
  disposed: boolean;
  extraInteractionsDispose: (() => void) | null;
  idleTasks: Set<() => void>;
  isSearchOpen: boolean;
  interactions: ReturnType<typeof createReaderInteractions> | null;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  lastScrollEdgeFeedbackAt: number;
  postLoadTaskToken: number;
  readerFontsReady: Promise<void> | null;
  readerEvents: AbortController | null;
  readerView: FoliateViewElement | null;
  readerViewReady: Promise<FoliateViewElement> | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  searchController: ReturnType<typeof createSearchController> | null;
  scrollEdgeFeedbackTimer?: number;
};

const runtime: ViewerRuntime = {
  bookOpenToken: 0,
  criticalInteractions: null,
  disposed: false,
  extraInteractionsDispose: null,
  idleTasks: new Set(),
  isSearchOpen: false,
  interactions: null,
  keybindings: null,
  lastScrollEdgeFeedbackAt: 0,
  postLoadTaskToken: 0,
  readerFontsReady: null,
  readerEvents: null,
  readerView: null,
  readerViewReady: null,
  readingProgressController: null,
  searchController: null,
};

const appRoot = queryRequired<HTMLElement>("#app");

function mountReadingProgressController(elements: ReadingProgressElements | null) {
  runtime.readingProgressController?.destroy();
  if (!elements) {
    runtime.readingProgressController = null;
    return;
  }

  runtime.readingProgressController = createReadingProgressController({
    ...elements,
    canSeek: () => Boolean(runtime.readerView?.book),
    onSeek: goToProgress,
  });
}

function goToProgress(progress: number) {
  if (isReaderRenderPending()) return;
  void readerRender.run(() => runtime.readerView?.goTo({ fraction: progress })).catch((error) => {
    console.warn("Failed to navigate to reading progress.", error);
  });
}

const reactRoot = createRoot(appRoot);
flushSync(() => {
  reactRoot.render(createElement(App, {
    onOpenLocalFile: platform.openLocalDocument ? (file) => {
      void openBook(platform.openLocalDocument!(file));
    } : undefined,
    onPickLocalFile: platform.pickLocalDocument ? async () => {
      const selectedDocument = await platform.pickLocalDocument!();
      if (selectedDocument) void openBook(selectedDocument);
    } : undefined,
    onReadingProgressReady: mountReadingProgressController,
  }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
const initialDocumentTitle = document.title;
const session = createBookSession();
const readerLayoutTarget = {
  root: readerRoot,
  get view() { return runtime.readerView; },
};
const readerRender = createReaderRenderController({
  root: readerRoot,
});
runtime.interactions = createReaderInteractions({
  getFlow: () => readerSettings.flow,
  onEdgeClick: (direction) => emitViewerEvent(VIEWER_EVENTS.pageTurn, direction),
  openExternal: platform.openExternal,
  root: readerRoot,
});

function getReaderFontQueries() {
  return [
    `${readerSettings.fontSize}px "${READER_FONT_FAMILY}"`,
    `${readerSettings.fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `italic ${readerSettings.fontSize}px "${READER_LATIN_FONT_FAMILY}"`,
    `${readerSettings.fontSize}px "${READER_MONO_FONT_FAMILY}"`,
  ];
}

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

function setHasUnsavedChanges(dirty: boolean) {
  session.dirty = dirty;
  renderDocumentTitle();
  emitDockUpdate();
}

function renderDocumentTitle() {
  document.title = `${session.dirty ? "*" : ""}${session.document?.name ?? initialDocumentTitle}`;
}

const SCROLL_EDGE_FEEDBACK_COOLDOWN_MS = 900;

function scheduleIdle(callback: () => void, timeout?: number) {
  let cancel = () => {};
  cancel = runWhenIdle(() => {
    runtime.idleTasks.delete(cancel);
    if (!runtime.disposed) callback();
  }, timeout);
  runtime.idleTasks.add(cancel);
}

const highlightController = createHighlightController({
  getBookKey: () => session.bookKey,
  getProgress: () => runtime.readingProgressController?.getProgress() ?? 0,
  getReaderView: () => runtime.readerView,
  openExternal: platform.openExternal,
  runWhenIdle: scheduleIdle,
  translationModelPolicy: platform.translationModelPolicy,
});

function ensureKeybindings() {
  runtime.keybindings ??= setupViewerKeybindings({
    getReaderView: () => runtime.readerView,
    getFlow: () => readerSettings.flow,
    canTurnPage: () => !isReaderRenderPending() && !document.body.classList.contains("reader-image-zoom-open"),
    beforeSectionTurn: handleBeforeSectionTurn,
    afterSectionTurn: handleAfterSectionTurn,
    onScrollEdge: showScrollEdgeFeedback,
    openSearch,
    closeSearch: clearSearchState,
    saveBook: () => { void saveAnnotatedBook(); },
  });
  if (runtime.readerView) runtime.keybindings.bindReaderView(runtime.readerView);
  return runtime.keybindings;
}

function ensureSearchController() {
  runtime.searchController ??= createSearchController({
    getBookKey: () => session.bookKey,
    getReaderView: () => runtime.readerView,
    runWithReaderRenderPending: readerRender.run,
  });
  return runtime.searchController;
}

function emitTocUpdate() {
  emitViewerEvent(VIEWER_EVENTS.tocUpdate, {
    currentHref: session.href,
    items: session.tocItems,
  });
}

function emitBookInfoUpdate() {
  const { sourceLabel = "", sourceUrl = "" } = session.document ?? {};
  emitViewerEvent(
    VIEWER_EVENTS.bookInfoUpdate,
    createBookInfo({
      book: runtime.readerView?.book,
      sourceLabel,
      sourceUrl,
    }),
  );
}

function preloadReaderFonts() {
  if (runtime.readerFontsReady) return runtime.readerFontsReady;

  const fontLoads = [
    new FontFace(READER_LATIN_FONT_FAMILY, `url("${READER_LATIN_FONT_URL}") format("${READER_LATIN_FONT_FORMAT}")`, {
      style: "normal",
      weight: "400 800",
    }).load(),
    new FontFace(
      READER_LATIN_FONT_FAMILY,
      `url("${READER_LATIN_ITALIC_FONT_URL}") format("${READER_LATIN_ITALIC_FONT_FORMAT}")`,
      {
        style: "italic",
        weight: "400 800",
      },
    ).load(),
    new FontFace(READER_MONO_FONT_FAMILY, `url("${READER_MONO_FONT_URL}") format("${READER_MONO_FONT_FORMAT}")`, {
      style: "normal",
      weight: READER_MONO_FONT_WEIGHT,
    }).load(),
  ];

  runtime.readerFontsReady = Promise.all(fontLoads)
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
    })
    .catch((error) => {
      console.warn("Failed to preload reader fonts.", error);
    });

  return runtime.readerFontsReady;
}

function getCurrentScrolledSectionAnchor() {
  if (readerSettings.flow !== "scrolled") return null;

  const renderer = runtime.readerView?.renderer;
  const { start, viewSize } = renderer ?? {};
  if (typeof start !== "number" || typeof viewSize !== "number" || viewSize <= 0) return null;

  return Math.min(1, Math.max(0, start / viewSize));
}

function saveCurrentScrolledSectionProgress() {
  if (session.scrolledSectionIndex == null) return;

  const anchor = getCurrentScrolledSectionAnchor();
  if (anchor == null) return;

  session.scrolledSectionProgress.set(session.scrolledSectionIndex, anchor);
}

function handleBeforeSectionTurn() {
  saveCurrentScrolledSectionProgress();
  session.restoreScrollPending = readerSettings.flow === "scrolled";
  readerRender.begin();
}

function handleAfterSectionTurn() {
  void readerRender.revealAfterPaint();
}

function restoreScrolledSectionProgress(sectionIndex: number | undefined) {
  if (!session.restoreScrollPending || readerSettings.flow !== "scrolled" || typeof sectionIndex !== "number") {
    session.restoreScrollPending = false;
    return;
  }

  const anchor = session.scrolledSectionProgress.get(sectionIndex);
  session.restoreScrollPending = false;
  if (typeof anchor !== "number") return;

  requestAnimationFrame(() => {
    if (readerSettings.flow !== "scrolled" || session.scrolledSectionIndex !== sectionIndex) return;

    void runtime.readerView?.renderer?.scrollToAnchor?.(anchor).catch((error) => {
      console.warn("Failed to restore section reading progress.", error);
    });
  });
}

const savePositionTask = createDebouncedTask((detail: RelocateDetail) => {
  if (session.bookKey) {
    void saveReadingPosition(session.bookKey, detail);
  }
}, 350);

function queuePositionSave(detail: RelocateDetail) {
  if (!session.bookKey || session.restoring) return;
  savePositionTask.schedule(detail);
}

function wireReaderEvents(view: FoliateViewElement) {
  runtime.readerEvents?.abort();
  const events = new AbortController();
  runtime.readerEvents = events;
  const listenerOptions = { signal: events.signal };

  view.addEventListener("load", () => {
    if (runtime.readerView === view) {
      void readerRender.revealAfterPaint();
      highlightController.bindContextTargets();
    }
  }, listenerOptions);
  view.addEventListener("unload", (event) => {
    highlightController.unbindContextDocument(event.detail.doc);
  }, listenerOptions);
  view.addEventListener("relocate", (event) => {
    const { detail } = event;
    const sectionIndex = detail.index;

    const currentHref = detail.tocItem?.href ?? "";
    if (currentHref !== session.href) {
      session.href = currentHref;
      emitTocUpdate();
    }
    runtime.readingProgressController?.handleRelocate({
      ...detail,
      index: sectionIndex,
    });
    queuePositionSave(detail);
    const previousSectionIndex = session.scrolledSectionIndex;
    session.scrolledSectionIndex = typeof sectionIndex === "number" ? sectionIndex : null;
    if (sectionIndex !== previousSectionIndex) restoreScrolledSectionProgress(sectionIndex);
  }, listenerOptions);

  view.addEventListener("create-overlay", (event) => {
    const { index } = event.detail;
    highlightController.addCurrentHighlightsToOverlay(view, index);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    highlightController.drawAnnotation(event.detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    highlightController.openFromAnnotation(event.detail);
  }, listenerOptions);
}

function emitDockUpdate() {
  const isPaginated = readerSettings.flow === "paginated";

  emitViewerEvent(VIEWER_EVENTS.dockUpdate, {
    canSearch: Boolean(runtime.readerView?.search),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling" : "Switch to paginated",
    hasUnsavedChanges: session.dirty,
    searchActive: runtime.isSearchOpen,
  });
}

async function saveAnnotatedBook() {
  const { bookKey, document } = session;
  if (!session.dirty || !bookKey || !document) return;

  try {
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    await highlightController.flushPendingAnnotationSave();

    // Browser file pickers need the live Ctrl+S/click activation, so acquire
    // the platform writer before reading annotations or serializing an EPUB.
    const target = await document.fileHandle.prepareWrite();
    if (!target) return;

    const highlights = await getSavedHighlights(bookKey);
    if ("saveAnnotations" in target) {
      if (await target.saveAnnotations(highlights)) setHasUnsavedChanges(false);
      return;
    }

    const sourceBlob = await getEpubBlob(document.sourceUrl);
    const blob = await createAnnotatedEpub(sourceBlob, highlights);
    if (blob.size === 0) throw new Error("Generated EPUB is empty.");
    if (await target.save(blob)) setHasUnsavedChanges(false);
  } catch (error) {
    if ((error as DOMException).name === "AbortError") return;
    console.warn("Failed to save annotated EPUB.", error);
  }
}

function clearSearchState() {
  runtime.isSearchOpen = false;
  runtime.searchController?.clear();
  emitDockUpdate();
}

function saveCurrentReaderSettings() {
  if (session.bookKey) void saveReaderSettings(session.bookKey, { ...readerSettings });
}

function openSearch() {
  ensureSearchController();
  runtime.isSearchOpen = true;
  emitViewerEvent(VIEWER_EVENTS.searchOpen);
  emitDockUpdate();
}

function toggleSearch() {
  if (runtime.isSearchOpen) {
    clearSearchState();
    return;
  }

  openSearch();
}

async function resetBookState(source: Parameters<typeof resetBookSession>[1], openToken: number) {
  ++runtime.postLoadTaskToken;
  savePositionTask.cancel();
  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightController.flushPendingAnnotationSave();
  if (!isCurrentBookOpen(openToken)) return false;

  if (runtime.readerView) runtime.keybindings?.unbindReaderView(runtime.readerView);
  highlightController.reset();
  await closeReaderContentOverlays();
  if (!isCurrentBookOpen(openToken)) return false;
  clearMathSvgCache();
  runtime.readerView?.close();
  if (session.document && session.document !== source.document) session.document.release?.();
  resetBookSession(session, source);
  clearSearchState();
  renderDocumentTitle();
  emitTocUpdate();
  emitBookInfoUpdate();
  runtime.readingProgressController?.setProgress(0);
  runtime.readingProgressController?.setHistoryProgress(null);
  return true;
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...DEFAULT_READER_SETTINGS, ...settings };
  const flow = runtime.readerView?.isFixedLayout ? "paginated" : nextSettings.flow;

  applyReaderTheme(nextSettings.theme);
  applyReaderFlow(flow, { root: readerRoot, view: null });
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, readerLayoutTarget);
  emitDockUpdate();
}

async function createView() {
  const view = await createFoliateView();
  if (runtime.disposed) {
    view.close();
    return view;
  }
  view.enhanceRenderedDocument = (doc) => enhanceRenderedReaderDocument(doc, view);
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  runtime.interactions?.bindView(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
}

async function getReaderView() {
  if (runtime.readerView) return runtime.readerView;

  const pendingView = runtime.readerViewReady ??= createView();
  try {
    const view = await pendingView;
    if (runtime.disposed) {
      view.close();
      return null;
    }
    return runtime.readerView ??= view;
  } finally {
    if (runtime.readerViewReady === pendingView) runtime.readerViewReady = null;
  }
}

async function enhanceRenderedReaderDocument(doc: Document, view: FoliateViewElement) {
  if (runtime.readerView === view) readerRender.begin();
  const isCurrent = () => runtime.readerView === view
    && (view.renderer?.getContents?.() ?? []).some((content) => content.doc === doc);
  try {
    await prepareReaderContentDocument(doc, {
      fontQueries: getReaderFontQueries(),
      isCurrent,
      reflowable: !view.isFixedLayout,
    });
  } catch (error) {
    console.warn("Failed to enhance reader content.", error);
  }
}

function isReaderRenderPending() {
  return readerRender.isPending();
}

function showScrollEdgeFeedback(direction: number) {
  const now = performance.now();
  if (now - runtime.lastScrollEdgeFeedbackAt < SCROLL_EDGE_FEEDBACK_COOLDOWN_MS) return;
  runtime.lastScrollEdgeFeedbackAt = now;

  const edgeClass = direction < 0 ? "reader-frame--edge-top" : "reader-frame--edge-bottom";
  readerRoot.classList.remove("reader-frame--edge-top", "reader-frame--edge-bottom");
  void readerRoot.offsetWidth;
  readerRoot.classList.add(edgeClass);

  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = window.setTimeout(() => {
    readerRoot.classList.remove(edgeClass);
    runtime.scrollEdgeFeedbackTimer = undefined;
  }, 360);
}

async function restoreSavedPosition(view: FoliateViewElement, savedPosition?: ReadingPosition) {
  session.restoring = true;
  try {
    const attempts: Array<Parameters<FoliateViewElement["init"]>[0]> = [];
    if (savedPosition?.cfi) attempts.push({ lastLocation: savedPosition.cfi });
    if (typeof savedPosition?.fraction === "number") {
      attempts.push({ lastLocation: { fraction: savedPosition.fraction } });
    }
    attempts.push({ showTextStart: true });

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await view.init(attempt);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
  } catch (error) {
    console.warn("Failed to restore saved reading position.", error);
    await view.init({ showTextStart: true });
  } finally {
    session.restoring = false;
  }
}

function isCurrentBookOpen(openToken: number) {
  return !runtime.disposed && openToken === runtime.bookOpenToken;
}

async function openBook(platformDocument: PlatformDocument) {
  const openToken = ++runtime.bookOpenToken;
  if (runtime.disposed) {
    platformDocument.release?.();
    return;
  }

  try {
    const didReset = await resetBookState({
      bookKey: platformDocument.key,
      document: platformDocument,
    }, openToken);
    if (!didReset) {
      if (session.document !== platformDocument) platformDocument.release?.();
      return;
    }

    const view = await getReaderView();
    if (!view || !isCurrentBookOpen(openToken)) return;
    readerRender.begin();
    await preloadReaderFonts();
    if (!isCurrentBookOpen(openToken)) return;
    await view.open(platformDocument.input);
    if (!isCurrentBookOpen(openToken)) return;
    emitViewerEvent(VIEWER_EVENTS.documentOpen);
    session.bookKey = await deriveBookKey(view.book, platformDocument.key);
    if (!isCurrentBookOpen(openToken)) return;
    const bookKey = session.bookKey;
    const savedPosition = await getSavedPosition(bookKey);
    if (!isCurrentBookOpen(openToken)) return;
    applyReaderSettings(savedPosition?.settings);

    emitBookInfoUpdate();
    await restoreSavedPosition(view, savedPosition);
    if (!isCurrentBookOpen(openToken)) return;
    await readerRender.revealAfterPaint();
    if (!isCurrentBookOpen(openToken)) return;
    schedulePostLoadTasks({
      bookKey,
      sourceUrl: platformDocument.sourceUrl,
      view,
    });
  } catch (error) {
    if (!isCurrentBookOpen(openToken)) return;
    readerRender.end();
    console.error(`Failed to open ${platformDocument.sourceLabel}`, error);
    if (session.document === platformDocument) {
      platformDocument.release?.();
      session.document = null;
      renderDocumentTitle();
    }
  }
}

function setupCriticalInteractions() {
  runtime.criticalInteractions?.abort();
  const interactions = new AbortController();
  runtime.criticalInteractions = interactions;
  const { signal } = interactions;
  window.addEventListener("resize", () => {
    applyReaderLayout(readerLayoutTarget);
    highlightController.close();
  }, { signal });

}

function setupExtraInteractions() {
  const disposers = [
    listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
      if (!href || isReaderRenderPending()) return;
      void readerRender.run(() => runtime.readerView?.goTo(href));
    }),
    listenViewerEvent(VIEWER_EVENTS.searchCollect, ({ highlightedOnly, query }) => {
      void ensureSearchController().collect(query, { highlightedOnly });
    }),
    listenViewerEvent(VIEWER_EVENTS.searchPrevious, () => {
      void ensureSearchController().showPrevious();
    }),
    listenViewerEvent(VIEWER_EVENTS.searchNext, () => {
      void ensureSearchController().showNext();
    }),
    listenViewerEvent(VIEWER_EVENTS.searchClear, clearSearchState),
    listenViewerEvent(VIEWER_EVENTS.highlightContextAction, (action) => {
      highlightController.handleContextAction(action);
    }),
    listenViewerEvent(VIEWER_EVENTS.unsavedChange, () => setHasUnsavedChanges(true)),
    listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
      void handleDockAction(action);
    }),
  ];

  return () => disposers.forEach((dispose) => dispose());
}

async function runReaderStyleChange(action: () => void) {
  if (isReaderRenderPending()) return;

  await readerRender.run(async () => {
    await preloadReaderFonts();
    action();
  });
}

async function handleDockAction(action: DockAction) {
  switch (action) {
    case "open-info":
      emitBookInfoUpdate();
      emitViewerEvent(VIEWER_EVENTS.bookInfoOpen);
      return;
    case "open-toc":
      emitTocUpdate();
      emitViewerEvent(VIEWER_EVENTS.tocOpen);
      return;
    case "toggle-search":
      toggleSearch();
      return;
    case "save-book":
      await saveAnnotatedBook();
      return;
    case "toggle-flow":
      await runReaderStyleChange(() => {
        changeReaderFlow(readerLayoutTarget);
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "toggle-theme":
      await runReaderStyleChange(() => {
        applyReaderTheme(getNextReaderThemeId());
        runtime.readerView?.renderer?.setStyles?.(getBookStyles());
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "decrease-font":
    case "increase-font": {
      const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
      if (!canChangeReaderFontSize(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderFontSize(readerSettings.fontSize + delta, runtime.readerView);
      });
      saveCurrentReaderSettings();
      return;
    }
    case "decrease-width":
    case "increase-width": {
      const delta = action === "decrease-width" ? -READER_LAYOUT_LEVEL_STEP : READER_LAYOUT_LEVEL_STEP;
      if (!canChangeReaderLayoutLevel(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderLayoutLevel(
          readerSettings.layoutLevel + delta,
          readerLayoutTarget,
        );
      });
      saveCurrentReaderSettings();
    }
  }
}

function setupExtraUi() {
  if (runtime.extraInteractionsDispose) return;

  ensureKeybindings();
  emitDockUpdate();
  runtime.extraInteractionsDispose = setupExtraInteractions();
}

type PostLoadTaskOptions = {
  bookKey: string;
  sourceUrl: string;
  view: FoliateViewElement;
};

type EmbeddedHighlightImportOptions = Pick<PostLoadTaskOptions, "bookKey" | "sourceUrl"> & {
  taskToken: number;
};

function schedulePostLoadTasks({ bookKey, sourceUrl, view }: PostLoadTaskOptions) {
  const taskToken = ++runtime.postLoadTaskToken;

  requestAnimationFrame(() => {
    if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;

    scheduleIdle(setupExtraUi, 1000);

    scheduleIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      void importEmbeddedHighlights({ bookKey, sourceUrl, taskToken })
        .finally(() => {
          if (runtime.readerView === view && runtime.postLoadTaskToken === taskToken) {
            highlightController.scheduleRestore(view, bookKey);
          }
        });
    }, 1500);

    scheduleIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      session.tocItems = view.book?.toc ?? [];
      emitTocUpdate();
    }, 2000);
  });
}

async function importEmbeddedHighlights({
  bookKey,
  sourceUrl,
  taskToken,
}: EmbeddedHighlightImportOptions) {
  if (runtime.postLoadTaskToken !== taskToken) return;

  try {
    const highlights = await readEmbeddedHighlights(sourceUrl);
    if (runtime.postLoadTaskToken !== taskToken) return;
    await setSavedHighlights(bookKey, highlights);
  } catch (error) {
    console.warn("Failed to read embedded EPUB overlays.", error);
  }
}

async function bootstrap() {
  applyReaderSettings(undefined);
  setupCriticalInteractions();
  void preloadReaderFonts();
  try {
    const initialDocument = await platform.loadInitialDocument();
    if (initialDocument) {
      if (runtime.disposed) return;
      void openBook(initialDocument);
      return;
    }
  } catch (error) {
    console.error("Failed to load the initial EPUB document.", error);
  }

  if (!runtime.disposed) {
    scheduleIdle(setupExtraUi, 1000);
  }
}

async function disposeViewer() {
  if (runtime.disposed) return;
  runtime.disposed = true;
  ++runtime.bookOpenToken;
  ++runtime.postLoadTaskToken;
  savePositionTask.cancel();
  runtime.idleTasks.forEach((cancel) => cancel());
  runtime.idleTasks.clear();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightController.flushPendingAnnotationSave();

  runtime.criticalInteractions?.abort();
  runtime.readerEvents?.abort();
  runtime.extraInteractionsDispose?.();
  runtime.keybindings?.destroy();
  runtime.interactions?.destroy();
  highlightController.destroy();
  runtime.searchController?.clear();
  runtime.readingProgressController?.destroy();
  await disposeReaderContent();
  clearMathSvgCache();
  runtime.readerView?.close();
  session.document?.release?.();
  session.document = null;

  runtime.readerView = null;
  runtime.readingProgressController = null;
  reactRoot.unmount();
  window.removeEventListener("pagehide", handlePageHide);
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) void disposeViewer();
}

window.addEventListener("pagehide", handlePageHide);
void bootstrap();
