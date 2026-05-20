import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  applyReaderFlow,
  applyReaderFontSize,
  applyReaderLayout,
  applyReaderMargin,
  applyReaderSpacing,
  applyReaderTheme,
  changeReaderDensity,
  changeReaderFontSize,
  changeReaderFlow,
  changeReaderWidth,
  getBookStyles,
  READER_FONT_FAMILY,
  READER_FONT_SIZE_STEP,
  READER_FONT_URL,
  READER_MARGIN_STEP,
  READER_MONO_FONT_FAMILY,
  READER_MONO_FONT_URL,
  READER_SPACING_STEP,
  READER_THEMES,
} from "./reader-settings";
import { createHighlightController } from "./highlight-controller";
import { createSearchController } from "./search-controller";
import { normalizeTocItems } from "./toc-controller";
import { App } from "./app";
import { createReadingProgressController } from "./components/reading-progress";
import { VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { runtime } from "./viewer-runtime";
import { state } from "./viewer-state";
import {
  getSavedPosition,
  getSavedReaderSettings,
  saveReaderSettings,
  saveReadingPosition,
} from "./viewer-storage";
import type { FoliateViewElement, ReaderSettings, ReadingPosition, RelocateDetail } from "./viewer-types";
import type { DockActionDetail, DockUpdateDetail, HighlightContextActionDetail, PageTurnDetail, SearchCollectDetail, TocNavigateDetail } from "./viewer-events";
import "./viewer.css";

const appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing required element: #app");
flushSync(() => {
  createRoot(appRoot).render(App());
});

const readerRoot = queryRequired<HTMLDivElement>("#reader-root");
const readingProgress = queryRequired<HTMLElement>("#reading-progress");
const readingProgressTrack = queryRequired<HTMLElement>(".reader-progress-track");
const readingProgressFill = queryRequired<HTMLElement>("#reading-progress-fill");

function queryRequired<T extends Element>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

const defaultReaderSettings: ReaderSettings = {
  flow: "paginated",
  fontSize: 19,
  margin: 8,
  spacing: 0,
  theme: "light",
};
runtime.readingProgressController = createReadingProgressController({
  root: readingProgress,
  track: readingProgressTrack,
  fill: readingProgressFill,
  canSeek: () => Boolean(runtime.readerView?.book),
  onSeek: (progress) => {
    void runtime.readerView?.goTo({ fraction: progress }).catch((error) => {
      console.warn("Failed to seek reading progress.", error);
    });
  },
});
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
  window.dispatchEvent(
    new CustomEvent(VIEWER_EVENTS.tocUpdate, {
      detail: {
        currentHref: state.currentHref,
        items: runtime.tocItems,
      },
    }),
  );
}

function formatLocalized(value?: string | Record<string, string>) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const [firstKey] = Object.keys(value);
  return firstKey ? value[firstKey] : "";
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

function runWhenIdle(callback: () => void, timeout = 500) {
  const requestIdle = globalThis.requestIdleCallback;
  if (requestIdle) {
    requestIdle(callback, { timeout });
    return;
  }
  globalThis.setTimeout(callback, 0);
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
  const progress = typeof detail.fraction === "number" ? detail.fraction : 0;
  runtime.readingProgressController?.setProgress(progress);
}

function queuePositionSave(detail: RelocateDetail) {
  if (!state.currentBookKey || state.isRestoring) return;

  window.clearTimeout(runtime.savePositionTimer);
  runtime.savePositionTimer = window.setTimeout(() => {
    void saveReadingPosition(state.currentBookKey, detail);
  }, 350);
}

function wireReaderEvents(view: FoliateViewElement) {
  view.addEventListener("load", (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail;
    if (doc) labelFootnotes(doc);
  });

  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;

    state.currentHref = detail.tocItem?.href ?? "";
    emitTocUpdate();
    updatePageStatus(detail);
    queuePositionSave(detail);
    runtime.highlightController?.bindContextTargets();
    labelFootnoteTargets();
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

function getFootnoteTargets(doc: Document) {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      [
        `aside[epub\\:type~="footnote"]`,
        `aside[epub\\:type~="endnote"]`,
        `aside[epub\\:type~="rearnote"]`,
        `aside[role~="doc-footnote"]`,
        `aside[role~="doc-endnote"]`,
        `li[epub\\:type~="footnote"]`,
        `li[epub\\:type~="endnote"]`,
        `li[epub\\:type~="rearnote"]`,
        `li[role~="doc-footnote"]`,
        `li[role~="doc-endnote"]`,
      ].join(","),
    ),
  );
}

function getEpubType(element: Element) {
  return element.getAttributeNS("http://www.idpf.org/2007/ops", "type")
    || element.getAttribute("epub:type")
    || "";
}

function isNoteref(anchor: HTMLAnchorElement) {
  return getEpubType(anchor).split(/\s+/).includes("noteref")
    || anchor.getAttribute("role")?.split(/\s+/).includes("doc-noteref")
    || false;
}

function getFootnoteReferenceAnchors(doc: Document) {
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isNoteref);
}

function normalizeFootnoteLabel(value: string | undefined, fallbackIndex: number) {
  const marker = value?.replace(/\s+/g, " ").trim().match(/^\[?(\d+)\]?/)?.[1];
  const label = marker || String(fallbackIndex);
  return /^\[.*\]$/.test(label) ? label : `[${label}]`;
}

function labelFootnotes(doc: Document) {
  const labelsByTargetId = new Map<string, string>();
  getFootnoteReferenceAnchors(doc).forEach((anchor, index) => {
    const href = anchor.getAttribute("href")?.trim();
    if (!href?.startsWith("#")) return;

    const targetId = decodeURIComponent(href.slice(1));
    const label = normalizeFootnoteLabel(anchor.textContent || anchor.querySelector("img")?.getAttribute("alt") || undefined, index + 1);
    labelsByTargetId.set(targetId, label);
    anchor.dataset.footnoteLabel = label;
  });

  for (const [targetId, label] of labelsByTargetId) {
    const target = doc.getElementById(targetId);
    if (!target) continue;
    target.dataset.readerFootnoteTarget = "true";
    target.dataset.footnoteLabel = label;
  }

  getFootnoteTargets(doc).forEach((element, index) => {
    element.dataset.readerFootnoteTarget = "true";
    element.dataset.footnoteLabel = labelsByTargetId.get(element.id)
      || normalizeFootnoteLabel(element.textContent || undefined, index + 1);
  });
}

function labelFootnoteTargets() {
  for (const { doc } of runtime.readerView?.renderer?.getContents?.() ?? []) {
    if (doc) labelFootnotes(doc);
  }
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
  const theme = READER_THEMES.find((item) => item.id === state.readerTheme) ?? READER_THEMES[0]!;
  const themeIndex = READER_THEMES.findIndex((item) => item.id === theme.id);
  const isPaginated = state.flow === "paginated";

  return {
    canExport: Boolean(state.currentSourceUrl),
    canSearch: Boolean(runtime.readerView?.search),
    flowActive: !isPaginated,
    flowLabel: isPaginated ? "Switch to scrolling mode" : "Switch to paginated mode",
    searchActive: runtime.isSearchOpen,
    themeActive: theme.mode === "dark",
    themeCount: String(themeIndex + 1),
    themeLabel: `Change theme, current theme ${theme.label}`,
  };
}

function emitDockUpdate() {
  window.dispatchEvent(new CustomEvent<DockUpdateDetail>(VIEWER_EVENTS.dockUpdate, { detail: getDockUpdateDetail() }));
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
    margin: state.readerMargin,
    spacing: state.readerSpacing,
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
  window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchOpen));
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
  window.clearTimeout(runtime.savePositionTimer);
  clearSearchState();
  runtime.tocItems = [];
  emitTocUpdate();
  runtime.highlightController?.reset();
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...defaultReaderSettings, ...settings };

  applyReaderFlow(nextSettings.flow, runtime.readerView, readerRoot);
  applyReaderSpacing(nextSettings.spacing, runtime.readerView);
  applyReaderMargin(nextSettings.margin, runtime.readerView, readerRoot);
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
    if (!savedPosition) {
      await view.init({ showTextStart: true });
      return;
    }

    if (savedPosition.cfi) {
      await view.init({ lastLocation: savedPosition.cfi });
      return;
    }

    if (typeof savedPosition.fraction === "number") {
      await view.init({ lastLocation: { fraction: savedPosition.fraction } });
      return;
    }

    await view.init({ showTextStart: true });
  } catch (error) {
    console.warn("Failed to restore saved reading position.", error);
    await view.init({ showTextStart: true });
  } finally {
    state.isRestoring = false;
  }
}

async function openBook(input: File | string, sourceLabel: string) {
  const fileUrl = typeof input === "string" ? input : undefined;
  const canRead = await ensureFileSchemeAccess(fileUrl);
  if (!canRead) return;

  await ensureFoliateView();

  if (!runtime.readerView) {
    runtime.readerView = createView();
  }

  try {
    state.currentBookKey = fileUrl ?? "";
    state.currentSourceUrl = fileUrl ?? "";
    emitDockUpdate();
    resetTransientBookState();
    if (runtime.readerView.book) runtime.readerView.close();
    void preloadReaderFonts();
    await runtime.readerView.open(input);
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
    if (state.currentBookKey) runtime.highlightController?.scheduleRestore(runtime.readerView, state.currentBookKey);
    runtime.highlightController?.bindContextTargets();
    scheduleExtraUiSetup();
    runWhenIdle(() => {
      runtime.tocItems = normalizeTocItems(runtime.readerView?.book?.toc);
      emitTocUpdate();
    }, 1200);
  } catch (error) {
    console.error(`Failed to open ${sourceLabel}`, error);
  }
}

function readSourceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("src");
}

function setupCriticalInteractions() {
  window.addEventListener(VIEWER_EVENTS.pageTurn, (event) => {
    turnPage((event as CustomEvent<PageTurnDetail>).detail.direction);
  });

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

function turnPage(direction: PageTurnDetail["direction"]) {
  if (state.flow === "paginated") {
    void (direction === "left" ? runtime.readerView?.goLeft?.() : runtime.readerView?.goRight?.());
    return;
  }

  const isRtl = runtime.readerView?.book?.dir === "rtl";
  const shouldGoNext = direction === "left" ? isRtl : !isRtl;
  void (shouldGoNext ? runtime.readerView?.renderer?.nextSection?.() : runtime.readerView?.renderer?.prevSection?.());
}

function setupExtraInteractions() {
  window.addEventListener(VIEWER_EVENTS.tocNavigate, (event) => {
    const { href } = (event as CustomEvent<TocNavigateDetail>).detail;
    if (!href) return;
    void runtime.readerView?.goTo(href);
  });
  window.addEventListener(VIEWER_EVENTS.searchCollect, (event) => {
    const { highlightedOnly, query } = (event as CustomEvent<SearchCollectDetail>).detail;
    void ensureSearchController().collect(query, { highlightedOnly });
  });
  window.addEventListener(VIEWER_EVENTS.searchPrevious, () => {
    void ensureSearchController().showPrevious();
  });
  window.addEventListener(VIEWER_EVENTS.searchNext, () => {
    void ensureSearchController().showNext();
  });
  window.addEventListener(VIEWER_EVENTS.searchClear, () => {
    clearSearchState();
  });
  window.addEventListener(VIEWER_EVENTS.highlightContextAction, (event) => {
    const { action } = (event as CustomEvent<HighlightContextActionDetail>).detail;
    runtime.highlightController?.handleContextAction(action);
  });

  window.addEventListener(VIEWER_EVENTS.dockAction, (event) => {
    handleDockAction((event as CustomEvent<DockActionDetail>).detail.action);
  });

}

function handleDockAction(action: DockActionDetail["action"]) {
  if (action === "open-toc") {
    emitTocUpdate();
    window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.tocOpen));
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
    const currentIndex = READER_THEMES.findIndex((theme) => theme.id === state.readerTheme);
    const nextTheme = READER_THEMES[(currentIndex + 1) % READER_THEMES.length]!;
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
    changeReaderWidth(-READER_MARGIN_STEP, runtime.readerView, readerRoot);
    changeReaderDensity(-READER_SPACING_STEP, runtime.readerView);
    saveCurrentReaderSettings();
    return;
  }

  if (action === "increase-width") {
    changeReaderWidth(READER_MARGIN_STEP, runtime.readerView, readerRoot);
    changeReaderDensity(READER_SPACING_STEP, runtime.readerView);
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

function scheduleExtraUiSetup() {
  runWhenIdle(setupExtraUi, 1000);
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
    scheduleExtraUiSetup();
  }
}

void bootstrap();
