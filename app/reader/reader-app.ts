import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFonts,
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayoutMode,
  applyReaderTheme,
  applyReaderTextAlignment,
  canChangeReaderFontSize,
  canChangeReaderLayoutLevel,
  changeReaderLayoutMode,
  getBookStyles,
  getNextReaderThemeId,
  READER_FONT_SIZE_STEP,
  READER_LAYOUT_LEVEL_STEP,
} from "./settings";
import {
  createAnnotatedEpub,
  getEpubBlob,
  readEmbeddedAnnotations,
} from "../epub/annotation";
import { createView } from "../renderer";
import { getBookKey } from "../epub/metadata";
import { createAnnotations } from "./context-menu/annotation";
import {
  clearMathCache,
  prepareTypography,
} from "../typography";
import {
  closeContentOverlays,
  disposeContent,
  enhanceImages,
} from "./image-zoom";
import { createSearch } from "./search";
import { createBookInfo } from "./book-info";
import { App } from "./ui/App";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./events";
import { createViewerInput } from "./input";
import { createInteractions } from "./interactions";
import {
  getSavedPosition,
  saveReaderSettings,
  saveReadingPosition,
} from "./storage";
import type { ReaderSettings, ReaderView, ReadingPosition } from "./model";
import type { ReaderAnnotation } from "../epub/annotation";
import { annotationRepository } from "./context-menu/annotation-repository";
import type { Location } from "./navigation";
import type { DockAction, ReaderCommand } from "./events";
import { DEFAULT_READER_SETTINGS, readerSettings } from "./model";
import { createAdvancedSettingsController } from "./advanced-settings";
import type { AdvancedReaderSettings } from "./advanced-settings";
import { createBookSession, resetBookSession } from "./session";
import { createRenderState } from "./render";
import { Navigation } from "./navigation";
import { Reader } from "./lifecycle";
import { getReaderFontQueries, preloadReaderFonts } from "../typography/fonts";
import { platform } from "#platform";
import type { PlatformDocument } from "../platform/types";
import { startupTrace } from "../startup-trace";
import "./ui/reader.css";

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

const advancedSettings = createAdvancedSettingsController(applyAdvancedSettings);

console.log(`[epub.ts] v${__EPUB_TS_VERSION__} · built ${__EPUB_TS_BUILD_TIME__}`);
if (advancedSettings.logStatus()) {
  console.log(
    "[epub.ts] Configure with epub.settings.setSerifFont(...), setSansFont(...), setMonoFont(...), "
      + "epub.settings.setTextAlignment('auto' | 'start' | 'justify'), or epub.settings.reset().",
  );
}

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
  closeContentMenu: () => annotationState.dismiss(),
  navigate: async (href) => {
    const navigation = getNavigation();
    return navigation ? renderState.run(() => navigation.go(href)) : undefined;
  },
  openContentMenu: (event, content, coordinateSpace) =>
    annotationState.openContextMenu(event, content, coordinateSpace),
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

const annotationState = createAnnotations({
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
  emitViewerEvent(
    VIEWER_EVENTS.bookInfoUpdate,
    createBookInfo(getView()?.book),
  );
}

const POSITION_SAVE_DELAY_MS = 350;
let pendingPositionWrite = Promise.resolve();
let pendingTocNavigation = Promise.resolve();
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
  if (!pendingPosition) return pendingPositionWrite;

  const { bookKey, detail } = pendingPosition;
  pendingPosition = undefined;
  const result = pendingPositionWrite.then(() => persistReadingPosition(bookKey, detail));
  pendingPositionWrite = result.then(() => undefined, () => undefined);
  return result;
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
    annotationState.addCurrentAnnotationsToOverlay(view, index);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    annotationState.drawAnnotation(event.detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    annotationState.openFromAnnotation(event.detail);
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
    await annotationState.flushPendingWrites();

    // Browser file pickers need the live Ctrl+S/click activation, so acquire
    // the platform writer before reading annotations or serializing an EPUB.
    const target = await document.fileHandle.prepareWrite();
    if (!target) return;

    const highlights = annotationState.getAll();
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
  await annotationState.flushPendingWrites();

  const reader = runtime.reader;
  runtime.reader = null;
  runtime.isSearchOpen = false;
  runtime.search?.dispose();
  runtime.search = null;
  if (reader) {
    runtime.input?.unbindReaderView(reader.view);
    runtime.interactions?.unbindView(reader.view);
  }
  annotationState.reset();
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
  const nextSettings = {
    ...DEFAULT_READER_SETTINGS,
    ...settings,
    fonts: advancedSettings.value.fonts,
    layoutMode,
    textAlignment: advancedSettings.value.textAlignment,
  };
  const nextLayoutMode = getView()?.renderMode === "fixed" ? "paginated" : nextSettings.layoutMode;

  applyReaderTheme(nextSettings.theme);
  applyReaderFonts(nextSettings.fonts);
  applyReaderTextAlignment(nextSettings.textAlignment);
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, { view: null });
  await applyReaderLayoutMode(nextLayoutMode, readerLayoutTarget);
  getView()?.setStyles(getBookStyles());
  emitDockUpdate();
}

async function mountView() {
  const view = await createView<ReaderAnnotation>();
  view.enhanceRenderedDocument = (doc, _index, signal) =>
    enhanceContent(
      doc,
      view.renderMode !== "fixed",
      view.renderMode === "paginated",
      signal,
      view.book?.metadata?.language,
    );
  readerRoot.replaceChildren(view);
  runtime.interactions?.bindView(view);
  runtime.input?.bindReaderView(view);
  return view;
}

async function enhanceContent(
  doc: Document,
  reflowable: boolean,
  paginated: boolean,
  signal: AbortSignal,
  language: unknown,
) {
  try {
    await prepareTypography(doc, {
      fontQueries: getReaderFontQueries(readerSettings.fontSize),
      language,
      paginated,
      reflowable,
      signal,
    });
    if (reflowable && !signal.aborted) enhanceImages(doc, signal);
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

let pendingBookOpen = Promise.resolve();

function openBook(platformDocument: PlatformDocument) {
  const result = pendingBookOpen.then(() => replaceBook(platformDocument));
  pendingBookOpen = result.then(() => undefined, () => undefined);
  return result;
}

async function replaceBook(platformDocument: PlatformDocument) {
  if (runtime.disposed) {
    platformDocument.release?.();
    return;
  }

  let reader: Reader | null = null;
  let view: ReaderView | null = null;
  startupTrace.start("document-opening", { source: platformDocument.sourceLabel });
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
    await restoreAnnotations(reader, bookKey);
    reader.signal.throwIfAborted();
    await restoreSavedPosition(navigation, savedPosition);
    reader.signal.throwIfAborted();
    const paintStartedAt = performance.now();
    await renderState.revealAfterPaint();
    reader.signal.throwIfAborted();
    const initialDomElementCount = (reader.view.renderer.getContents?.() ?? []).reduce(
      (total, { doc }) => total + (doc?.querySelectorAll("*").length ?? 0),
      0,
    );
    startupTrace.complete("document-opening", {
      finalPaintMs: Math.round(performance.now() - paintStartedAt),
      initialDomElementCount,
      renderMode: reader.view.renderMode,
      ...startupTrace.epubResources(),
    });
    startupTrace.finish();
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
      console.error(`Failed to open ${platformDocument.sourceLabel}`, {
        error,
      });
      startupTrace.fail("document-opening", error, { source: platformDocument.sourceLabel });
    } else startupTrace.cancel("document-opening");
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
    annotationState.close();
  }, { signal });

  listenViewerEvent(VIEWER_EVENTS.tocNavigate, ({ href, item }) => {
    if (!href) return;
    const navigation = pendingTocNavigation.then(async () => {
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
    pendingTocNavigation = navigation.then(() => undefined, () => undefined);
    void navigation;
  }, { signal });
  listenViewerEvent(VIEWER_EVENTS.progressSeek, goToProgress, { signal });
  const runDockCommand = (command: "zoom-in" | "zoom-out", action: DockAction) => {
    void handleDockAction(action)
      .catch((error) => console.warn(`Failed to run reader command ${command}.`, error));
  };
  const readerCommandHandlers = {
    "step-left": () => runtime.input?.executeStep("left"),
    "step-right": () => runtime.input?.executeStep("right"),
    "paginate-previous": () => runtime.input?.executePaginate(-1),
    "paginate-next": () => runtime.input?.executePaginate(1),
    "scroll-previous": () => runtime.input?.scrollByKey(-1),
    "scroll-next": () => runtime.input?.scrollByKey(1),
    "open-search": openSearch,
    escape: () => {
      clearSearchState();
      emitViewerEvent(VIEWER_EVENTS.tocClose);
    },
    "save-book": () => {
      void saveAnnotatedBook();
    },
    "toggle-dock": () => emitViewerEvent(VIEWER_EVENTS.dockToggle),
    "zoom-in": () => runDockCommand("zoom-in", "increase-width"),
    "zoom-out": () => runDockCommand("zoom-out", "decrease-width"),
    "open-toc": () => {
      emitTocUpdate();
      emitViewerEvent(VIEWER_EVENTS.tocOpen);
    },
  } satisfies Record<ReaderCommand, () => void>;
  listenViewerEvent(VIEWER_EVENTS.readerCommand, (command) => readerCommandHandlers[command](), { signal });
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

async function applyAdvancedSettings(settings: AdvancedReaderSettings) {
  const apply = () => {
    applyReaderFonts(settings.fonts);
    applyReaderTextAlignment(settings.textAlignment);
    getView()?.setStyles(getBookStyles());
  };
  if (getView()) await runReaderStyleChange(apply);
  else apply();
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

async function restoreAnnotations(reader: Reader, bookKey: string) {
  const { book, signal, view } = reader;
  if (signal.aborted) return;

  try {
    const highlights = await readEmbeddedAnnotations(book);
    if (signal.aborted) return;
    if (highlights) await annotationRepository.replace(bookKey, highlights);
  } catch (error) {
    console.warn("Failed to read embedded EPUB highlights.", error);
  }
  if (signal.aborted) return;
  try {
    await annotationState.restore(view, bookKey);
  } catch (error) {
    console.warn("Failed to restore saved highlights.", error);
  }
}

async function bootstrap() {
  const startedAt = performance.now();
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
    console.error("[EPUB.ts] Failed to load the initial EPUB document.", {
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
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
  await annotationState.flushPendingWrites();

  runtime.listeners?.abort();
  runtime.input?.destroy();
  runtime.interactions?.destroy();
  annotationState.destroy();
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
