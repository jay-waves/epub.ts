import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayoutMode,
  applyReaderTheme,
  canChangeReaderFontSize,
  canChangeReaderLayoutLevel,
  changeReaderLayoutMode,
  getBookStyles,
  getNextReaderThemeId,
  READER_FONT_SIZE_STEP,
  READER_LAYOUT_LEVEL_STEP,
} from "./reader/settings";
import {
  createAnnotatedEpub,
  getEpubBlob,
  readEmbeddedHighlights,
} from "./epub/annotations";
import { createView } from "./renderer";
import { getBookKey } from "./epub/metadata";
import { createHighlights } from "./reader/highlights";
import {
  clearMathCache,
  closeContentOverlays,
  disposeContent,
  prepareContent,
} from "./reader/content";
import { createSearch } from "./reader/search";
import { createBookInfo } from "./reader/book-info";
import { App } from "./App";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { createViewerInput } from "./viewer-input";
import { createInteractions } from "./reader/interactions";
import {
  getSavedPosition,
  saveReaderSettings,
  saveReadingPosition,
  setSavedHighlights,
} from "./viewer-storage";
import type { ReaderSettings, ReaderView, ReadingPosition } from "./reader/model";
import type { ReaderHighlight } from "./epub/annotations";
import type { Location } from "./reader/navigation";
import type { DockAction } from "./viewer-events";
import { DEFAULT_READER_SETTINGS, readerSettings } from "./reader/model";
import { createBookSession, resetBookSession } from "./viewer-session";
import { createRenderState } from "./reader/render";
import { Navigation } from "./reader/navigation";
import { Reader } from "./reader/lifecycle";
import { getReaderFontQueries, preloadReaderFonts } from "./reader/fonts";
import { platform } from "#platform";
import type { PlatformDocument } from "./platform/types";
import { SerialTaskQueue } from "./shared/async-tasks";
import "./viewer.css";

type ViewerRuntime = {
  disposed: boolean;
  isSearchOpen: boolean;
  interactions: ReturnType<typeof createInteractions> | null;
  input: ReturnType<typeof createViewerInput> | null;
  lastScrollEdgeFeedbackAt: number;
  listeners: AbortController | null;
  reader: Reader | null;
  search: ReturnType<typeof createSearch> | null;
  scrollEdgeFeedbackTimer?: number;
};

const runtime: ViewerRuntime = {
  disposed: false,
  isSearchOpen: false,
  interactions: null,
  input: null,
  lastScrollEdgeFeedbackAt: 0,
  listeners: null,
  reader: null,
  search: null,
};

const getView = () => runtime.reader?.view ?? null;
const getNavigation = () => runtime.reader?.navigation ?? null;

const appRoot = queryRequired<HTMLElement>("#app");

function goToProgress(progress: number) {
  const navigation = getNavigation();
  if (!navigation || isReaderRenderPending()) return;
  session.tocIntent = null;
  void renderState.run(() => navigation.goToProgress(progress)).catch((error) => {
    console.warn("Failed to navigate to reading progress.", error);
  });
}

const reactRoot = createRoot(appRoot);
flushSync(() => {
  const { openLocalDocument, pickLocalDocument } = platform;
  reactRoot.render(createElement(App, {
    onOpenLocalFile: openLocalDocument ? (file) => {
      void openBook(openLocalDocument(file));
    } : undefined,
    onPickLocalFile: pickLocalDocument ? async () => {
      const selectedDocument = await pickLocalDocument();
      if (selectedDocument) void openBook(selectedDocument);
    } : undefined,
  }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
const initialDocumentTitle = document.title;
const session = createBookSession();
const readerLayoutTarget = {
  get view() { return getView(); },
};
const renderState = createRenderState(readerRoot);
runtime.interactions = createInteractions({
  navigate: async (href) => {
    const navigation = getNavigation();
    return navigation ? renderState.run(() => navigation.go(href)) : undefined;
  },
  openExternal: platform.openExternal,
});

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

const highlightState = createHighlights({
  getBookKey: () => session.bookKey,
  getNavigation,
  getProgress: () => session.progress,
  getView,
  openExternal: platform.openExternal,
  translationModelPolicy: platform.translationModelPolicy,
});

function ensureViewerInput() {
  runtime.input ??= createViewerInput({
    getView,
    getNavigation,
    getFlow: () => readerSettings.layoutMode,
    canTurnPage: () => !isReaderRenderPending() && !document.body.classList.contains("reader-image-zoom-open"),
    onChapterBoundary: showChapterBoundaryPending,
    onScrollEdge: showScrollEdgeFeedback,
    dispatchCommand: (command) => emitViewerEvent(VIEWER_EVENTS.readerCommand, command),
    dispatchProgressReturn: () => emitViewerEvent(VIEWER_EVENTS.progressReturn),
    dispatchProgressSeek: (progress) => emitViewerEvent(VIEWER_EVENTS.progressSeek, progress),
  });
  const view = getView();
  if (view) runtime.input.bindReaderView(view);
  return runtime.input;
}

function emitTocUpdate() {
  emitViewerEvent(VIEWER_EVENTS.tocUpdate, {
    currentHref: session.href,
    currentItem: session.tocItem,
    items: session.tocItems,
  });
}

function emitBookInfoUpdate() {
  const sourceLabel = session.document?.sourceLabel ?? "";
  emitViewerEvent(
    VIEWER_EVENTS.bookInfoUpdate,
    createBookInfo({
      book: getView()?.book,
      sourceLabel,
    }),
  );
}

const POSITION_SAVE_DELAY_MS = 350;
const positionWrites = new SerialTaskQueue();
const tocNavigations = new SerialTaskQueue();
let pendingPosition: { bookKey: string; detail: Location } | undefined;
let positionSaveTimer: number | undefined;

async function persistReadingPosition(bookKey: string, detail: Location) {
  try {
    await saveReadingPosition(bookKey, detail);
  } catch (error) {
    console.warn("Failed to save reading position.", error);
  }
}

function flushPositionSave() {
  window.clearTimeout(positionSaveTimer);
  positionSaveTimer = undefined;
  if (!pendingPosition) return positionWrites.idle();

  const { bookKey, detail } = pendingPosition;
  pendingPosition = undefined;
  return positionWrites.add(() => persistReadingPosition(bookKey, detail));
}

function queuePositionSave(detail: Location) {
  if (!session.bookKey || session.restoring) return;
  pendingPosition = { bookKey: session.bookKey, detail };
  window.clearTimeout(positionSaveTimer);
  positionSaveTimer = window.setTimeout(() => { void flushPositionSave(); }, POSITION_SAVE_DELAY_MS);
}

function wireReaderEvents(reader: Reader) {
  const { signal, view } = reader;
  const listenerOptions = { signal };

  view.addEventListener("load", () => {
    if (!signal.aborted) {
      void renderState.revealAfterPaint();
      highlightState.bindContextTargets();
    }
  }, listenerOptions);
  view.addEventListener("relocate", (event) => {
    const detail = reader.navigation?.location(event.detail);
    if (!detail) return;
    const sectionIndex = detail.index;
    session.sectionIndex = sectionIndex;

    let currentItem: typeof session.tocItem;
    if (detail.reason === "navigation" && session.tocIntent) {
      currentItem = session.tocIntent;
      session.tocIntent = null;
    } else if (detail.reason === "anchor") {
      // Font/image reflow restores the same logical position and must not
      // override a directory item explicitly selected by the user.
      currentItem = session.tocItem;
    } else {
      session.tocIntent = null;
      currentItem = detail.tocItem ?? null;
    }
    const currentHref = currentItem?.href ?? "";
    if (currentItem !== session.tocItem || currentHref !== session.href) {
      session.tocItem = currentItem;
      session.href = currentHref;
      emitTocUpdate();
    }
    session.progress = detail.fraction ?? session.progress;
    emitViewerEvent(VIEWER_EVENTS.progressUpdate, {
      fraction: session.progress,
      index: sectionIndex,
    });
    queuePositionSave(detail);
  }, listenerOptions);

  view.addEventListener("create-overlay", (event) => {
    const { index } = event.detail;
    highlightState.addCurrentHighlightsToOverlay(view, index);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    highlightState.drawAnnotation(event.detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    highlightState.openFromAnnotation(event.detail);
  }, listenerOptions);
}

function emitDockUpdate() {
  const layoutLabel = readerSettings.layoutMode === "paginated"
    ? "Switch to Scrolling"
    : "Switch to Paginated";

  emitViewerEvent(VIEWER_EVENTS.dockUpdate, {
    canSearch: Boolean(runtime.reader?.book),
    layoutLabel,
    hasUnsavedChanges: session.dirty,
    searchActive: runtime.isSearchOpen,
  });
}

async function saveAnnotatedBook() {
  const { bookKey, document } = session;
  if (!session.dirty || !bookKey || !document) return;

  try {
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    await highlightState.flushPendingWrites();

    // Browser file pickers need the live Ctrl+S/click activation, so acquire
    // the platform writer before reading annotations or serializing an EPUB.
    const target = await document.fileHandle.prepareWrite();
    if (!target) return;

    const highlights = highlightState.getAll();
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
  if (!runtime.isSearchOpen) return false;
  runtime.isSearchOpen = false;
  runtime.search?.clear();
  emitDockUpdate();
  return true;
}

function saveCurrentReaderSettings() {
  if (session.bookKey) {
    void saveReaderSettings(session.bookKey, { ...readerSettings }).catch((error) => {
      console.warn("Failed to save reader settings.", error);
    });
  }
}

function openSearch() {
  if (!runtime.search) return false;
  runtime.isSearchOpen = true;
  runtime.search.open();
  emitDockUpdate();
  return true;
}

function toggleSearch() {
  if (runtime.isSearchOpen) {
    clearSearchState();
    return;
  }

  openSearch();
}

async function resetBookState(source: Parameters<typeof resetBookSession>[1]) {
  await flushPositionSave();
  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightState.flushPendingWrites();

  const reader = runtime.reader;
  runtime.reader = null;
  runtime.isSearchOpen = false;
  runtime.search?.dispose();
  runtime.search = null;
  if (reader) {
    runtime.input?.unbindReaderView(reader.view);
    runtime.interactions?.unbindView(reader.view);
  }
  highlightState.reset();
  await closeContentOverlays();
  await reader?.dispose();
  await clearMathCache();
  resetBookSession(session, source);
  emitDockUpdate();
  renderDocumentTitle();
  emitTocUpdate();
  emitBookInfoUpdate();
  emitViewerEvent(VIEWER_EVENTS.progressUpdate, { fraction: 0, reset: true });
}

async function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const layoutMode: ReaderSettings["layoutMode"] = settings?.layoutMode === "scrolled"
    ? "scrolled"
    : "paginated";
  const nextSettings = { ...DEFAULT_READER_SETTINGS, ...settings, layoutMode };
  const nextLayoutMode = getView()?.renderMode === "fixed" ? "paginated" : nextSettings.layoutMode;

  applyReaderTheme(nextSettings.theme);
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, { view: null });
  await applyReaderLayoutMode(nextLayoutMode, readerLayoutTarget);
  getView()?.setStyles(getBookStyles());
  emitDockUpdate();
}

async function mountView() {
  const view = await createView<ReaderHighlight>();
  view.enhanceRenderedDocument = (doc, _index, signal) =>
    enhanceContent(doc, view.renderMode !== "fixed", signal);
  readerRoot.replaceChildren(view);
  runtime.interactions?.bindView(view);
  runtime.input?.bindReaderView(view);
  return view;
}

async function enhanceContent(
  doc: Document,
  reflowable: boolean,
  signal: AbortSignal,
) {
  try {
    await prepareContent(doc, {
      fontQueries: getReaderFontQueries(readerSettings.fontSize),
      reflowable,
      signal,
    });
  } catch (error) {
    console.warn("Failed to enhance reader content.", error);
  }
}

function isReaderRenderPending() {
  return renderState.isPending();
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

function showChapterBoundaryPending(direction: number, pending: boolean) {
  const ownClass = direction < 0
    ? "reader-frame--chapter-loading-top"
    : "reader-frame--chapter-loading-bottom";
  const otherClass = direction < 0
    ? "reader-frame--chapter-loading-bottom"
    : "reader-frame--chapter-loading-top";
  readerRoot.classList.remove(otherClass);
  readerRoot.classList.toggle(ownClass, pending);
}

async function restoreSavedPosition(navigation: Navigation, savedPosition?: ReadingPosition) {
  session.restoring = true;
  try {
    const attempts: Array<Parameters<Navigation["init"]>[0]> = [];
    if (savedPosition?.cfi) attempts.push({ lastLocation: savedPosition.cfi });
    if (typeof savedPosition?.fraction === "number") {
      attempts.push({ progress: savedPosition.fraction });
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
  } finally {
    session.restoring = false;
  }
}

const bookOpens = new SerialTaskQueue();

function openBook(platformDocument: PlatformDocument) {
  return bookOpens.add(() => replaceBook(platformDocument));
}

async function replaceBook(platformDocument: PlatformDocument) {
  if (runtime.disposed) {
    platformDocument.release?.();
    return;
  }

  let reader: Reader | null = null;
  let view: ReaderView | null = null;
  try {
    await resetBookState({
      bookKey: platformDocument.key,
      document: platformDocument,
    });
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");

    view = await mountView();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    renderState.begin();
    await preloadReaderFonts();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    reader = new Reader(platformDocument, view);
    runtime.reader = reader;
    wireReaderEvents(reader);
    await reader.open();
    reader.signal.throwIfAborted();
    const { navigation } = reader;
    emitViewerEvent(VIEWER_EVENTS.documentOpen);
    session.bookKey = await getBookKey(view.book, platformDocument.key);
    reader.signal.throwIfAborted();
    const bookKey = session.bookKey;
    runtime.search = createSearch({
      book: reader.book,
      bookKey,
      navigation,
      run: renderState.run,
      signal: reader.signal,
      view,
    });
    const savedPosition = await getSavedPosition(bookKey);
    reader.signal.throwIfAborted();
    await applyReaderSettings(savedPosition?.settings);

    emitBookInfoUpdate();
    session.tocItems = view.book?.toc ?? [];
    emitTocUpdate();
    await restoreHighlights(reader, bookKey);
    reader.signal.throwIfAborted();
    await restoreSavedPosition(navigation, savedPosition);
    reader.signal.throwIfAborted();
    await renderState.revealAfterPaint();
    reader.signal.throwIfAborted();
  } catch (error) {
    renderState.end();
    runtime.search?.dispose();
    runtime.search = null;
    if (runtime.reader === reader) runtime.reader = null;
    if (reader) {
      runtime.input?.unbindReaderView(reader.view);
      runtime.interactions?.unbindView(reader.view);
      await reader.dispose();
    } else {
      if (view) {
        runtime.input?.unbindReaderView(view);
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
      session.bookKey = "";
      renderDocumentTitle();
      emitDockUpdate();
    }
  }
}

function setupEventListeners(signal: AbortSignal) {
  window.addEventListener("resize", () => {
    highlightState.close();
  }, { signal });

  listenViewerEvent(VIEWER_EVENTS.tocNavigate, ({ href, item }) => {
    if (!href) return;
    void tocNavigations.add(async () => {
      const navigation = getNavigation();
      if (!navigation) return;
      session.tocIntent = item;
      try {
        await renderState.run(() => navigation.go(href));
      } catch (error) {
        if (session.tocIntent === item) session.tocIntent = null;
        console.warn("Failed to open table-of-contents entry.", error);
      }
    });
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.progressSeek, goToProgress, { signal });
  listenViewerEvent(VIEWER_EVENTS.readerCommand, (command) => {
    switch (command) {
      case "page-left":
        runtime.input?.turnPage("left");
        return;
      case "page-right":
        runtime.input?.turnPage("right");
        return;
      case "page-up":
        runtime.input?.turnWholePage(-1);
        return;
      case "page-down":
        runtime.input?.turnWholePage(1);
        return;
      case "scroll-up":
        runtime.input?.scrollByKey(-1);
        return;
      case "scroll-down":
        runtime.input?.scrollByKey(1);
        return;
      case "open-search":
        openSearch();
        return;
      case "escape":
        clearSearchState();
        emitViewerEvent(VIEWER_EVENTS.tocClose);
        return;
      case "save-book":
        void saveAnnotatedBook();
        return;
      case "zoom-in":
      case "zoom-out":
        void handleDockAction(command === "zoom-in" ? "increase-width" : "decrease-width")
          .catch((error) => console.warn(`Failed to run reader command ${command}.`, error));
        return;
      case "open-toc":
        emitTocUpdate();
        emitViewerEvent(VIEWER_EVENTS.tocOpen);
    }
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.searchCollect, ({ highlightedOnly, query }) => {
    void runtime.search?.collect(query, highlightedOnly);
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.searchPrevious, () => {
    void runtime.search?.previous();
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.searchNext, () => {
    void runtime.search?.next();
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.searchClear, clearSearchState, { signal });
  listenViewerEvent(VIEWER_EVENTS.unsavedChange, () => setHasUnsavedChanges(true), { signal });
  listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
    void handleDockAction(action).catch((error) => {
      console.warn("Failed to apply reader action.", error);
    });
  }, { signal });
}

async function runReaderStyleChange(action: () => void | Promise<void>) {
  if (isReaderRenderPending()) return;

  await renderState.run(async () => {
    await preloadReaderFonts();
    await action();
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
    case "toggle-layout":
      await runReaderStyleChange(() => {
        return changeReaderLayoutMode(readerLayoutTarget);
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "toggle-theme":
      await runReaderStyleChange(() => {
        applyReaderTheme(getNextReaderThemeId());
        getView()?.setStyles(getBookStyles());
      });
      saveCurrentReaderSettings();
      emitDockUpdate();
      return;
    case "decrease-font":
    case "increase-font": {
      const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
      if (!canChangeReaderFontSize(delta)) return;
      await runReaderStyleChange(() => {
        applyReaderFontSize(readerSettings.fontSize + delta, getView());
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

async function restoreHighlights(reader: Reader, bookKey: string) {
  const { book, signal, view } = reader;
  if (signal.aborted) return;

  try {
    const highlights = await readEmbeddedHighlights(book);
    if (signal.aborted) return;
    if (highlights) await setSavedHighlights(bookKey, highlights);
  } catch (error) {
    console.warn("Failed to read embedded EPUB highlights.", error);
  }
  if (signal.aborted) return;
  try {
    await highlightState.restore(view, bookKey);
  } catch (error) {
    console.warn("Failed to restore saved highlights.", error);
  }
}

async function bootstrap() {
  await applyReaderSettings(undefined);
  runtime.listeners = new AbortController();
  setupEventListeners(runtime.listeners.signal);
  ensureViewerInput();
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
}

async function disposeViewer() {
  if (runtime.disposed) return;
  runtime.disposed = true;
  const reader = runtime.reader;
  runtime.reader = null;
  await flushPositionSave();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await highlightState.flushPendingWrites();

  runtime.listeners?.abort();
  runtime.input?.destroy();
  runtime.interactions?.destroy();
  highlightState.destroy();
  runtime.search?.dispose();
  runtime.search = null;
  await disposeContent();
  await reader?.dispose();
  await clearMathCache();
  session.document = null;

  reactRoot.unmount();
  window.removeEventListener("pagehide", handlePageHide);
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) {
    void disposeViewer().catch((error) => console.warn("Failed to dispose viewer cleanly.", error));
  }
}

window.addEventListener("pagehide", handlePageHide);
void bootstrap().catch((error) => console.error("Failed to start viewer.", error));
