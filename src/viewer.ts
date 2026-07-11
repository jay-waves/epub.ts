import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFlow,
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayout,
  canChangeReaderFontSize,
  canChangeReaderLayoutLevel,
  changeReaderFontSize,
  changeReaderFlow,
  changeReaderLayoutLevel,
  getBookStyles,
  READER_FONT_FAMILY,
  READER_FONT_SIZE_STEP,
  READER_FONT_URL,
  READER_LATIN_FONT_FAMILY,
  READER_LATIN_FONT_URL,
  READER_MONO_FONT_FAMILY,
  READER_MONO_FONT_URL,
  READER_LAYOUT_LEVEL_STEP,
  resolveReaderLayoutLevel,
} from "./reader-settings";
import {
  applyReaderTheme,
  getNextReaderTheme,
} from "./reader-themes";
import { deriveBookKey } from "./book-key";
import {
  clearFileHandle,
  createAnnotatedEpub,
  EPUB_MIME_TYPE,
  getEpubBlob,
  getStoredFileHandle,
  readEmbeddedHighlights,
  saveFileHandle,
  verifyWritePermission,
  writeBlobToFile,
} from "./epub-overlays";
import { createHighlightController } from "./highlight-controller";
import { enhanceReaderContent, prepareReaderContentDocument } from "./reader-content-enhancers";
import { createSearchController } from "./search-controller";
import { createDebouncedTask, runWhenIdle } from "./scheduler";
import { App } from "./App";
import { createReadingProgressController } from "./components/reading-progress";
import type { ReadingProgressElements } from "./components/reading-progress";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { state } from "./viewer-state";
import {
  getSavedPosition,
  getSavedReaderSettings,
  getSavedHighlights,
  mergeSavedHighlights,
  reconcileBookStorage,
  saveReaderSettings,
  saveReadingPosition,
} from "./viewer-storage";
import type { ReaderSettings, ReadingPosition } from "./viewer-types";
import type { BookSection, FoliateViewElement, RelocateDetail, TocItem } from "../foliate-js/view.js";
import type { BookInfoUpdateDetail, DockAction, DockUpdateDetail, PageTurnDirection } from "./viewer-events";
import "./viewer.css";

const runtime: {
  extraUiReady: boolean;
  foliateViewReady: Promise<unknown> | null;
  highlightController: ReturnType<typeof createHighlightController> | null;
  isSearchOpen: boolean;
  keybindings: ReturnType<typeof setupViewerKeybindings> | null;
  postLoadTaskToken: number;
  readerFontsReady: Promise<void> | null;
  readerView: FoliateViewElement | null;
  readingProgressController: ReturnType<typeof createReadingProgressController> | null;
  searchController: ReturnType<typeof createSearchController> | null;
  tocItems: TocItem[];
} = {
  extraUiReady: false,
  foliateViewReady: null,
  highlightController: null,
  isSearchOpen: false,
  keybindings: null,
  postLoadTaskToken: 0,
  readerFontsReady: null,
  readerView: null,
  readingProgressController: null,
  searchController: null,
  tocItems: [],
};

const appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing required element: #app");
const PAGE_TURN_CLICK_MAX_DISTANCE = 4;
const ESTIMATED_READING_WORDS_PER_MINUTE = 250;
const ESTIMATED_CHARS_PER_WORD = 6;

function mountReadingProgressController(elements: ReadingProgressElements | null) {
  runtime.readingProgressController?.destroy?.();
  runtime.readingProgressController = null;
  if (!elements) return;

  runtime.readingProgressController = createReadingProgressController({
    ...elements,
    canSeek: () => Boolean(runtime.readerView?.book),
    onSeek: (progress) => {
      if (isReaderRenderPending()) return;
      void runWithReaderRenderPending(() => runtime.readerView?.goTo({ fraction: progress })).catch((error) => {
        console.warn("Failed to seek reading progress.", error);
      });
    },
    onReturn: (progress) => {
      if (isReaderRenderPending()) return;
      void runWithReaderRenderPending(() => runtime.readerView?.goTo({ fraction: progress })).catch((error) => {
        console.warn("Failed to return to reading position.", error);
      });
    },
  });
}

flushSync(() => {
  createRoot(appRoot).render(App({ onReadingProgressReady: mountReadingProgressController }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
let renderPendingToken = 0;
let scrollEdgeFeedbackTimer: number | undefined;
let lastScrollEdgeFeedbackAt = 0;
let currentScrollSectionIndex: number | null = null;
let shouldRestoreScrolledSectionProgress = false;
let currentSaveHandle: FileSystemFileHandle | null | undefined;
let cleanDocumentTitle = document.title;
let hasUnsavedChanges = false;
const scrolledSectionProgress = new Map<number, number>();

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

function setHasUnsavedChanges(dirty: boolean) {
  hasUnsavedChanges = dirty;
  renderDocumentTitle();
  emitDockUpdate();
}

function renderDocumentTitle() {
  document.title = `${hasUnsavedChanges ? "*" : ""}${cleanDocumentTitle}`;
}

const defaultReaderSettings: ReaderSettings = {
  flow: "paginated",
  fontSize: 18,
  layoutLevel: 2,
  theme: "light",
};
const READER_DOCUMENT_FONT_TIMEOUT_MS = 2500;
const SCROLL_EDGE_FEEDBACK_COOLDOWN_MS = 900;

runtime.highlightController = createHighlightController({
  getBookKey: () => state.currentBookKey,
  getProgress: () => runtime.readingProgressController?.getProgress() ?? 0,
  getReaderView: () => runtime.readerView,
  runWhenIdle,
});

function ensureKeybindings() {
  runtime.keybindings ??= setupViewerKeybindings({
    getReaderView: () => runtime.readerView,
    getFlow: () => state.flow,
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
    getBookKey: () => state.currentBookKey,
    getReaderView: () => runtime.readerView,
    runWithReaderRenderPending,
  });
  return runtime.searchController;
}

function emitTocUpdate() {
  emitViewerEvent(VIEWER_EVENTS.tocUpdate, {
    currentHref: state.currentHref,
    items: runtime.tocItems,
  });
}

function emitBookInfoUpdate() {
  emitViewerEvent(VIEWER_EVENTS.bookInfoUpdate, getBookInfoUpdateDetail());
}

function getBookInfoUpdateDetail(): BookInfoUpdateDetail {
  const book = runtime.readerView?.book;
  if (!book) {
    return {
      metadataRows: [],
      statsRows: [],
      title: "Book information",
    };
  }

  const metadata = book?.metadata;
  const title = formatMetadataValue(metadata?.title) || "Untitled Book";
  const author = formatMetadataValue(metadata?.author);
  const sectionCount = book?.sections?.length ?? 0;
  const estimatedWords = estimateBookWords(book?.sections);
  const estimatedMinutes = estimatedWords ? Math.max(1, Math.ceil(estimatedWords / ESTIMATED_READING_WORDS_PER_MINUTE)) : null;
  const sourcePath = formatSourcePath(state.currentSourceUrl);

  return {
    title,
    subtitle: author || sourcePath || undefined,
    statsRows: [
      estimatedMinutes ? { label: "Estimated reading time", value: formatReadingDuration(estimatedMinutes) } : null,
      estimatedWords ? { label: "Estimated words", value: formatNumber(estimatedWords) } : null,
      sectionCount ? { label: "Sections", value: formatNumber(sectionCount) } : null,
    ].filter((row): row is { label: string; value: string } => Boolean(row)),
    metadataRows: [
      { label: "Title", value: title },
      { label: "Author", value: author },
      { label: "Publisher", value: formatMetadataValue(metadata?.publisher) },
      { label: "Language", value: formatMetadataValue(metadata?.language) },
      { label: "Published", value: formatMetadataValue(metadata?.published) },
      { label: "Modified", value: formatMetadataValue(metadata?.modified) },
      { label: "Identifier", value: formatMetadataValue(metadata?.identifier) },
      { label: "Subject", value: formatMetadataValue(metadata?.subject) },
      { label: "Source", value: sourcePath },
    ].filter((row) => row.value),
  };
}

function formatSourcePath(sourceUrl: string) {
  if (!sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "file:") return sourceUrl;

    const pathname = decodeURIComponent(url.pathname);
    return pathname.replace(/^\/([A-Za-z]:\/)/, "$1");
  } catch {
    return sourceUrl;
  }
}

function estimateBookWords(sections?: BookSection[]) {
  const totalSize = (sections ?? []).reduce((sum, section) => {
    return sum + (typeof section.size === "number" && Number.isFinite(section.size) ? section.size : 0);
  }, 0);
  if (totalSize <= 0) return null;
  return Math.max(1, Math.round(totalSize / ESTIMATED_CHARS_PER_WORD));
}

function formatReadingDuration(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatMetadataValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatMetadataValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("name" in record) return formatMetadataValue(record.name);
    const localized = Object.values(record).find((item): item is string => typeof item === "string" && Boolean(item.trim()));
    if (localized) return localized;
    return Object.values(record).map(formatMetadataValue).filter(Boolean).join(", ");
  }
  return "";
}

function preloadReaderFonts() {
  if (runtime.readerFontsReady) return runtime.readerFontsReady;

  runtime.readerFontsReady = Promise.all([
    new FontFace(READER_FONT_FAMILY, `url("${READER_FONT_URL}") format("truetype")`, {
      style: "normal",
      weight: "400",
    }).load(),
    new FontFace(READER_LATIN_FONT_FAMILY, `url("${READER_LATIN_FONT_URL}") format("truetype")`, {
      style: "normal",
      weight: "400 800",
    }).load(),
    new FontFace(READER_MONO_FONT_FAMILY, `url("${READER_MONO_FONT_URL}") format("truetype")`, {
      style: "normal",
      weight: "100 900",
    }).load(),
  ])
    .then((fonts) => {
      fonts.forEach((font) => document.fonts.add(font));
    })
    .catch((error) => {
      console.warn("Failed to preload reader fonts.", error);
    });

  return runtime.readerFontsReady;
}

function ensureFoliateView() {
  runtime.foliateViewReady ??= import("../foliate-js/view.js");
  return runtime.foliateViewReady;
}

function getCurrentScrolledSectionAnchor() {
  if (state.flow !== "scrolled") return null;

  const renderer = runtime.readerView?.renderer;
  const { start, viewSize } = renderer ?? {};
  if (typeof start !== "number" || typeof viewSize !== "number" || viewSize <= 0) return null;

  return Math.min(1, Math.max(0, start / viewSize));
}

function saveCurrentScrolledSectionProgress() {
  if (currentScrollSectionIndex == null) return;

  const anchor = getCurrentScrolledSectionAnchor();
  if (anchor == null) return;

  scrolledSectionProgress.set(currentScrollSectionIndex, anchor);
}

function handleBeforeSectionTurn() {
  saveCurrentScrolledSectionProgress();
  shouldRestoreScrolledSectionProgress = state.flow === "scrolled";
  setReaderRenderPending(true);
}

function handleAfterSectionTurn() {
  void revealReaderAfterPaint(...getCurrentReaderDocuments());
}

function restoreScrolledSectionProgress(sectionIndex: number | undefined) {
  if (!shouldRestoreScrolledSectionProgress || state.flow !== "scrolled" || typeof sectionIndex !== "number") {
    shouldRestoreScrolledSectionProgress = false;
    return;
  }

  const anchor = scrolledSectionProgress.get(sectionIndex);
  shouldRestoreScrolledSectionProgress = false;
  if (typeof anchor !== "number") return;

  requestAnimationFrame(() => {
    if (state.flow !== "scrolled" || currentScrollSectionIndex !== sectionIndex) return;

    void runtime.readerView?.renderer?.scrollToAnchor?.(anchor).catch((error) => {
      console.warn("Failed to restore section reading progress.", error);
    });
  });
}

const savePositionTask = createDebouncedTask((detail: RelocateDetail) => {
  if (state.currentBookKey) {
    void saveReadingPosition(state.currentBookKey, detail);
  }
}, 350);

function queuePositionSave(detail: RelocateDetail) {
  if (!state.currentBookKey || state.isRestoring) return;
  savePositionTask.schedule(detail);
}

const highlightContextBindTask = createDebouncedTask((view: FoliateViewElement) => {
  runWhenIdle(() => {
    if (runtime.readerView === view) runtime.highlightController?.bindContextTargets();
  }, 250);
}, 120);

function wireReaderEvents(view: FoliateViewElement) {
  view.addEventListener("load", (event) => {
    const { doc, index } = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
    if (!doc) return;
    if (runtime.readerView === view) {
      setReaderRenderPending(true);
      void revealReaderAfterPaint(doc);
    }

    enhanceReaderContent(doc, {
      isCurrent: () => runtime.readerView === view,
    });
  });
  view.addEventListener("edge-click", (event) => {
    const { x } = (event as CustomEvent<{ x: number }>).detail;
    emitPageTurnFromEdgeClick(x);
  });

  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;
    const sectionIndex = detail.index;

    const currentHref = detail.tocItem?.href ?? "";
    if (currentHref !== state.currentHref) {
      state.currentHref = currentHref;
      emitTocUpdate();
    }
    runtime.readingProgressController?.handleRelocate({
      ...detail,
      index: sectionIndex,
    });
    queuePositionSave(detail);
    highlightContextBindTask.schedule(view);
    const previousSectionIndex = currentScrollSectionIndex;
    currentScrollSectionIndex = typeof sectionIndex === "number" ? sectionIndex : null;
    if (sectionIndex !== previousSectionIndex) restoreScrolledSectionProgress(sectionIndex);
  });

  view.addEventListener("create-overlay", (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    runtime.highlightController?.addCurrentHighlightsToOverlay(view, index);
  });

  view.addEventListener("draw-annotation", (event) => {
    runtime.highlightController?.drawAnnotation((event as CustomEvent<Parameters<NonNullable<typeof runtime.highlightController>["drawAnnotation"]>[0]>).detail);
  });

  view.addEventListener("show-annotation", (event) => {
    runtime.highlightController?.openFromAnnotation((event as CustomEvent<Parameters<NonNullable<typeof runtime.highlightController>["openFromAnnotation"]>[0]>).detail);
  });
}

async function ensureFileSchemeAccess(fileUrl?: string) {
  if (!fileUrl?.startsWith("file://")) return true;

  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    console.warn(
      "File URL access is disabled. Enable 'Allow access to file URLs' for this extension.",
    );
  }
  return allowed;
}

function getDockUpdateDetail(): DockUpdateDetail {
  const isPaginated = state.flow === "paginated";

  return {
    canSearch: Boolean(runtime.readerView?.search),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling" : "Switch to paginated",
    hasUnsavedChanges,
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

function getOpenedFilename(input: File | string, sourceUrl?: string) {
  return input instanceof File ? input.name : deriveDownloadFilename(sourceUrl ?? input);
}

async function getWritableSaveHandle(bookKey: string, sourceUrl: string) {
  if (currentSaveHandle && await verifyWritePermission(currentSaveHandle)) return currentSaveHandle;

  const storedHandle = currentSaveHandle === undefined ? await getStoredFileHandle(bookKey) : null;
  if (storedHandle && await verifyWritePermission(storedHandle)) {
    currentSaveHandle = storedHandle;
    return storedHandle;
  }

  if (!("showSaveFilePicker" in window)) {
    throw new Error("File System Access API is not available in this browser.");
  }

  const fileHandle = await window.showSaveFilePicker({
    id: "epub-overlay-save-file",
    suggestedName: deriveDownloadFilename(sourceUrl),
    startIn: "documents",
    types: [{
      description: "EPUB files",
      accept: { [EPUB_MIME_TYPE]: [".epub"] },
    }],
  });
  if (!await verifyWritePermission(fileHandle)) throw new Error("Write permission was not granted.");

  currentSaveHandle = fileHandle;
  await saveFileHandle(bookKey, fileHandle);
  return fileHandle;
}

async function saveAnnotatedBook() {
  const bookKey = state.currentBookKey;
  const sourceUrl = state.currentSourceUrl;
  if (!bookKey || !sourceUrl) return;

  try {
    const fileHandle = await getWritableSaveHandle(bookKey, sourceUrl);
    emitViewerEvent(VIEWER_EVENTS.annotationClose);
    await runtime.highlightController?.flushPendingAnnotationSave();
    const sourceBlob = await getEpubBlob(sourceUrl);
    const highlights = await getSavedHighlights(bookKey);
    const blob = await createAnnotatedEpub(sourceBlob, highlights);
    try {
      await writeBlobToFile(fileHandle, blob);
    } catch (error) {
      await clearFileHandle(bookKey);
      if (currentSaveHandle === fileHandle) currentSaveHandle = null;
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
  if (!state.currentBookKey) return;
  void saveReaderSettings(state.currentBookKey, {
    flow: state.flow,
    fontSize: state.readerFontSize,
    layoutLevel: state.readerLayoutLevel,
    theme: state.readerTheme,
  });
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

function resetTransientBookState() {
  ++runtime.postLoadTaskToken;
  savePositionTask.cancel();
  highlightContextBindTask.cancel();
  clearSearchState();
  state.currentHref = "";
  runtime.tocItems = [];
  currentScrollSectionIndex = null;
  shouldRestoreScrolledSectionProgress = false;
  scrolledSectionProgress.clear();
  emitTocUpdate();
  emitBookInfoUpdate();
  runtime.highlightController?.reset();
  runtime.readingProgressController?.setProgress(0);
  runtime.readingProgressController?.setHistoryProgress(null);
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...defaultReaderSettings, ...settings };
  const layoutLevel = resolveReaderLayoutLevel(settings);

  applyReaderTheme(nextSettings.theme);
  applyReaderFlow(nextSettings.flow, null, readerRoot);
  applyReaderFontSize(nextSettings.fontSize);
  applyReaderLayoutLevel(layoutLevel, runtime.readerView, readerRoot);
  emitDockUpdate();
}

function createView() {
  const view = document.createElement("foliate-view") as FoliateViewElement;
  view.enhanceDocument = (doc) => enhanceCachedReaderDocument(doc, view);
  setReaderRenderPending(true);
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
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
  if (isPending) renderPendingToken += 1;
  readerRoot.classList.toggle("reader-frame--pending", isPending);
}

function isReaderRenderPending() {
  return readerRoot.classList.contains("reader-frame--pending");
}

function showScrollEdgeFeedback(direction: number) {
  const now = performance.now();
  if (now - lastScrollEdgeFeedbackAt < SCROLL_EDGE_FEEDBACK_COOLDOWN_MS) return;
  lastScrollEdgeFeedbackAt = now;

  const edgeClass = direction < 0 ? "reader-frame--edge-top" : "reader-frame--edge-bottom";
  readerRoot.classList.remove("reader-frame--edge-top", "reader-frame--edge-bottom");
  void readerRoot.offsetWidth;
  readerRoot.classList.add(edgeClass);

  if (scrollEdgeFeedbackTimer !== undefined) window.clearTimeout(scrollEdgeFeedbackTimer);
  scrollEdgeFeedbackTimer = window.setTimeout(() => {
    readerRoot.classList.remove(edgeClass);
    scrollEdgeFeedbackTimer = undefined;
  }, 360);
}

async function revealReaderAfterPaint(...documents: Array<Document | undefined>) {
  const token = renderPendingToken;
  await waitForReaderDocumentsReady(documents);
  await waitForNextPaint();
  if (token === renderPendingToken) setReaderRenderPending(false);
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
      fonts.load(`${state.readerFontSize}px "${READER_FONT_FAMILY}"`),
      fonts.load(`${state.readerFontSize}px "${READER_LATIN_FONT_FAMILY}"`),
      fonts.load(`${state.readerFontSize}px "${READER_MONO_FONT_FAMILY}"`),
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
  state.isRestoring = true;
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
    state.isRestoring = false;
  }
}

async function openBook(input: File | string, sourceLabel: string) {
  const normalizedInput = typeof input === "string" ? normalizeSourceUrlForOpen(input) : input;
  const fileUrl = typeof normalizedInput === "string" ? normalizedInput : undefined;
  const legacyBookKey = fileUrl ?? "";
  const canRead = await ensureFileSchemeAccess(fileUrl);
  if (!canRead) return;

  await ensureFoliateView();

  if (!runtime.readerView) {
    runtime.readerView = createView();
  }

  try {
    state.currentBookKey = legacyBookKey;
    state.currentSourceUrl = fileUrl ?? "";
    currentSaveHandle = undefined;
    resetTransientBookState();
    setReaderRenderPending(true);
    if (runtime.readerView.book) runtime.readerView.close();
    await preloadReaderFonts();
    await runtime.readerView.open(normalizedInput);
    state.currentBookKey = await deriveBookKey(runtime.readerView.book, legacyBookKey);
    const bookKey = state.currentBookKey;
    void getStoredFileHandle(bookKey)
      .then((handle) => {
        if (state.currentBookKey === bookKey) currentSaveHandle = handle ?? null;
      })
      .catch((error) => {
        console.warn("Failed to restore saved EPUB file handle.", error);
      });
    await reconcileBookStorage(state.currentBookKey, [legacyBookKey]);
    applyReaderSettings(
      state.currentBookKey ? await getSavedReaderSettings(state.currentBookKey) : undefined,
    );

    cleanDocumentTitle = getOpenedFilename(input, fileUrl);
    renderDocumentTitle();
    setHasUnsavedChanges(false);
    emitBookInfoUpdate();
    await restoreSavedPosition(
      runtime.readerView,
      state.currentBookKey ? await getSavedPosition(state.currentBookKey) : undefined,
    );
    await revealReaderAfterPaint(...getCurrentReaderDocuments());
    schedulePostLoadTasks(runtime.readerView, state.currentBookKey);
  } catch (error) {
    setReaderRenderPending(false);
    console.error(`Failed to open ${sourceLabel}`, error);
  }
}

function readSourceFromQuery() {
  const query = window.location.search;
  if (!query) return null;

  const rawSource = readRawQueryValue(query, "src");
  if (rawSource) return decodeQueryValue(rawSource);

  return new URLSearchParams(query).get("src");
}

function readRawQueryValue(query: string, key: string) {
  const prefix = `${key}=`;
  const parts = query.startsWith("?") ? query.slice(1).split("&") : query.split("&");
  const partIndex = parts.findIndex((part) => part.startsWith(prefix));
  if (partIndex < 0) return null;

  // src is the only viewer query value today; keeping the tail preserves unescaped
  // ampersands in local file names from older or manually opened URLs.
  return parts.slice(partIndex).join("&").slice(prefix.length);
}

function decodeQueryValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSourceUrlForOpen(sourceUrl: string) {
  if (!sourceUrl.startsWith("file://")) return sourceUrl;
  try {
    return new URL(sourceUrl).href;
  } catch {
    return sourceUrl;
  }
}

function setupCriticalInteractions() {
  let clickStart: { x: number; y: number } | null = null;

  window.addEventListener("resize", () => {
    if (runtime.readerView) applyReaderLayout(runtime.readerView, readerRoot);
    runtime.highlightController?.close();
  });

  readerRoot.addEventListener("pointerdown", (event) => {
    clickStart = null;
    if (state.flow !== "scrolled") return;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Node) || !readerRoot.contains(event.target)) return;

    clickStart = { x: event.clientX, y: event.clientY };
  }, true);

  readerRoot.addEventListener("click", (event) => {
    const start = clickStart;
    clickStart = null;
    if (state.flow !== "scrolled") return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Node) || !readerRoot.contains(event.target)) return;
    if (!start || !isClickDistance(start.x, start.y, event.clientX, event.clientY)) return;

    emitPageTurnFromEdgeClick(event.clientX);
  });

  window.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Node && readerRoot.contains(event.target)) {
      event.preventDefault();
    }
  });
}

function setupExtraInteractions() {
  listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
    if (!href) return;
    if (isReaderRenderPending()) return;
    void runWithReaderRenderPending(() => runtime.readerView?.goTo(href));
  });
  listenViewerEvent(VIEWER_EVENTS.searchCollect, ({ highlightedOnly, query }) => {
    void ensureSearchController().collect(query, { highlightedOnly });
  });
  listenViewerEvent(VIEWER_EVENTS.searchPrevious, () => {
    void ensureSearchController().showPrevious();
  });
  listenViewerEvent(VIEWER_EVENTS.searchNext, () => {
    void ensureSearchController().showNext();
  });
  listenViewerEvent(VIEWER_EVENTS.searchClear, () => {
    clearSearchState();
  });
  listenViewerEvent(VIEWER_EVENTS.highlightContextAction, (action) => {
    runtime.highlightController?.handleContextAction(action);
  });
  listenViewerEvent(VIEWER_EVENTS.unsavedChange, () => {
    setHasUnsavedChanges(true);
  });

  listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
    void handleDockAction(action);
  });

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
      const nextTheme = getNextReaderTheme();
      applyReaderTheme(nextTheme.id);
      runtime.readerView?.renderer?.setStyles?.(getBookStyles());
    });
    saveCurrentReaderSettings();
    emitDockUpdate();
    return;
  }

  if (action === "decrease-font" || action === "increase-font") {
    const delta = action === "decrease-font" ? -READER_FONT_SIZE_STEP : READER_FONT_SIZE_STEP;
    if (!canChangeReaderFontSize(delta)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderFontSize(delta, runtime.readerView);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }

  if (action === "decrease-width" || action === "increase-width") {
    const delta = action === "decrease-width" ? -READER_LAYOUT_LEVEL_STEP : READER_LAYOUT_LEVEL_STEP;
    if (!canChangeReaderLayoutLevel(delta)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderLayoutLevel(delta, runtime.readerView, readerRoot);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }
}

function setupExtraUi() {
  if (runtime.extraUiReady) return;
  runtime.extraUiReady = true;

  ensureKeybindings();
  emitDockUpdate();
  runtime.highlightController?.bindContextTargets();
  setupExtraInteractions();
}

function schedulePostLoadTasks(view: FoliateViewElement, bookKey: string) {
  const taskToken = ++runtime.postLoadTaskToken;

  requestAnimationFrame(() => {
    if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;

    runWhenIdle(setupExtraUi, 1000);

    runWhenIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      runtime.highlightController?.bindContextTargets();
      if (bookKey) {
        void importEmbeddedHighlights(bookKey, state.currentSourceUrl, taskToken)
          .finally(() => {
            if (runtime.readerView === view && runtime.postLoadTaskToken === taskToken) {
              runtime.highlightController?.scheduleRestore(view, bookKey);
            }
          });
      }
    }, 1500);

    runWhenIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      runtime.tocItems = view.book?.toc ?? [];
      emitTocUpdate();
    }, 2000);
  });
}

async function importEmbeddedHighlights(bookKey: string, sourceUrl: string, taskToken: number) {
  if (!sourceUrl || runtime.postLoadTaskToken !== taskToken) return;

  try {
    const highlights = await readEmbeddedHighlights(sourceUrl);
    if (runtime.postLoadTaskToken !== taskToken) return;
    await mergeSavedHighlights(bookKey, highlights);
  } catch (error) {
    console.warn("Failed to read embedded EPUB overlays.", error);
  }
}

async function bootstrap() {
  applyReaderSettings(undefined);
  setupCriticalInteractions();
  runtime.readingProgressController?.bind();

  const src = readSourceFromQuery();
  if (src) {
    void openBook(src, formatSourcePath(src) || src);
  } else {
    void preloadReaderFonts();
    runWhenIdle(setupExtraUi, 1000);
  }
}

void bootstrap();
