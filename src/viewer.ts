import "foliate-js/view.js";
import { Overlayer } from "foliate-js/overlayer.js";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  createIcons,
  Download,
  Highlighter,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  Rows3,
  Search,
  Trash2,
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
import { createSearchController } from "./search-controller";
import { createTocController } from "./toc-controller";
import { elements } from "./viewer-elements";
import { setupViewerKeybindings } from "./viewer-keybindings";
import { state } from "./viewer-state";
import {
  getSavedPosition,
  getSavedHighlights,
  getSavedReaderSettings,
  saveHighlight,
  saveReaderSettings,
  saveReadingPosition,
  setSavedHighlights,
} from "./viewer-storage";
import type { FoliateViewElement, ReaderHighlight, ReaderSettings, ReadingPosition, RelocateDetail } from "./viewer-types";
import "./viewer.css";

let readerFontsReady: Promise<void> | null = null;
let readerModulesReady: Promise<unknown> | null = null;

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
  openHighlightsButton,
  exportButton,
  pageLeftZone,
  pageRightZone,
  readingProgress,
  readingProgressTrack,
  readingProgressFill,
  readingProgressLabel,
  searchForm,
  searchInput,
  searchNav,
  searchPrevButton,
  searchNextButton,
  searchCloseButton,
  searchCount,
  tocRoot,
  tocModal,
} = elements;

let readerView: FoliateViewElement | null = null;
let savePositionTimer: number | undefined;
let extraUiReady = false;
let currentProgress = 0;
let currentHighlights: ReaderHighlight[] = [];
const defaultHighlightColor = "#f4c430";
const highlightSelectionDocs = new WeakSet<Document>();
let highlightActionBar: HTMLElement | null = null;
let activeHighlight: ReaderHighlight | null = null;
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
let isHighlightSelectionMode = false;

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
    tocModal,
    getCurrentHref: () => state.currentHref,
    getReaderView: () => readerView,
  });
  return tocController;
}

function ensureSearchController() {
  searchController ??= createSearchController({
    openSearchButton,
    searchNav,
    searchInput,
    searchCount,
    searchPrevButton,
    searchNextButton,
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
  view.addEventListener("relocate", (event) => {
    const detail = (event as CustomEvent<RelocateDetail>).detail;

    state.currentHref = detail.tocItem?.href ?? "";
    updateTocCurrent();
    updatePageStatus(detail);
    queuePositionSave(detail);
    bindHighlightSelectionListeners();
  });

  view.addEventListener("create-overlay", (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail;
    for (const annotation of currentHighlights) {
      if (annotation.index === index) void view.addAnnotation?.(annotation);
    }
    bindHighlightSelectionListeners();
  });

  view.addEventListener("draw-annotation", (event) => {
    const { draw, annotation } = (event as CustomEvent<{
      draw: (func: typeof Overlayer.highlight, options: { color: string }) => void;
      annotation: ReaderHighlight;
    }>).detail;
    draw(Overlayer.highlight, { color: annotation.color });
  });

  view.addEventListener("show-annotation", (event) => {
    const detail = (event as CustomEvent<{
      value: string;
      index: number;
      range: Range;
    }>).detail;
    const highlight = currentHighlights.find((item) => item.value === detail.value);
    if (!highlight) return;
    showHighlightActions(highlight, detail.range);
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
  searchInput.placeholder = "Search text";
  searchNav.hidden = false;
  window.setTimeout(() => searchInput.focus(), 0);
}

function resetTransientBookState() {
  window.clearTimeout(savePositionTimer);
  clearSearchState();
  resetToc();
  hideHighlightActions();
  currentHighlights = [];
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

function getSelectedReaderRange(view: FoliateViewElement) {
  const contents = view.renderer?.getContents?.() ?? [];

  for (const { doc, index } of contents) {
    const selection = doc?.defaultView?.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) continue;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    if (text) return { index, range: range.cloneRange(), text };
  }

  return null;
}

async function restoreHighlights(view: FoliateViewElement, bookKey: string) {
  currentHighlights = await getSavedHighlights(bookKey);
  let shouldPersist = false;
  const sectionFractions = view.getSectionFractions?.() ?? [];

  currentHighlights = await Promise.all(
    currentHighlights.map(async (annotation) => {
      const restored = await view.addAnnotation?.(annotation);
      if (typeof annotation.fraction === "number") return annotation;

      const index = restored?.index ?? annotation.index;
      const fraction = typeof index === "number" ? sectionFractions[index] : undefined;
      if (typeof fraction !== "number") return annotation;

      shouldPersist = true;
      return { ...annotation, index, fraction };
    }),
  );
  if (shouldPersist) await setSavedHighlights(bookKey, currentHighlights);
}

function updateHighlightSelectionButton() {
  openHighlightsButton.classList.toggle("dock-active", isHighlightSelectionMode);
  openHighlightsButton.setAttribute("aria-pressed", isHighlightSelectionMode ? "true" : "false");
}

function bindHighlightSelectionListeners() {
  if (!isHighlightSelectionMode || !readerView) return;

  for (const { doc } of readerView.renderer?.getContents?.() ?? []) {
    if (!doc || highlightSelectionDocs.has(doc)) continue;

    highlightSelectionDocs.add(doc);
    const highlightSelection = () => {
      if (!isHighlightSelectionMode) return;
      window.setTimeout(() => void highlightSelectedText(), 0);
    };

    doc.addEventListener("mouseup", highlightSelection);
    doc.addEventListener("touchend", highlightSelection);
    doc.addEventListener("keyup", highlightSelection);
  }
}

function setHighlightSelectionMode(enabled: boolean) {
  isHighlightSelectionMode = enabled;
  updateHighlightSelectionButton();
  bindHighlightSelectionListeners();
}

function getHighlightActionPosition(range: Range) {
  const rangeBounds = range.getBoundingClientRect();
  const ownerDocument = range.startContainer.ownerDocument;
  const frame = ownerDocument?.defaultView?.frameElement;
  const frameBounds = frame?.getBoundingClientRect();
  if (rangeBounds && frameBounds) {
    return {
      x: frameBounds.left + rangeBounds.left + rangeBounds.width / 2,
      y: frameBounds.top + rangeBounds.bottom,
    };
  }

  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
}

function positionHighlightActions(x: number, y: number) {
  if (!highlightActionBar) return;

  const padding = 12;
  highlightActionBar.hidden = false;
  const bounds = highlightActionBar.getBoundingClientRect();
  const left = Math.min(window.innerWidth - bounds.width - padding, Math.max(padding, x - bounds.width / 2));
  const top = Math.min(window.innerHeight - bounds.height - padding, Math.max(padding, y + 8));

  highlightActionBar.style.left = `${left}px`;
  highlightActionBar.style.top = `${top}px`;
}

function hideHighlightActions() {
  activeHighlight = null;
  if (highlightActionBar) highlightActionBar.hidden = true;
}

async function copyHighlight(highlight: ReaderHighlight) {
  const text = highlight.text?.trim() || highlight.value;
  await navigator.clipboard.writeText(text);
  hideHighlightActions();
}

async function deleteHighlight(highlight: ReaderHighlight) {
  if (!readerView || !state.currentBookKey) return;

  await readerView.deleteAnnotation?.(highlight);
  currentHighlights = currentHighlights.filter((item) => item.value !== highlight.value);
  await setSavedHighlights(state.currentBookKey, currentHighlights);
  hideHighlightActions();
}

function showHighlightActions(highlight: ReaderHighlight, range: Range) {
  activeHighlight = highlight;
  ensureHighlightActionBar();

  const { x, y } = getHighlightActionPosition(range);
  positionHighlightActions(x, y);
}

function createHighlightActionButton(label: string, icon: string, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-circle btn-sm tooltip tooltip-bottom tooltip-neutral";
  button.dataset.tip = label;
  button.setAttribute("aria-label", label);

  const item = document.createElement("i");
  item.dataset.lucide = icon;
  button.append(item);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function ensureHighlightActionBar() {
  if (highlightActionBar) return highlightActionBar;

  highlightActionBar = document.createElement("div");
  highlightActionBar.className = "highlight-action-popover";
  highlightActionBar.hidden = true;

  highlightActionBar.append(
    createHighlightActionButton("Copy", "copy", () => {
      if (activeHighlight) void copyHighlight(activeHighlight);
    }),
    createHighlightActionButton("Delete", "trash-2", () => {
      if (activeHighlight) void deleteHighlight(activeHighlight);
    }),
    createHighlightActionButton("Cancel", "x", hideHighlightActions),
  );

  document.body.append(highlightActionBar);
  createIcons({ icons: { Copy, Trash2, X } });
  return highlightActionBar;
}

function scheduleHighlightsRestore(view: FoliateViewElement, bookKey: string) {
  runWhenIdle(() => {
    if (readerView !== view || state.currentBookKey !== bookKey) return;
    void restoreHighlights(view, bookKey).catch((error) => {
      console.warn("Failed to restore highlights.", error);
    });
  }, 800);
}

async function highlightSelectedText() {
  if (!readerView || !state.currentBookKey) return;

  const selection = getSelectedReaderRange(readerView);
  const value = selection && readerView.getCFI?.(selection.index, selection.range);
  if (!selection || !value) return;
  const existing = currentHighlights.find((item) => item.value === value);
  if (existing) {
    readerView.deselect?.();
    hideHighlightActions();
    return existing;
  }

  const annotation: ReaderHighlight = {
    value,
    color: defaultHighlightColor,
    text: selection.text,
    index: selection.index,
    fraction: currentProgress,
    createdAt: Date.now(),
  };

  currentHighlights = [...currentHighlights, annotation];
  await readerView.addAnnotation?.(annotation);
  await saveHighlight(state.currentBookKey, annotation);
  readerView.deselect?.();
  hideHighlightActions();
  return annotation;
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
    void preloadReaderFonts();
    await preloadReaderModules();
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
    if (state.currentBookKey) scheduleHighlightsRestore(readerView, state.currentBookKey);
    bindHighlightSelectionListeners();
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
    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.nextSection?.() : readerView?.renderer?.prevSection?.());
  });

  pageRightZone.addEventListener("click", () => {
    const isRtl = readerView?.book?.dir === "rtl";
    void (isRtl ? readerView?.renderer?.prevSection?.() : readerView?.renderer?.nextSection?.());
  });

  window.addEventListener("resize", () => {
    if (readerView) applyReaderLayout(readerView, readerRoot);
    hideHighlightActions();
  });

  window.addEventListener("pointerdown", (event) => {
    if (!highlightActionBar || highlightActionBar.hidden) return;
    if (event.target instanceof Node && highlightActionBar.contains(event.target)) return;
    hideHighlightActions();
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
  openTocButton.addEventListener("click", () => {
    tocModal.showModal();
    ensureTocController().resetViewState();
  });

  openHighlightsButton.addEventListener("click", () => {
    setHighlightSelectionMode(!isHighlightSelectionMode);
  });

  openSearchButton.addEventListener("click", () => {
    openSearch();
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

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void ensureSearchController().collect(searchInput.value);
  });

  searchPrevButton.addEventListener("click", () => {
    void ensureSearchController().showPrevious();
  });

  searchNextButton.addEventListener("click", () => {
    void ensureSearchController().showNext();
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
      Copy,
      Download,
      Highlighter,
      ListTree,
      Maximize2,
      Minimize2,
      Minus,
      Palette,
      Plus,
      Rows3,
      Search,
      Trash2,
      X,
    },
  });
  ensureKeybindings();
  ensureSearchController().updateButton();
  updateHighlightSelectionButton();
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
    void preloadReaderModules();
    scheduleExtraUiSetup();
  }
}

void bootstrap();
