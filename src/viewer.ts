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
  getReaderTheme,
  getReaderThemeIndex,
} from "./reader-themes";
import { deriveBookKey, formatLocalized } from "./book-key";
import { createHighlightController } from "./highlight-controller";
import { createReaderDocumentCache } from "./reader-document-cache";
import { enhanceReaderContent, prepareReaderContentDocument } from "./reader-content-enhancers";
import { createSearchController } from "./search-controller";
import { createDebouncedTask, runWhenIdle } from "./scheduler";
import { collectSectionHrefs, normalizeTocHref, normalizeTocItems } from "./toc-controller";
import { App } from "./app";
import { createReadingProgressController } from "./components/reading-progress";
import type { ReadingProgressElements } from "./components/reading-progress";
import { emitViewerEvent, listenViewerEvent, VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { runtime } from "./viewer-runtime";
import { state } from "./viewer-state";
import {
  getSavedPosition,
  getSavedReaderSettings,
  reconcileBookStorage,
  saveReaderSettings,
  saveReadingPosition,
} from "./viewer-storage";
import type { FoliateViewElement, ReaderSettings, ReadingPosition, RelocateDetail } from "./viewer-types";
import type { ContentEdgeClickDetail, DockAction, DockUpdateDetail, PageTurnDirection } from "./viewer-events";
import "./viewer.css";

const appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing required element: #app");

function mountReadingProgressController(elements: ReadingProgressElements | null) {
  runtime.readingProgressController?.destroy?.();
  runtime.readingProgressController = null;
  if (!elements) return;

  runtime.readingProgressController = createReadingProgressController({
    ...elements,
    canSeek: () => Boolean(runtime.readerView?.book),
    onSeek: (progress) => {
      void runWithReaderRenderPending(() => runtime.readerView?.goTo({ fraction: progress })).catch((error) => {
        console.warn("Failed to seek reading progress.", error);
      });
    },
    onReturn: (progress) => {
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

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
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
    canTurnPage: () => !document.body.classList.contains("reader-image-zoom-open"),
    beforeSectionTurn: () => setReaderRenderPending(true),
    onScrollEdge: showScrollEdgeFeedback,
    openSearch,
    closeSearch: clearSearchState,
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

function installFoliateScrollbarPatch() {
  if (runtime.foliateScrollbarPatchReady) return;
  runtime.foliateScrollbarPatchReady = true;

  const descriptor = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "innerHTML");
  if (!descriptor?.set || !descriptor.get) return;

  Object.defineProperty(ShadowRoot.prototype, "innerHTML", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value: string) {
      descriptor.set!.call(this, value);
      const hostName = this.host?.localName;
      if (hostName !== "foliate-paginator" && hostName !== "foliate-fxl") return;

      const style = document.createElement("style");
      style.textContent = `
        #container {
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }
        #container::-webkit-scrollbar {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
        }
      `;
      this.append(style);
    },
  });
}

function ensureFoliateView() {
  installFoliateScrollbarPatch();
  runtime.foliateViewReady ??= import("foliate-js/view.js");
  return runtime.foliateViewReady;
}

function updatePageStatus(detail: RelocateDetail) {
  runtime.readingProgressController?.handleRelocate({
    ...detail,
    index: resolveRelocateSectionIndex(detail),
  });
}

function resolveRelocateSectionIndex(detail: RelocateDetail) {
  if (typeof detail.index === "number") return detail.index;

  const href = detail.tocItem?.href;
  if (!href || !runtime.tocSectionHrefs.length) return undefined;

  const currentHref = normalizeTocHref(href);
  if (!currentHref) return undefined;

  const index = runtime.tocSectionHrefs.findIndex((item) => item === currentHref);
  return index >= 0 ? index : undefined;
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

function queueHighlightContextBind(view: FoliateViewElement) {
  highlightContextBindTask.schedule(view);
}

function wireReaderEvents(view: FoliateViewElement) {
  view.addEventListener("load", (event) => {
    const { doc, index } = (event as CustomEvent<{ doc?: Document; index?: number }>).detail;
    if (!doc) return;
    if (runtime.readerView === view) {
      setReaderRenderPending(true);
      void revealReaderAfterPaint(doc);
    }

    enhanceReaderContent(doc, {
      getFlow: () => state.flow,
      isCurrent: () => runtime.readerView === view,
    });
    if (runtime.readerView === view) runtime.readerDocumentCache?.prepareAround(index);
  });

  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;
    const sectionIndex = resolveRelocateSectionIndex(detail);

    const currentHref = detail.tocItem?.href ?? "";
    if (currentHref !== state.currentHref) {
      state.currentHref = currentHref;
      emitTocUpdate();
    }
    updatePageStatus(detail);
    runtime.readerDocumentCache?.prepareAround(sectionIndex);
    queuePositionSave(detail);
    queueHighlightContextBind(view);
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
  const theme = getReaderTheme();
  const themeIndex = getReaderThemeIndex();
  const isPaginated = state.flow === "paginated";

  return {
    canExport: Boolean(state.currentSourceUrl),
    canSearch: Boolean(runtime.readerView?.search),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling mode" : "Switch to paginated mode",
    searchActive: runtime.isSearchOpen,
    themeActive: theme.mode === "dark",
    themeCount: String(themeIndex + 1),
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

async function exportCurrentBook() {
  if (!state.currentSourceUrl) return;

  await chrome.downloads.download({
    saveAs: true,
    filename: deriveDownloadFilename(state.currentSourceUrl),
    url: state.currentSourceUrl,
  });
}

function clearSearchState() {
  runtime.isSearchOpen = false;
  runtime.searchController?.clear();
  emitDockUpdate();
}

function getCurrentReaderSettings(): ReaderSettings {
  return {
    flow: state.flow,
    fontSize: state.readerFontSize,
    layoutLevel: state.readerLayoutLevel,
    theme: state.readerTheme,
  };
}

function saveCurrentReaderSettings() {
  if (!state.currentBookKey) return;
  void saveReaderSettings(state.currentBookKey, getCurrentReaderSettings());
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
  savePositionTask.cancel();
  highlightContextBindTask.cancel();
  clearSearchState();
  runtime.readerDocumentCache?.reset();
  runtime.tocItems = [];
  runtime.tocSectionHrefs = [];
  emitTocUpdate();
  runtime.highlightController?.reset();
  runtime.readingProgressController?.setHistoryProgress(null);
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...defaultReaderSettings, ...settings };
  const layoutLevel = resolveReaderLayoutLevel(settings);

  applyReaderFlow(nextSettings.flow, runtime.readerView, readerRoot);
  applyReaderLayoutLevel(layoutLevel, runtime.readerView, readerRoot);
  applyReaderFontSize(nextSettings.fontSize, runtime.readerView);
  applyReaderTheme(nextSettings.theme);
  runtime.readerView?.renderer?.setStyles?.(getBookStyles());
  emitDockUpdate();
}

function createView() {
  const view = document.createElement("foliate-view") as FoliateViewElement;
  setReaderRenderPending(true);
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
}

function setReaderRenderPending(isPending: boolean) {
  if (isPending) renderPendingToken += 1;
  readerRoot.classList.toggle("reader-frame--pending", isPending);
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
  if (doc.documentElement.dataset.readerCachedDocument === "true") return;

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
  const fileUrl = typeof input === "string" ? input : undefined;
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
    emitDockUpdate();
    resetTransientBookState();
    setReaderRenderPending(true);
    if (runtime.readerView.book) runtime.readerView.close();
    await preloadReaderFonts();
    await runtime.readerView.open(input);
    runtime.readerDocumentCache = createReaderDocumentCache({
      enhanceDocument: (doc) => prepareReaderContentDocument(doc, {
        isCurrent: () => true,
      }),
    });
    runtime.readerDocumentCache.setBook(runtime.readerView.book ?? null);
    state.currentBookKey = await deriveBookKey(runtime.readerView.book, legacyBookKey);
    await reconcileBookStorage(state.currentBookKey, [legacyBookKey]);
    applyReaderSettings(
      state.currentBookKey ? await getSavedReaderSettings(state.currentBookKey) : undefined,
    );

    const metadata = runtime.readerView.book?.metadata;
    const title = formatLocalized(metadata?.title) || "Untitled Book";

    document.title = `${title} · EPUB Viewer`;
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
  const params = new URLSearchParams(window.location.search);
  return params.get("src");
}

function setupCriticalInteractions() {
  window.addEventListener("resize", () => {
    if (runtime.readerView) applyReaderLayout(runtime.readerView, readerRoot);
    runtime.highlightController?.close();
  });

  readerRoot.addEventListener("click", (event) => {
    if (state.flow !== "scrolled") return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Node) || !readerRoot.contains(event.target)) return;

    emitViewerEvent(VIEWER_EVENTS.contentEdgeClick, { x: event.clientX });
  });

  window.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Node && readerRoot.contains(event.target)) {
      event.preventDefault();
    }
  });
}

function setupExtraInteractions() {
  listenViewerEvent(VIEWER_EVENTS.contentEdgeClick, (detail) => {
    const direction = resolveEdgeClickDirection(detail.x);
    if (direction) emitViewerEvent(VIEWER_EVENTS.pageTurn, direction);
  });
  listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
    if (!href) return;
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

  listenViewerEvent(VIEWER_EVENTS.dockAction, (action) => {
    void handleDockAction(action);
  });

}

function resolveEdgeClickDirection(clientX: number): PageTurnDirection | null {
  const edgeWidth = window.innerWidth * 0.22;
  if (clientX <= edgeWidth) return "left";
  if (clientX >= window.innerWidth - edgeWidth) return "right";
  return null;
}

async function runReaderStyleChange(action: () => void) {
  await runWithReaderRenderPending(async () => {
    await preloadReaderFonts();
    action();
  });
}

async function handleDockAction(action: DockAction) {
  if (action === "open-toc") {
    emitTocUpdate();
    emitViewerEvent(VIEWER_EVENTS.tocOpen);
    return;
  }

  if (action === "toggle-search") {
    toggleSearch();
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

  if (action === "decrease-font") {
    if (!canChangeReaderFontSize(-READER_FONT_SIZE_STEP)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderFontSize(-READER_FONT_SIZE_STEP, runtime.readerView);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }

  if (action === "increase-font") {
    if (!canChangeReaderFontSize(READER_FONT_SIZE_STEP)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderFontSize(READER_FONT_SIZE_STEP, runtime.readerView);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }

  if (action === "decrease-width") {
    if (!canChangeReaderLayoutLevel(-READER_LAYOUT_LEVEL_STEP)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderLayoutLevel(-READER_LAYOUT_LEVEL_STEP, runtime.readerView, readerRoot);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }

  if (action === "increase-width") {
    if (!canChangeReaderLayoutLevel(READER_LAYOUT_LEVEL_STEP)) return;
    let changed = false;
    await runReaderStyleChange(() => {
      changed = changeReaderLayoutLevel(READER_LAYOUT_LEVEL_STEP, runtime.readerView, readerRoot);
    });
    if (changed) saveCurrentReaderSettings();
    return;
  }

  if (action === "export") {
    void exportCurrentBook();
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
      if (bookKey) runtime.highlightController?.scheduleRestore(view, bookKey);
    }, 1500);

    runWhenIdle(() => {
      if (runtime.readerView !== view || runtime.postLoadTaskToken !== taskToken) return;
      runtime.tocItems = normalizeTocItems(view.book?.toc);
      runtime.tocSectionHrefs = collectSectionHrefs(runtime.tocItems);
      emitTocUpdate();
    }, 2000);
  });
}

async function bootstrap() {
  applyReaderSettings(undefined);
  emitDockUpdate();
  setupCriticalInteractions();
  runtime.readingProgressController?.bind();
  emitDockUpdate();

  const src = readSourceFromQuery();
  if (src) {
    void openBook(src, src.split("/").pop() || src);
  } else {
    void preloadReaderFonts();
    runWhenIdle(setupExtraUi, 1000);
  }
}

void bootstrap();
