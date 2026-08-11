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
import { Navigation } from "./reader/navigation";
import { ReaderDocument } from "./reader/lifecycle";
import { platform } from "#platform";
import type { PlatformDocument } from "./platform/types";
import "./viewer.css";

type ViewerRuntime = {
  criticalInteractions: AbortController | null;
  disposed: boolean;
  extraInteractionsDispose: (() => void) | null;
  idleTasks: Set<() => void>;
  isSearchOpen: boolean;
  interactions: ReturnType<typeof createReaderInteractions> | null;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  lastScrollEdgeFeedbackAt: number;
  reader: ReaderDocument | null;
  readerFontsReady: Promise<void> | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  searchController: ReturnType<typeof createSearchController> | null;
  scrollEdgeFeedbackTimer?: number;
};

const runtime: ViewerRuntime = {
  criticalInteractions: null,
  disposed: false,
  extraInteractionsDispose: null,
  idleTasks: new Set(),
  isSearchOpen: false,
  interactions: null,
  keybindings: null,
  lastScrollEdgeFeedbackAt: 0,
  reader: null,
  readerFontsReady: null,
  readingProgressController: null,
  searchController: null,
};

const getReaderView = () => runtime.reader?.view ?? null;
const getNavigation = () => runtime.reader?.navigation ?? null;

const appRoot = queryRequired<HTMLElement>("#app");

function mountReadingProgressController(elements: ReadingProgressElements | null) {
  runtime.readingProgressController?.destroy();
  if (!elements) {
    runtime.readingProgressController = null;
    return;
  }

  runtime.readingProgressController = createReadingProgressController({
    ...elements,
    canSeek: () => Boolean(getNavigation()),
    onSeek: goToProgress,
  });
}

function goToProgress(progress: number) {
  if (isReaderRenderPending()) return;
  void readerRender.run(() => getNavigation()?.go({ fraction: progress })).catch((error) => {
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
  get view() { return getReaderView(); },
};
const readerRender = createReaderRenderController({
  root: readerRoot,
});
runtime.interactions = createReaderInteractions({
  getFlow: () => readerSettings.flow,
  getNavigation,
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

function scheduleIdle(callback: () => void, timeout?: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  let cancel = () => {};
  cancel = runWhenIdle(() => {
    runtime.idleTasks.delete(cancel);
    if (!runtime.disposed && !signal?.aborted) callback();
  }, timeout);
  runtime.idleTasks.add(cancel);
  signal?.addEventListener("abort", () => {
    cancel();
    runtime.idleTasks.delete(cancel);
  }, { once: true });
}

const highlightController = createHighlightController({
  getBookKey: () => session.bookKey,
  getNavigation,
  getProgress: () => runtime.readingProgressController?.getProgress() ?? 0,
  getReaderView,
  openExternal: platform.openExternal,
  runWhenIdle: scheduleIdle,
  translationModelPolicy: platform.translationModelPolicy,
});

function ensureKeybindings() {
  runtime.keybindings ??= setupViewerKeybindings({
    getReaderView,
    getNavigation,
    getFlow: () => readerSettings.flow,
    canTurnPage: () => !isReaderRenderPending() && !document.body.classList.contains("reader-image-zoom-open"),
    beforeSectionTurn: handleBeforeSectionTurn,
    afterSectionTurn: handleAfterSectionTurn,
    onScrollEdge: showScrollEdgeFeedback,
    openSearch,
    closeSearch: clearSearchState,
    saveBook: () => { void saveAnnotatedBook(); },
  });
  const view = getReaderView();
  if (view) runtime.keybindings.bindReaderView(view);
  return runtime.keybindings;
}

function ensureSearchController() {
  runtime.searchController ??= createSearchController({
    getBookKey: () => session.bookKey,
    getNavigation,
    getReaderView,
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
      book: getReaderView()?.book,
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

  const renderer = getReaderView()?.renderer;
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

    void getReaderView()?.renderer?.scrollToAnchor?.(anchor).catch((error) => {
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

function wireReaderEvents(reader: ReaderDocument) {
  const { signal, view } = reader;
  const listenerOptions = { signal };

  view.addEventListener("load", () => {
    if (!signal.aborted) {
      void readerRender.revealAfterPaint();
      highlightController.bindContextTargets();
    }
  }, listenerOptions);
  view.addEventListener("unload", (event) => {
    highlightController.unbindContextDocument(event.detail.doc);
  }, listenerOptions);
  view.addEventListener("relocate", (event) => {
    const detail = reader.navigation?.location(event.detail);
    if (!detail) return;
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
    canSearch: Boolean(getReaderView()?.search),
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

async function resetBookState(source: Parameters<typeof resetBookSession>[1]) {
  savePositionTask.cancel();
  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightController.flushPendingAnnotationSave();

  const reader = runtime.reader;
  runtime.reader = null;
  if (reader) {
    runtime.keybindings?.unbindReaderView(reader.view);
    runtime.interactions?.unbindView(reader.view);
  }
  highlightController.reset();
  await closeReaderContentOverlays();
  await clearMathSvgCache();
  await reader?.dispose();
  resetBookSession(session, source);
  clearSearchState();
  renderDocumentTitle();
  emitTocUpdate();
  emitBookInfoUpdate();
  runtime.readingProgressController?.setProgress(0);
  runtime.readingProgressController?.setHistoryProgress(null);
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...DEFAULT_READER_SETTINGS, ...settings };
  const flow = getReaderView()?.isFixedLayout ? "paginated" : nextSettings.flow;

  applyReaderTheme(nextSettings.theme);
  applyReaderFlow(flow, { root: readerRoot, view: null });
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, readerLayoutTarget);
  emitDockUpdate();
}

async function createView() {
  const view = await createFoliateView();
  view.enhanceRenderedDocument = (doc, _index, signal) =>
    enhanceRenderedReaderDocument(doc, view, signal);
  readerRoot.replaceChildren(view);
  runtime.interactions?.bindView(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
}

async function enhanceRenderedReaderDocument(
  doc: Document,
  view: FoliateViewElement,
  signal: AbortSignal,
) {
  if (getReaderView() === view) readerRender.begin();
  try {
    await prepareReaderContentDocument(doc, {
      fontQueries: getReaderFontQueries(),
      reflowable: !view.isFixedLayout,
      signal,
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

async function restoreSavedPosition(navigation: Navigation, savedPosition?: ReadingPosition) {
  session.restoring = true;
  try {
    const attempts: Array<Parameters<Navigation["init"]>[0]> = [];
    if (savedPosition?.cfi) attempts.push({ lastLocation: savedPosition.cfi });
    if (typeof savedPosition?.fraction === "number") {
      attempts.push({ lastLocation: { fraction: savedPosition.fraction } });
    }
    attempts.push({ showTextStart: true });

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await navigation.init(attempt);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
  } catch (error) {
    console.warn("Failed to restore saved reading position.", error);
    await navigation.init({ showTextStart: true });
  } finally {
    session.restoring = false;
  }
}

let openBookTask = Promise.resolve();

function openBook(platformDocument: PlatformDocument) {
  const task = openBookTask.then(() => replaceBook(platformDocument));
  openBookTask = task.catch(() => undefined);
  return task;
}

async function replaceBook(platformDocument: PlatformDocument) {
  if (runtime.disposed) {
    platformDocument.release?.();
    return;
  }

  let reader: ReaderDocument | null = null;
  let view: FoliateViewElement | null = null;
  try {
    await resetBookState({
      bookKey: platformDocument.key,
      document: platformDocument,
    });
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");

    view = await createView();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    readerRender.begin();
    await preloadReaderFonts();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    reader = await ReaderDocument.open(platformDocument, view, (openingReader) => {
      reader = openingReader;
      runtime.reader = openingReader;
      wireReaderEvents(openingReader);
    });
    reader.signal.throwIfAborted();
    const { navigation } = reader;
    emitViewerEvent(VIEWER_EVENTS.documentOpen);
    session.bookKey = await deriveBookKey(view.book, platformDocument.key);
    reader.signal.throwIfAborted();
    const bookKey = session.bookKey;
    const savedPosition = await getSavedPosition(bookKey);
    reader.signal.throwIfAborted();
    applyReaderSettings(savedPosition?.settings);

    emitBookInfoUpdate();
    await restoreSavedPosition(navigation, savedPosition);
    reader.signal.throwIfAborted();
    await readerRender.revealAfterPaint();
    reader.signal.throwIfAborted();
    schedulePostLoadTasks({
      bookKey,
      reader,
      sourceUrl: platformDocument.sourceUrl,
    });
  } catch (error) {
    readerRender.end();
    if (runtime.reader === reader) runtime.reader = null;
    if (reader) {
      runtime.keybindings?.unbindReaderView(reader.view);
      runtime.interactions?.unbindView(reader.view);
      await reader.dispose();
    } else {
      if (view) {
        runtime.keybindings?.unbindReaderView(view);
        runtime.interactions?.unbindView(view);
        view.destroy();
      }
      platformDocument.release?.();
    }
    if ((error as DOMException).name !== "AbortError") {
      console.error(`Failed to open ${platformDocument.sourceLabel}`, error);
    }
    if (session.document === platformDocument) {
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
      void readerRender.run(() => getNavigation()?.go(href));
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
        getReaderView()?.renderer?.setStyles?.(getBookStyles());
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "decrease-font":
    case "increase-font": {
      const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
      if (!canChangeReaderFontSize(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderFontSize(readerSettings.fontSize + delta, getReaderView());
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
  reader: ReaderDocument;
  sourceUrl: string;
};

type EmbeddedHighlightImportOptions = Pick<PostLoadTaskOptions, "bookKey" | "sourceUrl"> & {
  signal: AbortSignal;
};

function schedulePostLoadTasks({ bookKey, reader, sourceUrl }: PostLoadTaskOptions) {
  const { signal, view } = reader;

  requestAnimationFrame(() => {
    if (signal.aborted) return;

    scheduleIdle(setupExtraUi, 1000, signal);

    scheduleIdle(() => {
      void importEmbeddedHighlights({ bookKey, sourceUrl, signal })
        .finally(() => {
          if (!signal.aborted) {
            highlightController.scheduleRestore(view, bookKey);
          }
        });
    }, 1500, signal);

    scheduleIdle(() => {
      session.tocItems = view.book?.toc ?? [];
      emitTocUpdate();
    }, 2000, signal);
  });
}

async function importEmbeddedHighlights({
  bookKey,
  signal,
  sourceUrl,
}: EmbeddedHighlightImportOptions) {
  if (signal.aborted) return;

  try {
    const highlights = await readEmbeddedHighlights(sourceUrl);
    if (signal.aborted) return;
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
      if (runtime.disposed) {
        initialDocument.release?.();
        return;
      }
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
  const reader = runtime.reader;
  runtime.reader = null;
  savePositionTask.cancel();
  runtime.idleTasks.forEach((cancel) => cancel());
  runtime.idleTasks.clear();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightController.flushPendingAnnotationSave();

  runtime.criticalInteractions?.abort();
  runtime.extraInteractionsDispose?.();
  runtime.keybindings?.destroy();
  runtime.interactions?.destroy();
  highlightController.destroy();
  runtime.searchController?.clear();
  runtime.readingProgressController?.destroy();
  await disposeReaderContent();
  await clearMathSvgCache();
  await reader?.dispose();
  session.document = null;

  runtime.readingProgressController = null;
  reactRoot.unmount();
  window.removeEventListener("pagehide", handlePageHide);
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) void disposeViewer();
}

window.addEventListener("pagehide", handlePageHide);
void bootstrap();
