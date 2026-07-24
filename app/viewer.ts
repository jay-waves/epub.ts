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
  changeReaderFontSize,
  changeReaderFlow,
  changeReaderLayoutLevel,
  getBookStyles,
  getNextReaderThemeId,
  READER_FONT_FAMILY,
  READER_FONT_SIZE_STEP,
  READER_FONT_URL,
  READER_LATIN_FONT_FAMILY,
  READER_LATIN_FONT_FORMAT,
  READER_LATIN_FONT_URL,
  READER_MONO_FONT_FAMILY,
  READER_MONO_FONT_FORMAT,
  READER_MONO_FONT_WEIGHT,
  READER_MONO_FONT_URL,
  READER_LAYOUT_LEVEL_STEP,
} from "./reader-settings";
import {
  createAnnotatedEpub,
  EPUB_MIME_TYPE,
  getEpubBlob,
  readEmbeddedHighlights,
} from "./epub-annotations";
import {
  createFoliateView,
  deriveBookKey,
} from "./foliate";
import { createHighlightController } from "./highlight-controller";
import {
  closeReaderContentOverlays,
  disposeReaderContent,
  prepareReaderContentDocument,
} from "./foliate/content";
import { createSearchController } from "./search-controller";
import { createBookInfo, formatSourcePath } from "./book-info";
import { App } from "./App";
import { createReadingProgressController } from "./components/reading-progress";
import type { ReadingProgressElements } from "./components/reading-progress";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import {
  getSavedPosition,
  getSavedHighlights,
  saveReaderSettings,
  saveReadingPosition,
  setSavedHighlights,
} from "./viewer-storage";
import type { ReaderSettings, ReadingPosition } from "./reader";
import type { FoliateViewElement, RelocateDetail } from "./foliate";
import type { DockAction, DockUpdateDetail, PageTurnDirection } from "./viewer-events";
import { createDebouncedTask, DEFAULT_READER_SETTINGS, readerSettings, runWhenIdle } from "./reader";
import { createBookSession, resetBookSession } from "./viewer-session";
import {
  clearFileHandle,
  ensureSourceAccess,
  getInitialSourceUrl,
  getStoredFileHandle,
  isDocflowViewer,
  isWebViewer,
  normalizeSourceUrl,
  saveDocflowBlob,
  saveFileHandle,
  verifyWritePermission,
  writeBlobToFile,
} from "./platform";
import "./viewer.css";

const runtime: {
  bookOpenToken: number;
  criticalInteractions: AbortController | null;
  disposed: boolean;
  extraInteractionsDispose: (() => void) | null;
  extraUiReady: boolean;
  highlightController: ReturnType<typeof createHighlightController> | null;
  idleTasks: Set<() => void>;
  isSearchOpen: boolean;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  lastScrollEdgeFeedbackAt: number;
  postLoadTaskToken: number;
  readerFontsReady: Promise<void> | null;
  readerEvents: AbortController | null;
  readerView: FoliateViewElement | null;
  readerViewReady: Promise<FoliateViewElement> | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  renderPendingToken: number;
  searchController: ReturnType<typeof createSearchController> | null;
  scrollEdgeFeedbackTimer?: number;
} = {
  bookOpenToken: 0,
  criticalInteractions: null,
  disposed: false,
  extraInteractionsDispose: null,
  extraUiReady: false,
  highlightController: null,
  idleTasks: new Set(),
  isSearchOpen: false,
  keybindings: null,
  lastScrollEdgeFeedbackAt: 0,
  postLoadTaskToken: 0,
  readerFontsReady: null,
  readerEvents: null,
  readerView: null,
  readerViewReady: null,
  readingProgressController: null,
  renderPendingToken: 0,
  searchController: null,
};

const appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing required element: #app");
const PAGE_TURN_CLICK_MAX_DISTANCE = 4;

function mountReadingProgressController(elements: ReadingProgressElements | null) {
  runtime.readingProgressController?.destroy?.();
  if (!elements) {
    runtime.readingProgressController = null;
    return;
  }

  runtime.readingProgressController = createReadingProgressController({
    ...elements,
    canSeek: () => Boolean(runtime.readerView?.book),
    onSeek: goToProgress,
    onReturn: goToProgress,
  });
  runtime.readingProgressController.bind();
}

function goToProgress(progress: number) {
  if (isReaderRenderPending()) return;
  void runWithReaderRenderPending(() => runtime.readerView?.goTo({ fraction: progress })).catch((error) => {
    console.warn("Failed to navigate to reading progress.", error);
  });
}

const reactRoot = createRoot(appRoot);
flushSync(() => {
  reactRoot.render(createElement(App, {
    allowLocalFileOpen: isWebViewer,
    onOpenLocalFile: (file) => { void openBook(file, file.name); },
    onReadingProgressReady: mountReadingProgressController,
  }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
const session = createBookSession(document.title);

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
  document.title = `${session.dirty ? "*" : ""}${session.documentTitle}`;
}

const READER_DOCUMENT_FONT_TIMEOUT_MS = 2500;
const SCROLL_EDGE_FEEDBACK_COOLDOWN_MS = 900;

function scheduleIdle(callback: () => void, timeout?: number) {
  let cancel = () => {};
  cancel = runWhenIdle(() => {
    runtime.idleTasks.delete(cancel);
    if (!runtime.disposed) callback();
  }, timeout);
  runtime.idleTasks.add(cancel);
}

runtime.highlightController = createHighlightController({
  allowTranslationModelDownload: !isWebViewer,
  getBookKey: () => session.bookKey,
  getProgress: () => runtime.readingProgressController?.getProgress() ?? 0,
  getReaderView: () => runtime.readerView,
  runWhenIdle: scheduleIdle,
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
    runWithReaderRenderPending,
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
  emitViewerEvent(
    VIEWER_EVENTS.bookInfoUpdate,
    createBookInfo(runtime.readerView?.book, session.sourceLabel, session.sourceUrl),
  );
}

function preloadReaderFonts() {
  if (runtime.readerFontsReady) return runtime.readerFontsReady;

  const fontLoads = [
    ...(READER_FONT_URL ? [new FontFace(READER_FONT_FAMILY, `url("${READER_FONT_URL}") format("truetype")`, {
      style: "normal",
      weight: "400",
    }).load()] : []),
    new FontFace(READER_LATIN_FONT_FAMILY, `url("${READER_LATIN_FONT_URL}") format("${READER_LATIN_FONT_FORMAT}")`, {
      style: "normal",
      weight: "400 800",
    }).load(),
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
  setReaderRenderPending(true);
}

function handleAfterSectionTurn() {
  void revealReaderAfterPaint(...getCurrentReaderDocuments());
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

const highlightContextBindTask = createDebouncedTask((view: FoliateViewElement) => {
  runWhenIdle(() => {
    if (runtime.readerView === view) runtime.highlightController?.bindContextTargets();
  }, 250);
}, 120);

function wireReaderEvents(view: FoliateViewElement) {
  runtime.readerEvents?.abort();
  const events = new AbortController();
  runtime.readerEvents = events;
  const listenerOptions = { signal: events.signal };

  view.addEventListener("load", (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail;
    if (!doc) return;
    if (runtime.readerView === view) {
      setReaderRenderPending(true);
      void revealReaderAfterPaint(doc);
    }

    void prepareReaderContentDocument(doc, {
      isCurrent: () => runtime.readerView === view,
    });
  }, listenerOptions);
  view.addEventListener("edge-click", (event) => {
    const { x } = (event as CustomEvent<{ x: number }>).detail;
    emitPageTurnFromEdgeClick(x);
  }, listenerOptions);

  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;
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
    highlightContextBindTask.schedule(view);
    const previousSectionIndex = session.scrolledSectionIndex;
    session.scrolledSectionIndex = typeof sectionIndex === "number" ? sectionIndex : null;
    if (sectionIndex !== previousSectionIndex) restoreScrolledSectionProgress(sectionIndex);
  }, listenerOptions);

  view.addEventListener("create-overlay", (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    runtime.highlightController?.addCurrentHighlightsToOverlay(view, index);
  }, listenerOptions);

  view.addEventListener("draw-annotation", (event) => {
    runtime.highlightController?.drawAnnotation((event as CustomEvent<Parameters<NonNullable<typeof runtime.highlightController>["drawAnnotation"]>[0]>).detail);
  }, listenerOptions);

  view.addEventListener("show-annotation", (event) => {
    runtime.highlightController?.openFromAnnotation((event as CustomEvent<Parameters<NonNullable<typeof runtime.highlightController>["openFromAnnotation"]>[0]>).detail);
  }, listenerOptions);
}

function getDockUpdateDetail(): DockUpdateDetail {
  const isPaginated = readerSettings.flow === "paginated";

  return {
    canSearch: Boolean(runtime.readerView?.search),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling" : "Switch to paginated",
    hasUnsavedChanges: session.dirty,
    searchActive: runtime.isSearchOpen,
  };
}

function emitDockUpdate() {
  emitViewerEvent(VIEWER_EVENTS.dockUpdate, getDockUpdateDetail());
}

function deriveDownloadFilename(sourceUrl: string) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "book.epub");
  } catch {
    return "book.epub";
  }
}

async function getWritableSaveHandle(bookKey: string, sourceUrl: string) {
  if (session.saveHandle && await verifyWritePermission(session.saveHandle)) return session.saveHandle;

  const storedHandle = session.saveHandle === undefined ? await getStoredFileHandle(bookKey) : null;
  if (storedHandle && await verifyWritePermission(storedHandle)) {
    session.saveHandle = storedHandle;
    return storedHandle;
  }

  if (!("showSaveFilePicker" in window)) {
    throw new Error("File System Access API is not available in this browser.");
  }

  const fileHandle = await window.showSaveFilePicker({
    id: "epub-overlay-save-file",
    suggestedName: session.documentTitle || deriveDownloadFilename(sourceUrl),
    startIn: "documents",
    types: [{
      description: "EPUB files",
      accept: { [EPUB_MIME_TYPE]: [".epub"] },
    }],
  });
  if (!await verifyWritePermission(fileHandle)) throw new Error("Write permission was not granted.");

  session.saveHandle = fileHandle;
  await saveFileHandle(bookKey, fileHandle);
  return fileHandle;
}

async function saveAnnotatedBook() {
  const { bookKey, sourceUrl } = session;
  if (!bookKey || !sourceUrl) return;

  try {
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    await runtime.highlightController?.flushPendingAnnotationSave();

    // Build the complete output before opening the save picker. The selected
    // destination may be the source EPUB itself, so the source must no longer
    // be needed by the time the browser starts an overwrite operation.
    const sourceBlob = await getEpubBlob(sourceUrl);
    const highlights = await getSavedHighlights(bookKey);
    const blob = await createAnnotatedEpub(sourceBlob, highlights);
    if (blob.size === 0) throw new Error("Generated EPUB is empty.");

    if (isDocflowViewer) {
      if (await saveDocflowBlob(blob)) setHasUnsavedChanges(false);
      return;
    }

    const fileHandle = await getWritableSaveHandle(bookKey, sourceUrl);
    try {
      await writeBlobToFile(fileHandle, blob);
    } catch (error) {
      await clearFileHandle(bookKey);
      if (session.saveHandle === fileHandle) session.saveHandle = null;
      throw error;
    }
    setHasUnsavedChanges(false);
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
  highlightContextBindTask.cancel();
  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await runtime.highlightController?.flushPendingAnnotationSave();
  if (runtime.disposed || openToken !== runtime.bookOpenToken) return false;

  if (runtime.readerView) runtime.keybindings?.unbindReaderView(runtime.readerView);
  runtime.highlightController?.reset();
  await closeReaderContentOverlays();
  if (runtime.disposed || openToken !== runtime.bookOpenToken) return false;
  runtime.readerView?.close();
  if (session.localSourceUrl && session.localSourceUrl !== source.localSourceUrl) {
    URL.revokeObjectURL(session.localSourceUrl);
  }
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

  applyReaderTheme(nextSettings.theme);
  applyReaderFlow(nextSettings.flow, null, readerRoot);
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(nextSettings.layoutLevel, runtime.readerView, readerRoot);
  emitDockUpdate();
}

async function createView() {
  const view = await createFoliateView();
  if (runtime.disposed) {
    view.close();
    return view;
  }
  view.enhanceDocument = (doc) => enhanceCachedReaderDocument(doc, view);
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
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

async function enhanceCachedReaderDocument(doc: Document, view: FoliateViewElement) {
  applyReaderDocumentTheme(doc);
  await prepareReaderContentDocument(doc, {
    interactive: false,
    isCurrent: () => runtime.readerView === view,
  });
}

function applyReaderDocumentTheme(doc: Document) {
  const head = doc.head ?? doc.documentElement.insertBefore(doc.createElement("head"), doc.documentElement.firstChild);
  const [staticStyles, dynamicStyles] = getBookStyles();
  upsertReaderDocumentStyle(doc, head, "static", staticStyles);
  upsertReaderDocumentStyle(doc, head, "dynamic", dynamicStyles);
}

function upsertReaderDocumentStyle(doc: Document, head: HTMLHeadElement, name: string, cssText: string) {
  const style = head.querySelector<HTMLStyleElement>(`style[data-reader-cached-styles="${name}"]`)
    ?? doc.createElement("style");
  style.dataset.readerCachedStyles = name;
  if (style.textContent !== cssText) style.textContent = cssText;
  if (!style.isConnected) head.append(style);
}

function setReaderRenderPending(isPending: boolean) {
  if (isPending) runtime.renderPendingToken += 1;
  readerRoot.classList.toggle("reader-frame--pending", isPending);
}

function isReaderRenderPending() {
  return readerRoot.classList.contains("reader-frame--pending");
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

async function revealReaderAfterPaint(...documents: Array<Document | undefined>) {
  const token = runtime.renderPendingToken;
  await waitForReaderDocumentsReady(documents);
  await waitForNextPaint();
  if (token === runtime.renderPendingToken) setReaderRenderPending(false);
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function runWithReaderRenderPending(action: () => Promise<unknown> | undefined) {
  setReaderRenderPending(true);
  try {
    await action();
    await revealReaderAfterPaint(...getCurrentReaderDocuments());
  } catch (error) {
    setReaderRenderPending(false);
    throw error;
  }
}

function getCurrentReaderDocuments() {
  return runtime.readerView?.renderer?.getContents?.()
    .map((content) => content.doc)
    .filter((doc): doc is Document => Boolean(doc)) ?? [];
}

async function waitForReaderDocumentsReady(documents: Array<Document | undefined>) {
  const uniqueDocuments = Array.from(new Set(documents.filter((doc): doc is Document => Boolean(doc))));
  if (!uniqueDocuments.length) return;

  await Promise.all(uniqueDocuments.map(waitForReaderDocumentFonts));
}

async function waitForReaderDocumentFonts(doc: Document) {
  if (doc.documentElement.dataset.foliateCachedDocument === "true") return;

  const fonts = doc.fonts;
  if (!fonts) return;

  try {
    await withTimeout(Promise.allSettled([
      fonts.load(`${readerSettings.fontSize}px "${READER_FONT_FAMILY}"`),
      fonts.load(`${readerSettings.fontSize}px "${READER_LATIN_FONT_FAMILY}"`),
      fonts.load(`${readerSettings.fontSize}px "${READER_MONO_FONT_FAMILY}"`),
      fonts.ready,
    ]), READER_DOCUMENT_FONT_TIMEOUT_MS);
  } catch (error) {
    console.warn("Timed out waiting for reader document fonts.", error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
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

async function openBook(input: File | string, sourceLabel: string) {
  const openToken = ++runtime.bookOpenToken;
  const normalizedInput = typeof input === "string" ? normalizeSourceUrl(input) : input;
  const localSourceUrl = normalizedInput instanceof File ? URL.createObjectURL(normalizedInput) : null;
  const fileUrl = typeof normalizedInput === "string" ? normalizedInput : localSourceUrl!;
  const fallbackBookKey = normalizedInput instanceof File
    ? `local:${normalizedInput.name}:${normalizedInput.size}:${normalizedInput.lastModified}`
    : fileUrl;
  const canRead = await ensureSourceAccess(fileUrl);
  if (!canRead || runtime.disposed || openToken !== runtime.bookOpenToken) {
    if (localSourceUrl) URL.revokeObjectURL(localSourceUrl);
    return;
  }

  try {
    const didReset = await resetBookState({
      bookKey: fallbackBookKey,
      documentTitle: input instanceof File ? input.name : deriveDownloadFilename(fileUrl),
      localSourceUrl,
      sourceLabel,
      sourceUrl: fileUrl,
    }, openToken);
    if (!didReset) {
      if (localSourceUrl && session.localSourceUrl !== localSourceUrl) URL.revokeObjectURL(localSourceUrl);
      return;
    }

    const view = await getReaderView();
    if (!view || runtime.disposed || openToken !== runtime.bookOpenToken) return;
    runtime.keybindings?.bindReaderView(view);
    setReaderRenderPending(true);
    await preloadReaderFonts();
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    await view.open(normalizedInput);
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    session.bookKey = await deriveBookKey(view.book, fallbackBookKey);
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    const bookKey = session.bookKey;
    void getStoredFileHandle(bookKey)
      .then((handle) => {
        if (session.bookKey === bookKey) session.saveHandle = handle ?? null;
      })
      .catch((error) => {
        console.warn("Failed to restore saved EPUB file handle.", error);
      });
    const savedPosition = await getSavedPosition(bookKey);
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    applyReaderSettings(savedPosition?.settings);

    emitBookInfoUpdate();
    await restoreSavedPosition(view, savedPosition);
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    await revealReaderAfterPaint(...getCurrentReaderDocuments());
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    schedulePostLoadTasks(view, bookKey);
  } catch (error) {
    if (runtime.disposed || openToken !== runtime.bookOpenToken) return;
    setReaderRenderPending(false);
    console.error(`Failed to open ${sourceLabel}`, error);
    if (localSourceUrl && session.localSourceUrl === localSourceUrl) {
      URL.revokeObjectURL(localSourceUrl);
      session.localSourceUrl = null;
    }
  }
}

function setupCriticalInteractions() {
  runtime.criticalInteractions?.abort();
  const interactions = new AbortController();
  runtime.criticalInteractions = interactions;
  const { signal } = interactions;
  let clickStart: { x: number; y: number } | null = null;

  window.addEventListener("resize", () => {
    if (runtime.readerView) applyReaderLayout(runtime.readerView, readerRoot);
    runtime.highlightController?.close();
  }, { signal });

  readerRoot.addEventListener("pointerdown", (event) => {
    clickStart = null;
    if (readerSettings.flow !== "scrolled") return;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Node) || !readerRoot.contains(event.target)) return;

    clickStart = { x: event.clientX, y: event.clientY };
  }, { capture: true, signal });

  readerRoot.addEventListener("click", (event) => {
    const start = clickStart;
    clickStart = null;
    if (readerSettings.flow !== "scrolled") return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Node) || !readerRoot.contains(event.target)) return;
    if (!start || !isClickDistance(start.x, start.y, event.clientX, event.clientY)) return;

    emitPageTurnFromEdgeClick(event.clientX);
  }, { signal });

  window.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Node && readerRoot.contains(event.target)) {
      event.preventDefault();
    }
  }, { signal });
}

function setupExtraInteractions() {
  const disposers = [
    listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
      if (!href || isReaderRenderPending()) return;
      void runWithReaderRenderPending(() => runtime.readerView?.goTo(href));
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
      runtime.highlightController?.handleContextAction(action);
    }),
    listenViewerEvent(VIEWER_EVENTS.unsavedChange, () => setHasUnsavedChanges(true)),
    listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
      void handleDockAction(action);
    }),
  ];

  return () => disposers.forEach((dispose) => dispose());
}

function emitPageTurnFromEdgeClick(clientX: number) {
  const direction = resolveEdgeClickDirection(clientX);
  if (direction) emitViewerEvent(VIEWER_EVENTS.pageTurn, direction);
}

function resolveEdgeClickDirection(clientX: number): PageTurnDirection | null {
  const edgeWidth = window.innerWidth * 0.22;
  if (clientX <= edgeWidth) return "left";
  if (clientX >= window.innerWidth - edgeWidth) return "right";
  return null;
}

function isClickDistance(startX: number, startY: number, endX: number, endY: number) {
  return Math.abs(endX - startX) <= PAGE_TURN_CLICK_MAX_DISTANCE
    && Math.abs(endY - startY) <= PAGE_TURN_CLICK_MAX_DISTANCE;
}

async function runReaderStyleChange(action: () => void) {
  if (isReaderRenderPending()) return;

  await runWithReaderRenderPending(async () => {
    await preloadReaderFonts();
    action();
  });
}

async function handleDockAction(action: DockAction) {
  if (action === "open-info") {
    emitBookInfoUpdate();
    emitViewerEvent(VIEWER_EVENTS.bookInfoOpen);
    return;
  }

  if (action === "open-toc") {
    emitTocUpdate();
    emitViewerEvent(VIEWER_EVENTS.tocOpen);
    return;
  }

  if (action === "toggle-search") {
    toggleSearch();
    return;
  }

  if (action === "save-book") {
    await saveAnnotatedBook();
    return;
  }

  if (action === "toggle-flow") {
    await runReaderStyleChange(() => {
      changeReaderFlow(runtime.readerView, readerRoot);
    });
    saveCurrentReaderSettings();
    emitDockUpdate();
    return;
  }

  if (action === "toggle-theme") {
    await runReaderStyleChange(() => {
      applyReaderTheme(getNextReaderThemeId());
      runtime.readerView?.renderer?.setStyles?.(getBookStyles());
    });
    saveCurrentReaderSettings();
    emitDockUpdate();
    return;
  }

  if (action === "decrease-font" || action === "increase-font") {
    const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
    if (!canChangeReaderFontSize(delta)) return;
    await runReaderStyleChange(() => {
      changeReaderFontSize(delta, runtime.readerView);
    });
    saveCurrentReaderSettings();
    return;
  }

  if (action === "decrease-width" || action === "increase-width") {
    const delta = action === "decrease-width" ? -READER_LAYOUT_LEVEL_STEP : READER_LAYOUT_LEVEL_STEP;
    if (!canChangeReaderLayoutLevel(delta)) return;
    await runReaderStyleChange(() => {
      changeReaderLayoutLevel(delta, runtime.readerView, readerRoot);
    });
    saveCurrentReaderSettings();
    return;
  }
}

function setupExtraUi() {
  if (runtime.extraUiReady) return;
  runtime.extraUiReady = true;

  ensureKeybindings();
  emitDockUpdate();
  runtime.highlightController?.bindContextTargets();
  runtime.extraInteractionsDispose = setupExtraInteractions();
}

function schedulePostLoadTasks(view: FoliateViewElement, bookKey: string) {
  const taskToken = ++runtime.postLoadTaskToken;

  requestAnimationFrame(() => {
    if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;

    scheduleIdle(setupExtraUi, 1000);

    scheduleIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      runtime.highlightController?.bindContextTargets();
      void importEmbeddedHighlights(bookKey, session.sourceUrl, taskToken)
        .finally(() => {
          if (runtime.readerView === view && runtime.postLoadTaskToken === taskToken) {
            runtime.highlightController?.scheduleRestore(view, bookKey);
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

async function importEmbeddedHighlights(bookKey: string, sourceUrl: string, taskToken: number) {
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
  const src = getInitialSourceUrl();
  if (src) {
    void openBook(src, formatSourcePath(src) || src);
  } else {
    void preloadReaderFonts();
    scheduleIdle(setupExtraUi, 1000);
  }
}

async function disposeViewer() {
  if (runtime.disposed) return;
  runtime.disposed = true;
  ++runtime.bookOpenToken;
  ++runtime.postLoadTaskToken;
  savePositionTask.cancel();
  highlightContextBindTask.cancel();
  runtime.idleTasks.forEach((cancel) => cancel());
  runtime.idleTasks.clear();
  window.clearTimeout(runtime.scrollEdgeFeedbackTimer);
  runtime.scrollEdgeFeedbackTimer = undefined;

  emitViewerEvent(VIEWER_EVENTS.annotationClose);
  await runtime.highlightController?.flushPendingAnnotationSave();

  runtime.criticalInteractions?.abort();
  runtime.readerEvents?.abort();
  runtime.extraInteractionsDispose?.();
  runtime.keybindings?.destroy();
  runtime.highlightController?.destroy();
  runtime.searchController?.clear();
  runtime.readingProgressController?.destroy();
  await disposeReaderContent();
  runtime.readerView?.close();
  if (session.localSourceUrl) URL.revokeObjectURL(session.localSourceUrl);

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
