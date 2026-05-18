import "foliate-js/view.js";
import {
  ChevronLeft,
  ChevronRight,
  createIcons,
  Download,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  Rows3,
  Search,
  X,
} from "lucide";
import {
  applyBookRenderingPreferences,
  applyReaderFontSize,
  applyReaderLayout,
  applyReaderMargin,
  applyReaderSpacing,
  applyReaderTheme,
  changeReaderDensity,
  changeReaderFontSize,
  changeReaderWidth,
  getBookStyles,
  loadReaderFontSize,
  loadReaderMargin,
  loadReaderSpacing,
  loadReaderTheme,
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
import { createSearchController } from "./search-controller";
import { createTocController } from "./toc-controller";
import { state } from "./viewer-state";
import { getSavedPosition, saveReaderTheme, saveReadingPosition } from "./viewer-storage";
import type { FoliateViewElement, ReadingPosition, RelocateDetail } from "./viewer-types";
import "./viewer.css";

let readerFontsReady: Promise<void> | null = null;
let readerModulesReady: Promise<unknown> | null = null;

const readerRoot = must<HTMLDivElement>("#reader-root");
const toggleFlowButton = must<HTMLButtonElement>("#toggle-flow-button");
const toggleThemeButton = must<HTMLButtonElement>("#toggle-theme-button");
const themeCount = must<HTMLElement>("#theme-count");
const decreaseFontButton = must<HTMLButtonElement>("#decrease-font-button");
const increaseFontButton = must<HTMLButtonElement>("#increase-font-button");
const decreaseWidthButton = must<HTMLButtonElement>("#decrease-width-button");
const increaseWidthButton = must<HTMLButtonElement>("#increase-width-button");
const openSearchButton = must<HTMLButtonElement>("#open-search-button");
const openTocButton = must<HTMLButtonElement>("#open-toc-button");
const exportButton = must<HTMLButtonElement>("#export-button");
const pageLeftZone = must<HTMLButtonElement>("#page-left-zone");
const pageRightZone = must<HTMLButtonElement>("#page-right-zone");
const readingProgressFill = must<HTMLElement>("#reading-progress-fill");
const searchForm = must<HTMLFormElement>("#search-form");
const searchInput = must<HTMLInputElement>("#search-input");
const searchNav = must<HTMLElement>("#search-nav");
const searchPrevButton = must<HTMLButtonElement>("#search-prev-button");
const searchNextButton = must<HTMLButtonElement>("#search-next-button");
const searchCloseButton = must<HTMLButtonElement>("#search-close-button");
const searchCount = must<HTMLElement>("#search-count");
const tocRoot = must<HTMLElement>("#toc-root");
const tocModal = must<HTMLDialogElement>("#toc-modal");

let readerView: FoliateViewElement | null = null;
let savePositionTimer: number | undefined;
let extraUiReady = false;

const tocController = createTocController({
  tocRoot,
  tocModal,
  getCurrentHref: () => state.currentHref,
  getReaderView: () => readerView,
});
const searchController = createSearchController({
  openSearchButton,
  searchNav,
  searchInput,
  searchCount,
  searchPrevButton,
  searchNextButton,
  getReaderView: () => readerView,
});

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return node;
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

function preloadReaderModules() {
  readerModulesReady ??= import("foliate-js/paginator.js").catch((error) => {
    console.warn("Failed to preload reader renderer.", error);
  });
  return readerModulesReady;
}

function runWhenIdle(callback: () => void, timeout = 500) {
  const requestIdle = globalThis.requestIdleCallback;
  if (requestIdle) {
    requestIdle(callback, { timeout });
    return;
  }
  globalThis.setTimeout(callback, 0);
}

function updatePageStatus(detail: RelocateDetail) {
  const progress = typeof detail.fraction === "number" ? detail.fraction : 0;
  readingProgressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
}

function updateTocCurrent() {
  tocController.updateCurrent();
}

function resetToc() {
  tocController.reset();
}

function queuePositionSave(detail: RelocateDetail) {
  if (!state.currentBookKey || state.isRestoring) return;

  window.clearTimeout(savePositionTimer);
  savePositionTimer = window.setTimeout(() => {
    void saveReadingPosition(state.currentBookKey, detail);
  }, 350);
}

function wireReaderEvents(view: FoliateViewElement) {
  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;

    state.currentHref = detail.tocItem?.href ?? "";
    updateTocCurrent();
    updatePageStatus(detail);
    queuePositionSave(detail);
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

function updateExportButton() {
  const hasSource = Boolean(state.currentSourceUrl);
  exportButton.disabled = !hasSource;
  exportButton.setAttribute("aria-disabled", hasSource ? "false" : "true");
}

function updateSearchButton() {
  searchController.updateButton();
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
  searchController.clear();
}

function resetTransientBookState() {
  window.clearTimeout(savePositionTimer);
  clearSearchState();
  resetToc();
}

function createView() {
  const view = document.createElement("foliate-view") as FoliateViewElement;
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
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

  if (!readerView) {
    readerView = createView();
  }

  try {
    state.currentBookKey = fileUrl ?? "";
    state.currentSourceUrl = fileUrl ?? "";
    updateExportButton();
    resetTransientBookState();
    if (readerView.book) readerView.close();
    await Promise.all([preloadReaderFonts(), preloadReaderModules()]);
    await readerView.open(input);
    updateSearchButton();

    const metadata = readerView.book?.metadata;
    const title = formatLocalized(metadata?.title) || "Untitled Book";

    document.title = `${title} · EPUB Viewer`;
    applyBookRenderingPreferences(readerView, readerRoot);
    await restoreSavedPosition(
      readerView,
      state.currentBookKey ? await getSavedPosition(state.currentBookKey) : undefined,
    );
    scheduleExtraUiSetup();
    runWhenIdle(() => tocController.render(readerView?.book?.toc), 1200);
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
    readerView?.goLeft();
  });

  pageRightZone.addEventListener("click", () => {
    readerView?.goRight();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      readerView?.goLeft();
    } else if (event.key === "ArrowRight") {
      readerView?.goRight();
    }
  });

  window.addEventListener("resize", () => {
    if (readerView) applyReaderLayout(readerView, readerRoot);
  });
}

function setupExtraInteractions() {
  openTocButton.addEventListener("click", () => {
    tocModal.showModal();
  });

  openSearchButton.addEventListener("click", () => {
    searchInput.placeholder = "Search text";
    searchNav.hidden = false;
    window.setTimeout(() => searchInput.focus(), 0);
  });

  toggleFlowButton.addEventListener("click", () => {
    state.flow = state.flow === "paginated" ? "scrolled" : "paginated";
    updateFlowButton(toggleFlowButton);
    if (readerView) applyReaderLayout(readerView, readerRoot);
  });

  toggleThemeButton.addEventListener("click", () => {
    const currentIndex = READER_THEMES.findIndex((theme) => theme.id === state.readerTheme);
    const nextTheme = READER_THEMES[(currentIndex + 1) % READER_THEMES.length]!;
    applyReaderTheme(nextTheme.id, {
      toggleThemeButton,
      themeCount,
      setBookStyles: () => readerView?.renderer?.setStyles?.(getBookStyles()),
    });
    void saveReaderTheme(nextTheme.id);
  });

  decreaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(-READER_FONT_SIZE_STEP, readerView);
  });

  increaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(READER_FONT_SIZE_STEP, readerView);
  });

  decreaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(-READER_MARGIN_STEP, readerView, readerRoot);
    changeReaderDensity(-READER_SPACING_STEP, readerView);
  });

  increaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(READER_MARGIN_STEP, readerView, readerRoot);
    changeReaderDensity(READER_SPACING_STEP, readerView);
  });

  exportButton.addEventListener("click", () => {
    void exportCurrentBook();
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void searchController.collect(searchInput.value);
  });

  searchPrevButton.addEventListener("click", () => {
    void searchController.showPrevious();
  });

  searchNextButton.addEventListener("click", () => {
    void searchController.showNext();
  });

  searchCloseButton.addEventListener("click", () => {
    clearSearchState();
  });
}

function setupExtraUi() {
  if (extraUiReady) return;
  extraUiReady = true;

  createIcons({
    icons: {
      ChevronLeft,
      ChevronRight,
      Download,
      ListTree,
      Maximize2,
      Minimize2,
      Minus,
      Palette,
      Plus,
      Rows3,
      Search,
      X,
    },
  });
  setupExtraInteractions();
}

function scheduleExtraUiSetup() {
  runWhenIdle(setupExtraUi, 1000);
}

async function bootstrap() {
  const preloadReady = Promise.all([preloadReaderFonts(), preloadReaderModules()]);
  const [readerSpacing, readerMargin, readerFontSize, readerTheme] = await Promise.all([
    loadReaderSpacing(),
    loadReaderMargin(),
    loadReaderFontSize(),
    loadReaderTheme(),
  ]);

  applyReaderSpacing(readerSpacing, readerView);
  applyReaderMargin(readerMargin, readerView, readerRoot);
  applyReaderFontSize(readerFontSize, readerView);
  applyReaderTheme(readerTheme, {
    toggleThemeButton,
    themeCount,
    setBookStyles: () => readerView?.renderer?.setStyles?.(getBookStyles()),
  });
  updateSearchButton();
  updateExportButton();
  updateFlowButton(toggleFlowButton);
  setupCriticalInteractions();

  const src = readSourceFromQuery();
  if (src) {
    await preloadReady;
    void openBook(src, src.split("/").pop() || src);
  } else {
    scheduleExtraUiSetup();
  }
}

void bootstrap();
