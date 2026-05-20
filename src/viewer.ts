import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  createIcons,
  Download,
  Highlighter,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  Search,
  X,
} from "lucide";
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
  updateFlowButton,
} from "./reader-settings";
import { createHighlightController } from "./highlight-controller";
import { createSearchController } from "./search-controller";
import { createTocController } from "./toc-controller";
import { App } from "./App";
import { getViewerElements } from "./viewer-elements";
import { VIEWER_EVENTS } from "./viewer-events";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { state } from "./viewer-state";
import {
  getSavedPosition,
  getSavedReaderSettings,
  saveReaderSettings,
  saveReadingPosition,
} from "./viewer-storage";
import type { FoliateViewElement, ReaderSettings, ReadingPosition, RelocateDetail } from "./viewer-types";
import type { HighlightContextActionDetail, SearchCollectDetail, TocNavigateDetail } from "./viewer-events";
import "./viewer.css";

const appRoot = document.querySelector("#app");
if (!appRoot) throw new Error("Missing required element: #app");
flushSync(() => {
  createRoot(appRoot).render(App());
});

let readerFontsReady: Promise<void> | null = null;

const {
  readerRoot,
  toggleFlowButton,
  toggleThemeButton,
  themeCount,
  decreaseFontButton,
  increaseFontButton,
  decreaseWidthButton,
  increaseWidthButton,
  openSearchButton,
  openTocButton,
  exportButton,
  pageLeftZone,
  pageRightZone,
  readingProgress,
  readingProgressTrack,
  readingProgressFill,
  readingProgressLabel,
  tocRoot,
  tocModal,
} = getViewerElements();

let readerView: FoliateViewElement | null = null;
let foliateViewReady: Promise<unknown> | null = null;
let foliateScrollbarPatchReady = false;
let savePositionTimer: number | undefined;
let extraUiReady = false;
let currentProgress = 0;
let isSearchOpen = false;
const showReadingProgressLabel = false;
const defaultReaderSettings: ReaderSettings = {
  flow: "paginated",
  fontSize: 19,
  margin: 8,
  spacing: 0,
  theme: "light",
};
let keybindings: ReturnType<typeof setupViewerKeybindings> | null = null;
let tocController: ReturnType<typeof createTocController> | null = null;
let searchController: ReturnType<typeof createSearchController> | null = null;
const highlightController = createHighlightController({
  getBookKey: () => state.currentBookKey,
  getProgress: () => currentProgress,
  getReaderView: () => readerView,
  runWhenIdle,
});

function ensureKeybindings() {
  keybindings ??= setupViewerKeybindings({
    getReaderView: () => readerView,
    getFlow: () => state.flow,
    openSearch,
    closeSearch: clearSearchState,
  });
  if (readerView) keybindings.bindReaderView(readerView);
  return keybindings;
}

function ensureTocController() {
  tocController ??= createTocController({
    tocRoot,
    getCurrentHref: () => state.currentHref,
  });
  return tocController;
}

function ensureSearchController() {
  searchController ??= createSearchController({
    openSearchButton,
    getBookKey: () => state.currentBookKey,
    getReaderView: () => readerView,
  });
  return searchController;
}

function formatLocalized(value?: string | Record<string, string>) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const [firstKey] = Object.keys(value);
  return firstKey ? value[firstKey] : "";
}

function preloadReaderFonts() {
  if (readerFontsReady) return readerFontsReady;

  readerFontsReady = Promise.all([
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

  return readerFontsReady;
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
  if (foliateScrollbarPatchReady) return;
  foliateScrollbarPatchReady = true;

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
  foliateViewReady ??= import("foliate-js/view.js");
  return foliateViewReady;
}

function updatePageStatus(detail: RelocateDetail) {
  const progress = typeof detail.fraction === "number" ? detail.fraction : 0;
  setReadingProgress(progress);
  updateReadingProgressLabel(showReadingProgressLabel ? detail.tocItem?.label : undefined);
}

function updateTocCurrent() {
  tocController?.updateCurrent();
}

function resetToc() {
  tocController?.reset();
}

function queuePositionSave(detail: RelocateDetail) {
  if (!state.currentBookKey || state.isRestoring) return;

  window.clearTimeout(savePositionTimer);
  savePositionTimer = window.setTimeout(() => {
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
    updateTocCurrent();
    updatePageStatus(detail);
    queuePositionSave(detail);
    highlightController.bindContextTargets();
    labelFootnoteTargets();
  });

  view.addEventListener("create-overlay", (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    highlightController.addCurrentHighlightsToOverlay(view, index);
  });

  view.addEventListener("draw-annotation", (event) => {
    highlightController.drawAnnotation((event as CustomEvent<Parameters<typeof highlightController.drawAnnotation>[0]>).detail);
  });

  view.addEventListener("show-annotation", (event) => {
    highlightController.openFromAnnotation((event as CustomEvent<Parameters<typeof highlightController.openFromAnnotation>[0]>).detail);
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
  for (const { doc } of readerView?.renderer?.getContents?.() ?? []) {
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

function updateExportButton() {
  const hasSource = Boolean(state.currentSourceUrl);
  exportButton.disabled = !hasSource;
  exportButton.setAttribute("aria-disabled", hasSource ? "false" : "true");
}

function updateSearchButton() {
  searchController?.updateButton();
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
  isSearchOpen = false;
  openSearchButton.classList.remove("dock-active");
  searchController?.clear();
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
  isSearchOpen = true;
  openSearchButton.classList.add("dock-active");
  window.dispatchEvent(new CustomEvent(VIEWER_EVENTS.searchOpen));
}

function toggleSearch() {
  if (isSearchOpen) {
    clearSearchState();
    return;
  }

  openSearch();
}

function resetTransientBookState() {
  window.clearTimeout(savePositionTimer);
  clearSearchState();
  resetToc();
  highlightController.reset();
}

function applyReaderSettings(settings: Partial<ReaderSettings> | undefined) {
  const nextSettings = { ...defaultReaderSettings, ...settings };

  applyReaderFlow(nextSettings.flow, readerView, readerRoot);
  applyReaderSpacing(nextSettings.spacing, readerView);
  applyReaderMargin(nextSettings.margin, readerView, readerRoot);
  applyReaderFontSize(nextSettings.fontSize, readerView);
  applyReaderTheme(nextSettings.theme, {
    toggleThemeButton,
    themeCount,
    setBookStyles: () => readerView?.renderer?.setStyles?.(getBookStyles()),
  });
  updateFlowButton(toggleFlowButton);
}

function createView() {
  const view = document.createElement("foliate-view") as FoliateViewElement;
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  keybindings?.bindReaderView(view);
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

  if (!readerView) {
    readerView = createView();
  }

  try {
    state.currentBookKey = fileUrl ?? "";
    state.currentSourceUrl = fileUrl ?? "";
    updateExportButton();
    resetTransientBookState();
    if (readerView.book) readerView.close();
    void preloadReaderFonts();
    await readerView.open(input);
    applyReaderSettings(
      state.currentBookKey ? await getSavedReaderSettings(state.currentBookKey) : undefined,
    );

    const metadata = readerView.book?.metadata;
    const title = formatLocalized(metadata?.title) || "Untitled Book";

    document.title = `${title} · EPUB Viewer`;
    await restoreSavedPosition(
      readerView,
      state.currentBookKey ? await getSavedPosition(state.currentBookKey) : undefined,
    );
    if (state.currentBookKey) highlightController.scheduleRestore(readerView, state.currentBookKey);
    highlightController.bindContextTargets();
    scheduleExtraUiSetup();
    runWhenIdle(() => ensureTocController().render(readerView?.book?.toc), 1200);
  } catch (error) {
    console.error(`Failed to open ${sourceLabel}`, error);
  }
}

function readSourceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("src");
}

function setupCriticalInteractions() {
  pageLeftZone.addEventListener("click", () => {
    if (state.flow === "paginated") {
      void readerView?.goLeft?.();
      return;
    }

    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.nextSection?.() : readerView?.renderer?.prevSection?.());
  });

  pageRightZone.addEventListener("click", () => {
    if (state.flow === "paginated") {
      void readerView?.goRight?.();
      return;
    }

    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.prevSection?.() : readerView?.renderer?.nextSection?.());
  });

  window.addEventListener("resize", () => {
    if (readerView) applyReaderLayout(readerView, readerRoot);
    highlightController.close();
  });

  window.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Node && readerRoot.contains(event.target)) {
      event.preventDefault();
    }
  });
}

function getProgressFromPointer(event: PointerEvent) {
  const bounds = readingProgressTrack.getBoundingClientRect();
  if (bounds.width <= 0) return currentProgress;

  return Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
}

function setReadingProgress(progress: number) {
  currentProgress = Math.min(1, Math.max(0, progress));
  readingProgressFill.style.setProperty("--reader-progress", `${currentProgress * 100}%`);
  readingProgress.setAttribute("aria-valuenow", String(Math.round(currentProgress * 100)));
}

function updateReadingProgressLabel(label?: string) {
  const chapterLabel = label?.trim() ?? "";
  readingProgressLabel.textContent = chapterLabel;
  readingProgressLabel.hidden = !chapterLabel;
}

function previewReadingProgress(progress: number) {
  setReadingProgress(progress);
}

function seekReadingProgress(progress: number) {
  if (!readerView?.book) return;
  previewReadingProgress(progress);
  void readerView.goTo({ fraction: currentProgress }).catch((error) => {
    console.warn("Failed to seek reading progress.", error);
  });
}

function setupProgressInteractions() {
  readingProgress.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    readingProgress.classList.add("is-dragging");
    readingProgressFill.style.transitionDuration = "0ms";
    readingProgress.setPointerCapture(event.pointerId);
    previewReadingProgress(getProgressFromPointer(event));
  });

  readingProgress.addEventListener("pointermove", (event) => {
    if (!readingProgress.hasPointerCapture(event.pointerId)) return;
    previewReadingProgress(getProgressFromPointer(event));
  });

  const finishDrag = (event: PointerEvent) => {
    if (!readingProgress.hasPointerCapture(event.pointerId)) return;

    const progress = getProgressFromPointer(event);
    readingProgress.releasePointerCapture(event.pointerId);
    readingProgress.classList.remove("is-dragging");
    readingProgressFill.style.transitionDuration = "";
    seekReadingProgress(progress);
  };

  readingProgress.addEventListener("pointerup", finishDrag);
  readingProgress.addEventListener("pointercancel", finishDrag);

  readingProgress.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      seekReadingProgress(currentProgress - 0.01);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      seekReadingProgress(currentProgress + 0.01);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekReadingProgress(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekReadingProgress(1);
    }
  });
}

function setupExtraInteractions() {
  window.addEventListener(VIEWER_EVENTS.tocNavigate, (event) => {
    const { href } = (event as CustomEvent<TocNavigateDetail>).detail;
    if (!href) return;
    void readerView?.goTo(href);
    tocModal.close();
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
    highlightController.handleContextAction(action);
  });

  openTocButton.addEventListener("click", () => {
    tocModal.showModal();
    ensureTocController().resetViewState();
  });

  openSearchButton.addEventListener("click", () => {
    toggleSearch();
  });

  toggleFlowButton.addEventListener("click", () => {
    changeReaderFlow(readerView, readerRoot);
    updateFlowButton(toggleFlowButton);
    saveCurrentReaderSettings();
  });

  toggleThemeButton.addEventListener("click", () => {
    const currentIndex = READER_THEMES.findIndex((theme) => theme.id === state.readerTheme);
    const nextTheme = READER_THEMES[(currentIndex + 1) % READER_THEMES.length]!;
    applyReaderTheme(nextTheme.id, {
      toggleThemeButton,
      themeCount,
      setBookStyles: () => readerView?.renderer?.setStyles?.(getBookStyles()),
    });
    saveCurrentReaderSettings();
  });

  decreaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(-READER_FONT_SIZE_STEP, readerView);
    saveCurrentReaderSettings();
  });

  increaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(READER_FONT_SIZE_STEP, readerView);
    saveCurrentReaderSettings();
  });

  decreaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(-READER_MARGIN_STEP, readerView, readerRoot);
    changeReaderDensity(-READER_SPACING_STEP, readerView);
    saveCurrentReaderSettings();
  });

  increaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(READER_MARGIN_STEP, readerView, readerRoot);
    changeReaderDensity(READER_SPACING_STEP, readerView);
    saveCurrentReaderSettings();
  });

  exportButton.addEventListener("click", () => {
    void exportCurrentBook();
  });

}

function setupExtraUi() {
  if (extraUiReady) return;
  extraUiReady = true;

  createIcons({
    icons: {
      ChevronLeft,
      ChevronRight,
      BookOpen,
      Download,
      Highlighter,
      ListTree,
      Maximize2,
      Minimize2,
      Minus,
      Palette,
      Plus,
      Search,
      X,
    },
  });
  ensureKeybindings();
  ensureSearchController().updateButton();
  highlightController.bindContextTargets();
  setupExtraInteractions();
}

function scheduleExtraUiSetup() {
  runWhenIdle(setupExtraUi, 1000);
}

async function bootstrap() {
  applyReaderSettings(undefined);
  updateExportButton();
  setupCriticalInteractions();
  setupProgressInteractions();

  const src = readSourceFromQuery();
  if (src) {
    void openBook(src, src.split("/").pop() || src);
  } else {
    void preloadReaderFonts();
    scheduleExtraUiSetup();
  }
}

void bootstrap();
