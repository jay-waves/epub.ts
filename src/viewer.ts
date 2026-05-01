import "foliate-js/view.js";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  createIcons,
  Download,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  Rows3,
  Search,
  X,
} from "lucide";
import "./viewer.css";

type TocItem = {
  label?: string;
  href?: string;
  subitems?: TocItem[];
};

type BookMetadata = {
  title?: string | Record<string, string>;
  author?: string | { name?: string | Record<string, string> } | Array<string | { name?: string | Record<string, string> }>;
};

type FoliateBook = {
  metadata?: BookMetadata;
  sections?: unknown[];
  toc?: TocItem[];
};

type FoliateRenderer = HTMLElement & {
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  setStyles?: (cssText: string) => void;
};

type FoliateViewElement = HTMLElement & {
  book?: FoliateBook;
  renderer: FoliateRenderer;
  clearSearch?: () => void;
  open: (input: File | string) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  goTo: (target: string | number | { fraction: number }) => Promise<void>;
  search?: (options: {
    index?: number;
    matchCase?: boolean;
    matchDiacritics?: boolean;
    query: string;
  }) => AsyncIterable<unknown>;
  select?: (target: string) => Promise<void>;
};

const state = {
  flow: "paginated" as "paginated" | "scrolled",
  currentHref: "",
  currentBookKey: "",
  currentSourceUrl: "",
  readerMargin: 8,
  isRestoring: false,
  readerFontSize: 19,
  readerSpacing: 0,
  readerTheme: "light" as ReaderThemeId,
};

type ReaderThemeMode = "light" | "dark";

type ReaderThemeId = "light" | "grey" | "solar" | "dark" | "one-dark";

type ReaderTheme = {
  id: ReaderThemeId;
  label: string;
  bodyTheme: string;
  mode: ReaderThemeMode;
  background: string;
  foreground: string;
  link: string;
};

type ReadingPosition = {
  cfi?: string;
  fraction?: number;
  updatedAt: number;
};

type ReadingHistory = Record<string, ReadingPosition>;

type RelocateDetail = {
  cfi?: string;
  fraction?: number;
  location?: {
    current?: number;
    total?: number;
  };
  pageItem?: {
    label?: string;
  };
  tocItem?: TocItem;
};

type SearchHit = {
  cfi: string;
  excerpt?: string;
};

const HISTORY_STORAGE_KEY = "reading-history";
const FONT_SIZE_STORAGE_KEY = "reader-font-size";
const MARGIN_STORAGE_KEY = "reader-margin";
const SPACING_STORAGE_KEY = "reader-spacing";
const THEME_STORAGE_KEY = "reader-theme";
const READER_FONT_FAMILY = "LXGW WenKai EPUB";
const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
const READER_SERIF_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif`;
const READER_SANS_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
const READER_MONO_STACK =
  `"${READER_MONO_FONT_FAMILY}", "Sarasa Mono SC", "Maple Mono SC NF", "Cascadia Code", "SFMono-Regular", Consolas, monospace`;
const READER_FONT_URL = chrome.runtime.getURL("LXGWWenKai-Regular.ttf");
const READER_MONO_FONT_URL = chrome.runtime.getURL("Monaspace Argon Var.ttf");
const MIN_READER_FONT_SIZE = 14;
const MAX_READER_FONT_SIZE = 32;
const READER_FONT_SIZE_STEP = 1;
const MIN_READER_MARGIN = 0;
const MAX_READER_MARGIN = 72;
const READER_MARGIN_STEP = 8;
const MIN_READER_SPACING = -4;
const MAX_READER_SPACING = 6;
const READER_SPACING_STEP = 1;
const LONG_SEARCH_QUERY_THRESHOLD = 24;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_SEARCH_RESULTS = 200;
const PAGINATED_GAP = "2.5%";
const PAGINATED_SINGLE_COLUMN_MAX_INLINE_SIZE = 1280;
const PAGINATED_MULTI_COLUMN_MAX_INLINE_SIZE = 960;
const PAGINATED_TWO_COLUMN_MIN_WIDTH = 1500;
const PAGINATED_THREE_COLUMN_MIN_WIDTH = 2000;
const READER_THEMES: ReaderTheme[] = [
  {
    id: "light",
    label: "Light",
    bodyTheme: "lofi",
    mode: "light",
    background: "#fffefd",
    foreground: "#1f2933",
    link: "#1f5f8f",
  },
  {
    id: "grey",
    label: "Grey",
    bodyTheme: "corporate",
    mode: "light",
    background: "#f1f1ee",
    foreground: "#2f3438",
    link: "#4c6a7f",
  },
  {
    id: "solar",
    label: "Solar",
    bodyTheme: "cupcake",
    mode: "light",
    background: "#fdf6e3",
    foreground: "#4b3f2f",
    link: "#9c6a1c",
  },
  {
    id: "dark",
    label: "Dark",
    bodyTheme: "nord",
    mode: "dark",
    background: "#212830",
    foreground: "#e5e9f0",
    link: "#88c0d0",
  },
  {
    id: "one-dark",
    label: "One Dark",
    bodyTheme: "dim",
    mode: "dark",
    background: "#0f1117",
    foreground: "#d7dae0",
    link: "#61afef",
  },
];

const readerRoot = must<HTMLDivElement>("#reader-root");
const toggleFlowButton = must<HTMLButtonElement>("#toggle-flow-button");
const toggleThemeButton = must<HTMLButtonElement>("#toggle-theme-button");
const themeCount = must<HTMLElement>("#theme-count");
const decreaseFontButton = must<HTMLButtonElement>("#decrease-font-button");
const increaseFontButton = must<HTMLButtonElement>("#increase-font-button");
const decreaseWidthButton = must<HTMLButtonElement>("#decrease-width-button");
const increaseWidthButton = must<HTMLButtonElement>("#increase-width-button");
const openSearchButton = must<HTMLButtonElement>("#open-search-button");
const exportButton = must<HTMLButtonElement>("#export-button");
const pageLeftZone = must<HTMLButtonElement>("#page-left-zone");
const pageRightZone = must<HTMLButtonElement>("#page-right-zone");
const pageStatusButton = must<HTMLButtonElement>("#page-status-button");
const pageStatusText = must<HTMLElement>("#page-status-text");
const searchForm = must<HTMLFormElement>("#search-form");
const searchInput = must<HTMLInputElement>("#search-input");
const searchModal = must<HTMLDialogElement>("#search-modal");
const searchNav = must<HTMLElement>("#search-nav");
const searchPrevButton = must<HTMLButtonElement>("#search-prev-button");
const searchNextButton = must<HTMLButtonElement>("#search-next-button");
const searchCloseButton = must<HTMLButtonElement>("#search-close-button");
const searchCount = must<HTMLElement>("#search-count");
const tocRoot = must<HTMLElement>("#toc-root");
const tocModal = must<HTMLDialogElement>("#toc-modal");

let readerView: FoliateViewElement | null = null;
let savePositionTimer: number | undefined;
let searchRunId = 0;
let searchHits: SearchHit[] = [];
let searchHitIndex = -1;

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

function getTheme(themeId = state.readerTheme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

function getBookStyles(themeId = state.readerTheme) {
  const theme = getTheme(themeId);
  const { background, foreground, link } = theme;
  const lineHeight = (1.72 + state.readerSpacing * 0.08).toFixed(2);
  const wordSpacing = `${(state.readerSpacing * 0.04).toFixed(2)}em`;
  const mediaFilter =
    theme.mode === "dark" ? "brightness(0.72) contrast(0.92) saturate(0.88)" : "none";

  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    @font-face {
      font-family: "${READER_FONT_FAMILY}";
      src: url("${READER_FONT_URL}") format("truetype");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "${READER_MONO_FONT_FAMILY}";
      src: url("${READER_MONO_FONT_URL}") format("truetype");
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    html {
      --theme-bg-color: ${background} !important;
      --reader-font-serif: ${READER_SERIF_STACK};
      --reader-font-sans: ${READER_SANS_STACK};
      --reader-font-mono: ${READER_MONO_STACK};
      color-scheme: ${theme.mode};
      font-size: ${state.readerFontSize}px !important;
      background: ${background} !important;
      color: ${foreground} !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    body {
      background: ${background} !important;
      color: ${foreground} !important;
      font-family: var(--reader-font-serif) !important;
      letter-spacing: 0 !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    body, body * {
      color: ${foreground};
    }
    body *:not(svg):not(svg *):not(code):not(pre):not(kbd):not(samp):not(input):not(textarea):not(select):not(button) {
      font-family: var(--reader-font-serif) !important;
    }
    code, pre, kbd, samp, textarea {
      font-family: var(--reader-font-mono) !important;
    }
    input, textarea, select, button {
      font-family: var(--reader-font-sans) !important;
    }
    body *:not(img):not(svg):not(video):not(audio):not(canvas):not(iframe) {
      background: transparent !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      box-sizing: border-box !important;
    }
    section, article, main, div, p, li, ul, ol, dl, blockquote,
    h1, h2, h3, h4, h5, h6, table, thead, tbody, tfoot, tr, td, th {
      max-inline-size: none !important;
      max-width: none !important;
      width: auto !important;
    }
    h1, h2, h3, h4, h5, h6,
    [role="heading"],
    [epub|type~="title"],
    [epub|type~="subtitle"],
    [class*="title"],
    [class*="heading"],
    [class*="chapter"],
    h1 *, h2 *, h3 *, h4 *, h5 *, h6 *,
    [role="heading"] *,
    [epub|type~="title"] *,
    [epub|type~="subtitle"] *,
    [class*="title"] *,
    [class*="heading"] *,
    [class*="chapter"] * {
      font-family: var(--reader-font-serif) !important;
      font-weight: 700 !important;
      font-style: normal !important;
      color: ${foreground} !important;
      letter-spacing: 0 !important;
      font-variation-settings: "wght" 700 !important;
      font-synthesis: weight !important;
      -webkit-text-fill-color: ${foreground} !important;
      -webkit-text-stroke: 0 transparent !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    p, li, blockquote, dd {
      line-height: ${lineHeight} !important;
      text-align: justify;
      hyphens: auto !important;
      hanging-punctuation: allow-end last;
      word-spacing: ${wordSpacing} !important;
    }
    figcaption, caption, small,
    [epub|type~="caption"],
    [epub|type~="subtitle"],
    [epub|type~="credit"],
    [class*="caption"],
    [class*="figcaption"],
    [class*="legend"],
    [class*="note"],
    [class*="annotation"] {
      font-family: var(--reader-font-serif) !important;
      color: ${foreground} !important;
      -webkit-text-fill-color: ${foreground} !important;
      font-size: 0.88em !important;
      line-height: 1.5 !important;
      word-spacing: 0 !important;
      opacity: 0.9 !important;
    }
    nav, header, footer, aside, .sans, [class*="sans"] {
      font-family: var(--reader-font-sans) !important;
    }
    ul, ol, dl, blockquote {
      margin-inline: 0 !important;
    }
    img, svg, video {
      max-inline-size: 100% !important;
      block-size: auto !important;
      filter: ${mediaFilter} !important;
    }
    a {
      color: ${link} !important;
    }
    pre {
      white-space: pre-wrap !important;
    }
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] {
      display: none;
    }
  `;
}

function applyReaderTheme(themeId: ReaderThemeId) {
  const theme = getTheme(themeId);
  const themeIndex = READER_THEMES.findIndex((item) => item.id === theme.id);
  const scrollbarThumb =
    theme.mode === "dark" ? "rgba(191, 205, 219, 0.28)" : "rgba(82, 94, 110, 0.35)";
  const scrollbarTrack =
    theme.mode === "dark" ? "rgba(22, 29, 37, 0.45)" : "rgba(255, 255, 255, 0.18)";

  state.readerTheme = theme.id;
  document.body.dataset.theme = theme.bodyTheme;
  document.documentElement.dataset.readerTheme = theme.id;
  document.documentElement.dataset.readerMode = theme.mode;
  document.documentElement.style.setProperty("--reader-chrome-bg", theme.background);
  document.documentElement.style.setProperty("--reader-chrome-fg", theme.foreground);
  document.documentElement.style.setProperty("--reader-color-scheme", theme.mode);
  document.documentElement.style.setProperty("--reader-scrollbar-thumb", scrollbarThumb);
  document.documentElement.style.setProperty("--reader-scrollbar-track", scrollbarTrack);
  toggleThemeButton.classList.toggle("dock-active", theme.mode === "dark");
  toggleThemeButton.setAttribute("title", `主题：${theme.label}`);
  toggleThemeButton.setAttribute("aria-label", `切换主题，当前 ${theme.label}`);
  themeCount.textContent = String(themeIndex + 1);
  readerView?.renderer?.setStyles?.(getBookStyles());
}

async function loadReaderTheme() {
  const saved = await getStorage<ReaderThemeId>(THEME_STORAGE_KEY, "light");
  return getTheme(saved).id;
}

async function loadReaderFontSize() {
  const saved = await getStorage<number>(FONT_SIZE_STORAGE_KEY, state.readerFontSize);
  return clampReaderFontSize(saved);
}

async function loadReaderSpacing() {
  const saved = await getStorage<number>(SPACING_STORAGE_KEY, state.readerSpacing);
  return clampReaderSpacing(saved);
}

async function loadReaderMargin() {
  const saved = await getStorage<number>(MARGIN_STORAGE_KEY, state.readerMargin);
  return clampReaderMargin(saved);
}

async function saveReaderTheme(theme: ReaderThemeId) {
  await setStorage(THEME_STORAGE_KEY, theme);
}

async function saveReaderFontSize(fontSize: number) {
  await setStorage(FONT_SIZE_STORAGE_KEY, fontSize);
}

async function saveReaderMargin(margin: number) {
  await setStorage(MARGIN_STORAGE_KEY, margin);
}

async function saveReaderSpacing(spacing: number) {
  await setStorage(SPACING_STORAGE_KEY, spacing);
}

function applyReaderLayout(view: FoliateViewElement) {
  const readerWidth = readerRoot.getBoundingClientRect().width;
  const allowMultipleColumns =
    state.flow === "paginated" && readerWidth >= PAGINATED_TWO_COLUMN_MIN_WIDTH;
  const allowThreeColumns =
    state.flow === "paginated" && readerWidth >= PAGINATED_THREE_COLUMN_MIN_WIDTH;
  const maxInlineSize = allowMultipleColumns
    ? PAGINATED_MULTI_COLUMN_MAX_INLINE_SIZE
    : PAGINATED_SINGLE_COLUMN_MAX_INLINE_SIZE;

  view.renderer?.setAttribute("flow", state.flow);
  view.renderer?.setAttribute("gap", state.flow === "paginated" ? PAGINATED_GAP : "1.5%");
  view.renderer?.setAttribute("margin", `${state.readerMargin}px`);
  if (state.flow === "paginated") {
    view.renderer?.setAttribute("max-inline-size", `${maxInlineSize}px`);
    view.renderer?.setAttribute("max-column-count", allowThreeColumns ? "3" : "2");
    return;
  }

  view.renderer?.setAttribute("max-inline-size", `${PAGINATED_SINGLE_COLUMN_MAX_INLINE_SIZE}px`);
  view.renderer?.removeAttribute("max-column-count");
}

function clampReaderFontSize(fontSize: number) {
  return Math.min(MAX_READER_FONT_SIZE, Math.max(MIN_READER_FONT_SIZE, Math.round(fontSize)));
}

function clampReaderMargin(margin: number) {
  return Math.min(MAX_READER_MARGIN, Math.max(MIN_READER_MARGIN, Math.round(margin)));
}

function clampReaderSpacing(spacing: number) {
  return Math.min(MAX_READER_SPACING, Math.max(MIN_READER_SPACING, Math.round(spacing)));
}

function applyReaderFontSize(fontSize: number) {
  state.readerFontSize = clampReaderFontSize(fontSize);
  readerView?.renderer?.setStyles?.(getBookStyles());
}

function applyReaderSpacing(spacing: number) {
  state.readerSpacing = clampReaderSpacing(spacing);
  readerView?.renderer?.setStyles?.(getBookStyles());
}

function applyReaderMargin(margin: number) {
  state.readerMargin = clampReaderMargin(margin);
  if (readerView) applyReaderLayout(readerView);
}

function changeReaderFontSize(delta: number) {
  const nextSize = clampReaderFontSize(state.readerFontSize + delta);
  if (nextSize === state.readerFontSize) return;
  applyReaderFontSize(nextSize);
  void saveReaderFontSize(nextSize);
}

function changeReaderWidth(delta: number) {
  const nextMargin = clampReaderMargin(state.readerMargin - delta);
  if (nextMargin === state.readerMargin) return;
  applyReaderMargin(nextMargin);
  void saveReaderMargin(nextMargin);
}

function changeReaderDensity(delta: number) {
  const nextSpacing = clampReaderSpacing(state.readerSpacing + delta);
  if (nextSpacing === state.readerSpacing) return;
  applyReaderSpacing(nextSpacing);
  void saveReaderSpacing(nextSpacing);
}

function formatPageStatus(detail: RelocateDetail) {
  const progress =
    typeof detail.fraction === "number" ? `${Math.round(detail.fraction * 100)}%` : "--";
  const sectionTitle = detail.tocItem?.label?.trim();
  return sectionTitle ? `${progress} · ${sectionTitle}` : progress;
}

function updatePageStatus(detail: RelocateDetail) {
  pageStatusText.textContent = formatPageStatus(detail);
  pageStatusButton.setAttribute(
    "aria-label",
    detail.tocItem?.label?.trim() ? `打开目录，当前章节 ${detail.tocItem.label.trim()}` : "打开目录",
  );
}

function updateFlowButton() {
  const isPaginated = state.flow === "paginated";
  toggleFlowButton.classList.toggle("dock-active", !isPaginated);
  toggleFlowButton.setAttribute(
    "title",
    isPaginated ? "切换到滚动模式" : "切换到翻页模式",
  );
  toggleFlowButton.setAttribute(
    "aria-label",
    isPaginated ? "切换到滚动模式" : "切换到翻页模式",
  );
}

function updateTocCurrent() {
  for (const button of tocRoot.querySelectorAll<HTMLButtonElement>(".toc-link")) {
    const isCurrent = button.dataset.href === state.currentHref;
    button.setAttribute("aria-current", isCurrent ? "true" : "false");
    button.classList.toggle("btn-primary", isCurrent);
    button.classList.toggle("btn-ghost", !isCurrent);
  }
}

function getStorage<T>(key: string, fallback: T) {
  return new Promise<T>((resolve) => {
    chrome.storage.local.get(key, (items) => {
      resolve((items[key] as T | undefined) ?? fallback);
    });
  });
}

function setStorage<T>(key: string, value: T) {
  return new Promise<void>((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

async function getReadingHistory() {
  return getStorage<ReadingHistory>(HISTORY_STORAGE_KEY, {});
}

async function getSavedPosition(bookKey: string) {
  const history = await getReadingHistory();
  return history[bookKey];
}

async function saveReadingPosition(bookKey: string, detail: RelocateDetail) {
  if (!detail.cfi && typeof detail.fraction !== "number") return;

  const history = await getReadingHistory();
  history[bookKey] = {
    cfi: detail.cfi,
    fraction: detail.fraction,
    updatedAt: Date.now(),
  };
  await setStorage(HISTORY_STORAGE_KEY, history);
}

function queuePositionSave(detail: RelocateDetail) {
  if (!state.currentBookKey || state.isRestoring) return;

  window.clearTimeout(savePositionTimer);
  savePositionTimer = window.setTimeout(() => {
    void saveReadingPosition(state.currentBookKey, detail);
  }, 350);
}

function renderToc(items?: TocItem[]) {
  tocRoot.replaceChildren();

  if (!items?.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "这本书没有可用目录。";
    tocRoot.append(empty);
    return;
  }

  tocRoot.append(buildTocList(items));
  updateTocCurrent();
}

function buildTocList(items: TocItem[]) {
  const list = document.createElement("ol");
  list.className = "toc-list";

  for (const item of items) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost toc-link";
    button.textContent = item.label?.trim() || "未命名章节";

    if (item.href) {
      button.dataset.href = item.href;
      button.addEventListener("click", () => {
        void readerView?.goTo(item.href!);
        tocModal.close();
      });
    } else {
      button.disabled = true;
    }

    listItem.append(button);

    if (item.subitems?.length) {
      const childWrap = document.createElement("div");
      childWrap.className = "toc-children";
      childWrap.append(buildTocList(item.subitems));
      listItem.append(childWrap);
    }

    list.append(listItem);
  }

  return list;
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
  const canSearch = Boolean(readerView?.search);
  openSearchButton.disabled = !canSearch;
  openSearchButton.setAttribute("aria-disabled", canSearch ? "false" : "true");
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

function clearSearchHighlights() {
  readerView?.clearSearch?.();
}

function updateSearchNav() {
  const hasHits = searchHits.length > 0;
  searchNav.hidden = !hasHits;
  searchCount.textContent = hasHits ? `${searchHitIndex + 1} / ${searchHits.length}` : "0 / 0";
  searchPrevButton.disabled = !hasHits;
  searchNextButton.disabled = !hasHits;
}

async function showSearchHit(index: number) {
  if (!readerView || !searchHits.length) return;

  searchHitIndex = (index + searchHits.length) % searchHits.length;
  updateSearchNav();

  const hit = searchHits[searchHitIndex];
  if (!hit) return;

  try {
    await (readerView.select?.(hit.cfi) ?? readerView.goTo(hit.cfi));
  } catch (error) {
    console.warn("Failed to navigate to search hit.", error);
  }
}

function clearSearchState() {
  ++searchRunId;
  searchHits = [];
  searchHitIndex = -1;
  searchInput.value = "";
  searchNav.hidden = true;
  clearSearchHighlights();
}

function getSearchOptions(query: string) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const queryPrefix = normalizedQuery.slice(0, MAX_SEARCH_QUERY_LENGTH).trim();
  const useFastExactSearch = queryPrefix.length >= LONG_SEARCH_QUERY_THRESHOLD;

  return {
    matchCase: false,
    // `matchDiacritics: true` keeps matching case-insensitive but pushes foliate
    // onto its much faster substring path for long grapheme searches.
    matchDiacritics: useFastExactSearch,
    query: queryPrefix,
  };
}

async function collectSearchHits(query: string) {
  if (!readerView?.search) return;

  const searchOptions = getSearchOptions(query);
  clearSearchHighlights();
  searchHits = [];
  searchHitIndex = -1;
  updateSearchNav();

  if (!searchOptions.query) return;

  const runId = ++searchRunId;
  const sectionCount = readerView.book?.sections?.length ?? 0;

  try {
    searchSections:
    for (let index = 0; index < sectionCount; index += 1) {
      for await (const entry of readerView.search({ index, ...searchOptions })) {
        if (runId !== searchRunId) return;

        if (entry === "done") break;

        if (typeof entry === "object" && entry && "cfi" in entry) {
          const hit = entry as SearchHit;
          searchHits.push({
            cfi: hit.cfi,
            excerpt: hit.excerpt,
          });
          if (searchHits.length >= MAX_SEARCH_RESULTS) break searchSections;
        }
      }
    }

    if (runId !== searchRunId) return;
    updateSearchNav();
    if (searchHits.length) {
      searchModal.close();
      await showSearchHit(0);
    } else {
      searchInput.select();
      searchInput.placeholder = `没有找到：${searchOptions.query}`;
    }
  } catch (error) {
    if (runId !== searchRunId) return;
    console.error("Search failed.", error);
    searchModal.close();
    updateSearchNav();
  }
}

function createView() {
  const view = document.createElement("foliate-view") as FoliateViewElement;
  applyReaderLayout(view);
  readerRoot.replaceChildren(view);
  wireReaderEvents(view);
  return view;
}

async function showInitialPage(view: FoliateViewElement) {
  await view.next();
}

async function restoreSavedPosition(view: FoliateViewElement, savedPosition?: ReadingPosition) {
  if (!savedPosition) {
    await showInitialPage(view);
    return;
  }

  state.isRestoring = true;
  try {
    if (savedPosition.cfi) {
      await view.goTo(savedPosition.cfi);
      return;
    }

    if (typeof savedPosition.fraction === "number") {
      await view.goTo({ fraction: savedPosition.fraction });
      return;
    }
  } catch (error) {
    console.warn("Failed to restore saved reading position.", error);
  } finally {
    state.isRestoring = false;
  }

  await showInitialPage(view);
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
    await readerView.open(input);
    updateSearchButton();
    clearSearchState();

    const metadata = readerView.book?.metadata;
    const title = formatLocalized(metadata?.title) || "Untitled Book";

    document.title = `${title} · EPUB Viewer`;
    renderToc(readerView.book?.toc);

    applyReaderLayout(readerView);
    readerView.renderer?.setStyles?.(getBookStyles());
    await restoreSavedPosition(
      readerView,
      state.currentBookKey ? await getSavedPosition(state.currentBookKey) : undefined,
    );
  } catch (error) {
    console.error(`Failed to open ${sourceLabel}`, error);
  }
}

function readSourceFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("src");
}

function setupInteractions() {
  pageStatusButton.addEventListener("click", () => {
    tocModal.showModal();
  });

  openSearchButton.addEventListener("click", () => {
    searchInput.placeholder = "搜索正文";
    searchModal.showModal();
    window.setTimeout(() => searchInput.focus(), 0);
  });

  toggleFlowButton.addEventListener("click", () => {
    state.flow = state.flow === "paginated" ? "scrolled" : "paginated";
    updateFlowButton();
    if (readerView) applyReaderLayout(readerView);
  });

  toggleThemeButton.addEventListener("click", () => {
    const currentIndex = READER_THEMES.findIndex((theme) => theme.id === state.readerTheme);
    const nextTheme = READER_THEMES[(currentIndex + 1) % READER_THEMES.length]!;
    applyReaderTheme(nextTheme.id);
    void saveReaderTheme(nextTheme.id);
  });

  decreaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(-READER_FONT_SIZE_STEP);
  });

  increaseFontButton.addEventListener("click", () => {
    changeReaderFontSize(READER_FONT_SIZE_STEP);
  });

  decreaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(-READER_MARGIN_STEP);
    changeReaderDensity(-READER_SPACING_STEP);
  });

  increaseWidthButton.addEventListener("click", () => {
    changeReaderWidth(READER_MARGIN_STEP);
    changeReaderDensity(READER_SPACING_STEP);
  });

  exportButton.addEventListener("click", () => {
    void exportCurrentBook();
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void collectSearchHits(searchInput.value);
  });

  searchModal.addEventListener("close", () => {
    ++searchRunId;
    clearSearchHighlights();
  });

  searchPrevButton.addEventListener("click", () => {
    void showSearchHit(searchHitIndex - 1);
  });

  searchNextButton.addEventListener("click", () => {
    void showSearchHit(searchHitIndex + 1);
  });

  searchCloseButton.addEventListener("click", () => {
    clearSearchState();
  });

  pageLeftZone.addEventListener("click", () => {
    readerView?.prev();
  });

  pageRightZone.addEventListener("click", () => {
    readerView?.next();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      readerView?.prev();
    } else if (event.key === "ArrowRight") {
      readerView?.next();
    }
  });

  window.addEventListener("resize", () => {
    if (readerView) applyReaderLayout(readerView);
  });
}

async function bootstrap() {
  createIcons({
    icons: {
      Columns2,
      ChevronLeft,
      ChevronRight,
      Download,
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
  applyReaderSpacing(await loadReaderSpacing());
  applyReaderMargin(await loadReaderMargin());
  applyReaderFontSize(await loadReaderFontSize());
  applyReaderTheme(await loadReaderTheme());
  updateSearchButton();
  updateExportButton();
  updateFlowButton();
  setupInteractions();

  const src = readSourceFromQuery();
  if (src) {
    void openBook(src, src.split("/").pop() || src);
  }
}

void bootstrap();
