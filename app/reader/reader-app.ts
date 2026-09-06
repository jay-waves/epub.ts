import { createElement, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
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
  READER_FONT_SIZE_STEP,
  READER_LAYOUT_LEVEL_STEP,
} from "./settings";
import {
  createAnnotatedEpub,
  getEpubBlob,
  readEmbeddedAnnotations,
} from "../epub/annotation";
import { createView } from "../renderer";
import type { ReaderView, TocItem } from "../renderer";
import { getBookKey } from "../epub/metadata";
import { createAnnotations } from "./context-menu/annotation";
import { annotationRepository } from "./context-menu/annotation-repository";
import { detectDocumentLanguage } from "./context-menu/document-language";
import {
  clearMathCache,
  prepareTypography,
} from "../typography";
import { closeContentOverlays, disposeContent } from "./image-zoom";
import { createSearch } from "./search";
import { createBookInfo } from "./book-info";
import { App } from "./ui/App";
import { createViewerInput } from "./input";
import { createInteractions } from "./interactions";
import {
  getSavedPosition,
  saveReaderSettings,
  saveReadingPosition,
} from "./storage";
import type { ReaderSettings, ReadingDirection } from "./model";
import type { Location } from "./navigation";
import type { DockAction, ReaderCommand, ReaderUiActions, ReaderUiState } from "./ui/model";
import { DEFAULT_READER_SETTINGS, readerSettings } from "./model";
import { createAdvancedSettingsController } from "./advanced-settings";
import type { AdvancedReaderSettings } from "./advanced-settings";
import { createRenderState } from "./render";
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

type BookSession = {
  bookKey: string;
  document: PlatformDocument | null;
  dirty: boolean;
  tocItem: TocItem | null;
  tocIntent: TocItem | null;
  progress: number;
  restoring: boolean;
};

type UiUpdate = Partial<ReaderUiState> | ((state: ReaderUiState) => Partial<ReaderUiState>);
let dispatchUi: (update: UiUpdate) => void = () => {};
let readUi: () => ReaderUiState | undefined = () => undefined;

function updateUi(update: UiUpdate) {
  dispatchUi(update);
}

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
advancedSettings.logStatus();

const getView = () => runtime.reader?.view ?? null;
const getNavigation = () => runtime.reader?.navigation ?? null;

const appRoot = queryRequired<HTMLElement>("#app");
const initialDocument = platform.loadInitialDocument();
void initialDocument?.catch(() => {}); // Reported by bootstrap after initialization.

function goToProgress(progress: number) {
  const navigation = getNavigation();
  if (!navigation || isReaderRenderPending()) return;
  session.tocIntent = null;
  void renderState.run(() => navigation.goToProgress(progress)).catch((error) => {
    console.warn("Failed to navigate to reading progress.", error);
  });
}

let readerRoot: HTMLDivElement;
let renderState: ReturnType<typeof createRenderState>;
const initialDocumentTitle = document.title;
const session: BookSession = {
  bookKey: "",
  document: null,
  dirty: false,
  tocItem: null,
  tocIntent: null,
  progress: 0,
  restoring: false,
};
const readerLayoutTarget = {
  get view() { return getView(); },
};
function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

function setHasUnsavedChanges(dirty: boolean) {
  session.dirty = dirty;
  renderDocumentTitle();
  updateDock();
}

function renderDocumentTitle() {
  document.title = `${session.dirty ? "*" : ""}${session.document?.name ?? initialDocumentTitle}`;
}

const SCROLL_EDGE_FEEDBACK_COOLDOWN_MS = 900;

const annotationState = createAnnotations({
  closeAnnotation: () => closeAnnotation(),
  getBookKey: () => session.bookKey,
  getNavigation,
  getProgress: () => session.progress,
  getView,
  getTranslationSourceLanguage: () =>
    advancedSettings.value.translationSourceLanguage ?? undefined,
  getTranslationTargetLanguage: () => advancedSettings.value.translationTargetLanguage,
  onUnsaved: () => setHasUnsavedChanges(true),
  openExternal: platform.openExternal,
  updateUi,
});

function closeAnnotation() {
  const annotation = readUi()?.annotation;
  if (annotation) annotationState.saveAnnotation(annotation.value, annotation.note);
  updateUi({ annotation: null });
}

function ensureViewerInput() {
  runtime.input ??= createViewerInput({
    getView,
    getNavigation,
    getFlow: () => readerSettings.layoutMode,
    canTurnPage: () => !isReaderRenderPending() && !document.body.classList.contains("reader-image-zoom-open"),
    onChapterBoundary: showChapterBoundaryPending,
    onScrollEdge: showScrollEdgeFeedback,
    dispatchCommand: runReaderCommand,
    dispatchProgressReturn: () => updateUi((state) => ({
      progressReturnRequest: state.progressReturnRequest + 1,
    })),
    dispatchProgressSeek: goToProgress,
  });
  const view = getView();
  if (view) runtime.input.bindReaderView(view);
  return runtime.input;
}

function updateToc() {
  updateUi({ toc: {
    currentHref: session.tocItem?.href ?? "",
    currentItem: session.tocItem,
    items: getView()?.book?.toc ?? [],
  } });
}

function updateBookInfo() {
  updateUi({ bookInfo: createBookInfo(getView()?.book) });
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

  view.addEventListener("relocate", (event) => {
    const detail = reader.navigation.location(event.detail);
    const preserveSemanticLocation = detail.reason === "anchor" || detail.reason === "switch";

    let currentItem: typeof session.tocItem;
    if (detail.reason === "navigation" && session.tocIntent) {
      currentItem = session.tocIntent;
      session.tocIntent = null;
    } else if (preserveSemanticLocation) {
      // Font/image reflow restores the same logical position and must not
      // override a directory item explicitly selected by the user.
      currentItem = session.tocItem;
    } else {
      session.tocIntent = null;
      currentItem = detail.tocItem ?? null;
    }
    if (currentItem !== session.tocItem) {
      session.tocItem = currentItem;
      updateToc();
    }
    session.progress = detail.fraction;
    updateUi({ progress: {
      fraction: session.progress,
      index: detail.index,
    } });
    queuePositionSave(detail);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    annotationState.drawAnnotation(event.detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    annotationState.openFromAnnotation(event.detail);
  }, listenerOptions);
}

function updateDock() {
  const layoutLabel = readerSettings.layoutMode === "paginated"
    ? "Switch to Scrolling"
    : "Switch to Paginated";

  updateUi({ dock: {
    canSearch: Boolean(runtime.reader?.book),
    layoutLabel,
    hasUnsavedChanges: session.dirty,
    searchActive: runtime.isSearchOpen,
  } });
}

async function saveAnnotatedBook() {
  const { bookKey, document } = session;
  if (!session.dirty || !bookKey || !document) return;

  try {
    closeAnnotation();
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
  updateDock();
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
  updateDock();
  return true;
}

function toggleSearch() {
  if (runtime.isSearchOpen) {
    clearSearchState();
    return;
  }

  openSearch();
}

async function resetBookState(source: Pick<BookSession, "bookKey" | "document">) {
  await flushPositionSave();
  closeAnnotation();
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
  session.bookKey = source.bookKey;
  session.document = source.document;
  session.dirty = false;
  session.tocItem = null;
  session.tocIntent = null;
  session.progress = 0;
  session.restoring = false;
  updateDock();
  renderDocumentTitle();
  updateToc();
  updateBookInfo();
  updateUi({ progress: { fraction: 0, reset: true } });
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
  getView()?.setStyles(getBookStyles());
  await applyReaderLayoutMode(nextLayoutMode, readerLayoutTarget);
  updateDock();
}

async function mountView() {
  const view = await createView();
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
  language?: string | string[],
) {
  try {
    await prepareTypography(doc, {
      fontQueries: getReaderFontQueries(readerSettings.fontSize),
      language,
      paginated,
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

function showScrollEdgeFeedback(direction: ReadingDirection) {
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

function showChapterBoundaryPending(direction: ReadingDirection, pending: boolean) {
  const ownClass = direction < 0
    ? "reader-frame--chapter-loading-top"
    : "reader-frame--chapter-loading-bottom";
  const otherClass = direction < 0
    ? "reader-frame--chapter-loading-bottom"
    : "reader-frame--chapter-loading-top";
  readerRoot.classList.remove(otherClass);
  readerRoot.classList.toggle(ownClass, pending);
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
  let render: ReturnType<typeof renderState.begin> | undefined;
  startupTrace.start("document-opening", { source: platformDocument.sourceLabel });
  try {
    await resetBookState({
      bookKey: platformDocument.key,
      document: platformDocument,
    });
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");

    view = await mountView();
    if (runtime.disposed) throw new DOMException("Viewer disposed", "AbortError");
    render = renderState.begin();
    const fontsReady = preloadReaderFonts();
    reader = new Reader(platformDocument, view);
    runtime.reader = reader;
    wireReaderEvents(reader);
    await reader.open(fontsReady);
    reader.signal.throwIfAborted();
    annotationState.setTranslationSourceLanguage(
      detectDocumentLanguage(reader.book, reader.signal),
    );
    const { navigation } = reader;
    updateUi({ welcome: false });
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
      onUpdate: (search) => updateUi({ search }),
    });
    const savedPosition = await getSavedPosition(bookKey);
    reader.signal.throwIfAborted();
    await applyReaderSettings(savedPosition?.settings);

    updateBookInfo();
    updateToc();
    await restoreAnnotations(reader, bookKey);
    reader.signal.throwIfAborted();
    session.restoring = true;
    try {
      await navigation.restore(savedPosition);
    } finally {
      session.restoring = false;
    }
    reader.signal.throwIfAborted();
    const paintStartedAt = performance.now();
    await render.revealAfterPaint();
    reader.signal.throwIfAborted();
    const initialDomElementCount = reader.view.renderer.getContents().reduce(
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
    render?.end();
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
      updateDock();
      updateUi({ welcome: true });
    }
  }
}

function navigateToc(item: TocItem) {
  if (!item.href) return;
  const task = pendingTocNavigation.then(async () => {
    const navigation = getNavigation();
    if (!navigation) return;
    session.tocIntent = item;
    try {
      await renderState.run(() => navigation.go(item.href!));
    } catch (error) {
      if (session.tocIntent === item) session.tocIntent = null;
      console.warn("Failed to open table-of-contents entry.", error);
    }
  });
  pendingTocNavigation = task.then(() => undefined, () => undefined);
}

function runReaderCommand(command: ReaderCommand) {
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
      updateUi({ tocOpen: false });
    },
    "save-book": () => {
      void saveAnnotatedBook();
    },
    "toggle-dock": () => updateUi((state) => ({ dockOpen: !state.dockOpen })),
    "zoom-in": () => runDockCommand("zoom-in", "increase-width"),
    "zoom-out": () => runDockCommand("zoom-out", "decrease-width"),
    "open-toc": () => {
      updateToc();
      updateUi({ tocOpen: true });
    },
  } satisfies Record<ReaderCommand, () => void>;
  readerCommandHandlers[command]();
}

function selectTheme(theme: Parameters<typeof applyReaderTheme>[0]) {
  updateUi({ theme });
  void runReaderStyleChange(() => {
    applyReaderTheme(theme);
    getView()?.setStyles(getBookStyles(), { reflow: false });
  }).then(() => {
    saveCurrentReaderSettings();
    updateDock();
  }).catch((error) => console.warn("Failed to apply reader theme.", error));
}

function setupEventListeners(signal: AbortSignal) {
  window.addEventListener("resize", annotationState.close, { signal });
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
      updateBookInfo();
      updateUi({ bookInfoOpen: true });
      return;
    case "open-toc":
      updateToc();
      updateUi({ tocOpen: true });
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
      updateDock();
      return;
    case "open-theme":
      updateUi({ theme: readerSettings.theme });
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
    // An EPUB overlay is the committed state, including an explicitly empty
    // list. Platform metadata is only a recovery draft when no overlay exists.
    if (highlights !== null) await annotationRepository.replace(bookKey, highlights);
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
    if (!initialDocument) return;
    const document = await initialDocument;
    if (runtime.disposed) {
      document.release?.();
      return;
    }
    void openBook(document);
  } catch (error) {
    console.error("[EPUB.ts] Failed to load the initial EPUB document.", {
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    updateUi({ welcome: true });
  }
}

async function disposeViewer() {
  if (runtime.disposed) return;
  runtime.disposed = true;
  const reader = runtime.reader;
  await flushPositionSave();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  closeAnnotation();
  await annotationState.flushPendingWrites();
  runtime.reader = null;

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
}

function handlePageHide(event: PageTransitionEvent) {
  if (!event.persisted) {
    void disposeViewer().catch((error) => console.warn("Failed to dispose viewer cleanly.", error));
  }
}

function initializeReaderRoot(node: HTMLDivElement | null) {
  if (!node || readerRoot) return;
  readerRoot = node;
  renderState = createRenderState(node);
  runtime.interactions = createInteractions({
    navigate: async (href) => {
      const navigation = getNavigation();
      return navigation ? renderState.run(() => navigation.go(href)) : undefined;
    },
    openContentMenu: (event, content, coordinateSpace) =>
      annotationState.openContextMenu(event, content, coordinateSpace),
    openExternal: platform.openExternal,
    updateUi,
  });
}

function createInitialUiState(): ReaderUiState {
  return {
    annotation: null,
    bookInfo: createBookInfo(),
    bookInfoOpen: false,
    contextMenu: null,
    dock: {
      canSearch: false,
      hasUnsavedChanges: false,
      layoutLabel: "Switch to Scrolling",
      searchActive: false,
    },
    dockOpen: false,
    progress: { fraction: 0, reset: true },
    progressReturnRequest: 0,
    search: { hitCount: 0, hitIndex: -1, placeholder: "Search text", visible: false },
    theme: null,
    toc: { currentHref: "", items: [] },
    tocOpen: false,
    translation: null,
    welcome: !initialDocument,
  };
}

function uiReducer(state: ReaderUiState, update: UiUpdate) {
  return { ...state, ...(typeof update === "function" ? update(state) : update) };
}

function ReaderApplication() {
  const [state, dispatch] = useReducer(uiReducer, undefined, createInitialUiState);
  const stateRef = useRef(state);
  stateRef.current = state;

  useLayoutEffect(() => {
    dispatchUi = dispatch;
    readUi = () => stateRef.current;
    return () => {
      dispatchUi = () => {};
      readUi = () => undefined;
    };
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", handlePageHide);
    void bootstrap().catch((error) => console.error("Failed to start viewer.", error));
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      void disposeViewer().catch((error) => console.warn("Failed to dispose viewer cleanly.", error));
    };
  }, []);

  const { openLocalDocument, pickLocalDocument } = platform;
  const actions = useMemo(() => ({
    closeAnnotation,
    closeBookInfo: () => updateUi({ bookInfoOpen: false }),
    closeContextMenu: () => {
      stateRef.current.contextMenu?.onClose();
      updateUi({ contextMenu: null });
    },
    closeSearch: () => { clearSearchState(); },
    closeTheme: () => updateUi({ theme: null }),
    closeToc: () => updateUi({ tocOpen: false }),
    closeTranslation: annotationState.closeTranslation,
    collectSearch: (query, highlightedOnly) => {
      void runtime.search?.collect(query, highlightedOnly);
    },
    deleteAnnotation: (value) => {
      annotationState.deleteAnnotation(value);
      updateUi({ annotation: null });
    },
    downloadTranslation: annotationState.downloadTranslation,
    navigateToc,
    nextSearchResult: () => { void runtime.search?.next(); },
    openLocalFile: (file) => {
      updateUi({ welcome: false });
      void openBook(openLocalDocument(file));
    },
    pickLocalFile: pickLocalDocument ? async () => {
      const selectedDocument = await pickLocalDocument();
      if (!selectedDocument) return;
      updateUi({ welcome: false });
      void openBook(selectedDocument);
    } : undefined,
    previousSearchResult: () => { void runtime.search?.previous(); },
    runDockAction: (action) => {
      void handleDockAction(action).catch((error) => {
        console.warn("Failed to apply reader action.", error);
      });
    },
    seek: goToProgress,
    selectTheme,
    setDockOpen: (open) => updateUi({ dockOpen: open }),
    updateAnnotation: (note) => updateUi((state) => ({
      annotation: state.annotation ? { ...state.annotation, note } : null,
    })),
  } satisfies ReaderUiActions), [openLocalDocument, pickLocalDocument]);

  return createElement(App, {
    actions,
    readerRootRef: initializeReaderRoot,
    state,
  });
}

createRoot(appRoot).render(createElement(ReaderApplication));
