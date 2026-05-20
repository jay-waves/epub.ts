import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFlow,
  applyReaderFontSize,
  applyReaderLayoutLevel,
  applyReaderLayout,
  changeReaderFontSize,
  changeReaderFlow,
  changeReaderLayoutLevel,
  getBookStyles,
  READER_FONT_FAMILY,
  READER_FONT_SIZE_STEP,
  READER_FONT_URL,
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
import { enhanceReaderContent } from "./reader-content-enhancers";
import { createSearchController } from "./search-controller";
import { createDebouncedTask, runWhenIdle } from "./scheduler";
import { normalizeTocHref, normalizeTocItems } from "./toc-controller";
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
import type { DockAction, DockUpdateDetail } from "./viewer-events";
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
      void runtime.readerView?.goTo({ fraction: progress }).catch((error) => {
        console.warn("Failed to seek reading progress.", error);
      });
    },
    onReturn: (progress) => {
      void runtime.readerView?.goTo({ fraction: progress }).catch((error) => {
        console.warn("Failed to return to reading position.", error);
      });
    },
  });
}

flushSync(() => {
  createRoot(appRoot).render(App({ onReadingProgressReady: mountReadingProgressController }));
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

const defaultReaderSettings: ReaderSettings = {
  flow: "paginated",
  fontSize: 19,
  layoutLevel: 2,
  theme: "light",
};

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

function collectSectionHrefs(items: typeof runtime.tocItems, sections: string[] = [], seen = new Set<string>()) {
  for (const item of items) {
    const href = normalizeTocHref(item.href);
    if (href && !seen.has(href)) {
      seen.add(href);
      sections.push(href);
    }
    if (item.subitems?.length) collectSectionHrefs(item.subitems, sections, seen);
  }
  return sections;
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

    enhanceReaderContent(doc, {
      isCurrent: () => runtime.readerView === view,
      runWhenIdle,
    });
    runWhenIdle(() => {
      if (runtime.readerView !== view) return;
      runtime.readerDocumentCache?.prepareAround(index);
    }, 700);
  });

  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;

    const currentHref = detail.tocItem?.href ?? "";
    if (currentHref !== state.currentHref) {
      state.currentHref = currentHref;
      emitTocUpdate();
    }
    updatePageStatus(detail);
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
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  runtime.keybindings?.bindReaderView(view);
  return view;
}

async function restoreSavedPosition(view: FoliateViewElement, savedPosition?: ReadingPosition) {
  state.isRestoring = true;
  try {
    await view.init(getSavedPositionInitOptions(savedPosition));
  } catch (error) {
    console.warn("Failed to restore saved reading position.", error);
    await view.init({ showTextStart: true });
  } finally {
    state.isRestoring = false;
  }
}

function getSavedPositionInitOptions(savedPosition?: ReadingPosition): Parameters<FoliateViewElement["init"]>[0] {
  if (savedPosition?.cfi) return { lastLocation: savedPosition.cfi };
  if (typeof savedPosition?.fraction === "number") return { lastLocation: { fraction: savedPosition.fraction } };
  return { showTextStart: true };
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
    if (runtime.readerView.book) runtime.readerView.close();
    void preloadReaderFonts();
    await runtime.readerView.open(input);
    runtime.readerDocumentCache = createReaderDocumentCache();
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
    schedulePostLoadTasks(runtime.readerView, state.currentBookKey);
  } catch (error) {
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

  window.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Node && readerRoot.contains(event.target)) {
      event.preventDefault();
    }
  });
}

function setupExtraInteractions() {
  listenViewerEvent(VIEWER_EVENTS.tocNavigate, (href) => {
    if (!href) return;
    void runtime.readerView?.goTo(href);
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

  listenViewerEvent(VIEWER_EVENTS.dockAction, handleDockAction);

}

function handleDockAction(action: DockAction) {
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
    changeReaderFlow(runtime.readerView, readerRoot);
    saveCurrentReaderSettings();
    emitDockUpdate();
    return;
  }

  if (action === "toggle-theme") {
    const nextTheme = getNextReaderTheme();
    applyReaderTheme(nextTheme.id);
    runtime.readerView?.renderer?.setStyles?.(getBookStyles());
    saveCurrentReaderSettings();
    emitDockUpdate();
    return;
  }

  if (action === "decrease-font") {
    changeReaderFontSize(-READER_FONT_SIZE_STEP, runtime.readerView);
    saveCurrentReaderSettings();
    return;
  }

  if (action === "increase-font") {
    changeReaderFontSize(READER_FONT_SIZE_STEP, runtime.readerView);
    saveCurrentReaderSettings();
    return;
  }

  if (action === "decrease-width") {
    changeReaderLayoutLevel(-READER_LAYOUT_LEVEL_STEP, runtime.readerView, readerRoot);
    saveCurrentReaderSettings();
    return;
  }

  if (action === "increase-width") {
    changeReaderLayoutLevel(READER_LAYOUT_LEVEL_STEP, runtime.readerView, readerRoot);
    saveCurrentReaderSettings();
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
