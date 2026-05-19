import { state } from "./viewer-state";
import type { FoliateViewElement, ReaderFlow, ReaderTheme, ReaderThemeId } from "./viewer-types";

export const READER_FONT_FAMILY = "LXGW WenKai EPUB";
export const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
export const READER_FONT_URL = chrome.runtime.getURL("LXGWWenKai-Regular.ttf");
export const READER_MONO_FONT_URL = chrome.runtime.getURL("Monaspace Argon Var.ttf");

export const MIN_READER_FONT_SIZE = 14;
export const MAX_READER_FONT_SIZE = 32;
export const READER_FONT_SIZE_STEP = 1;
export const MIN_READER_MARGIN = 0;
export const MAX_READER_MARGIN = 72;
export const READER_MARGIN_STEP = 8;
export const MIN_READER_SPACING = -4;
export const MAX_READER_SPACING = 6;
export const READER_SPACING_STEP = 1;

const PAGINATED_GAP = "2.5%";
const PAGINATED_SINGLE_COLUMN_MAX_INLINE_SIZE = 1280;
const PAGINATED_MULTI_COLUMN_MAX_INLINE_SIZE = 960;
const PAGINATED_TWO_COLUMN_MIN_WIDTH = 1500;
const PAGINATED_THREE_COLUMN_MIN_WIDTH = 2000;

const READER_SERIF_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif`;
const READER_SANS_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
const READER_MONO_STACK =
  `"${READER_MONO_FONT_FAMILY}", "Sarasa Mono SC", "Maple Mono SC NF", "Cascadia Code", "SFMono-Regular", Consolas, monospace`;

export const READER_THEMES: ReaderTheme[] = [
  { id: "light", label: "Light", bodyTheme: "lofi", mode: "light", background: "#fffefd", foreground: "#1f2933", link: "#1f5f8f" },
  { id: "grey", label: "Grey", bodyTheme: "corporate", mode: "light", background: "#f1f1ee", foreground: "#2f3438", link: "#4c6a7f" },
  { id: "dark", label: "Dark", bodyTheme: "nord", mode: "dark", background: "#212830", foreground: "#e5e9f0", link: "#88c0d0" },
  { id: "one-dark", label: "One Dark", bodyTheme: "dim", mode: "dark", background: "#0f1117", foreground: "#d7dae0", link: "#61afef" },
];

export function getTheme(themeId = state.readerTheme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

export function getBookStyles(themeId = state.readerTheme) {
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
      font-display: block;
    }
    @font-face {
      font-family: "${READER_MONO_FONT_FAMILY}";
      src: url("${READER_MONO_FONT_URL}") format("truetype");
      font-weight: 100 900;
      font-style: normal;
      font-display: block;
    }
    html {
      --theme-bg-color: ${background} !important;
      --reader-font-size: ${state.readerFontSize}px;
      --reader-line-height: ${lineHeight};
      --reader-word-spacing: ${wordSpacing};
      --reader-font-serif: ${READER_SERIF_STACK};
      --reader-font-sans: ${READER_SANS_STACK};
      --reader-font-mono: ${READER_MONO_STACK};
      color-scheme: ${theme.mode};
      font-size: var(--reader-font-size) !important;
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
      font-size: var(--reader-font-size) !important;
      line-height: var(--reader-line-height) !important;
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
    p, li, blockquote, dd, dt, td, th,
    [epub|type~="bodymatter"] p,
    [epub|type~="bodymatter"] div,
    [class~="para"],
    [class*="para-"],
    [class*="paragraph"],
    [class*="bodytext"],
    [class*="body-text"] {
      font-size: var(--reader-font-size) !important;
      line-height: var(--reader-line-height) !important;
      text-align: justify;
      hyphens: auto !important;
      hanging-punctuation: allow-end last;
      word-spacing: var(--reader-word-spacing) !important;
    }
    p :where(span, a, em, strong, b, i),
    li :where(span, a, em, strong, b, i),
    blockquote :where(span, a, em, strong, b, i),
    dd :where(span, a, em, strong, b, i),
    dt :where(span, a, em, strong, b, i),
    td :where(span, a, em, strong, b, i),
    th :where(span, a, em, strong, b, i),
    [class~="para"] :where(span, a, em, strong, b, i),
    [class*="para-"] :where(span, a, em, strong, b, i),
    [class*="paragraph"] :where(span, a, em, strong, b, i),
    [class*="bodytext"] :where(span, a, em, strong, b, i),
    [class*="body-text"] :where(span, a, em, strong, b, i) {
      font-size: inherit !important;
      line-height: inherit !important;
      word-spacing: inherit !important;
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
    h1 { font-size: calc(var(--reader-font-size) * 1.55) !important; line-height: 1.35 !important; }
    h2 { font-size: calc(var(--reader-font-size) * 1.35) !important; line-height: 1.38 !important; }
    h3, [role="heading"], [epub|type~="title"], [class*="title"], [class*="heading"], [class*="chapter"] {
      font-size: calc(var(--reader-font-size) * 1.2) !important;
      line-height: 1.42 !important;
    }
    h4, h5, h6, [epub|type~="subtitle"] {
      font-size: calc(var(--reader-font-size) * 1.1) !important;
      line-height: 1.45 !important;
    }
    h1 :where(span, a, em, strong, b, i),
    h2 :where(span, a, em, strong, b, i),
    h3 :where(span, a, em, strong, b, i),
    h4 :where(span, a, em, strong, b, i),
    h5 :where(span, a, em, strong, b, i),
    h6 :where(span, a, em, strong, b, i),
    [role="heading"] :where(span, a, em, strong, b, i),
    [epub|type~="title"] :where(span, a, em, strong, b, i),
    [epub|type~="subtitle"] :where(span, a, em, strong, b, i),
    [class*="title"] :where(span, a, em, strong, b, i),
    [class*="heading"] :where(span, a, em, strong, b, i),
    [class*="chapter"] :where(span, a, em, strong, b, i) {
      font-size: inherit !important;
      line-height: inherit !important;
      font-weight: inherit !important;
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
    ul, ol, dl, blockquote { margin-inline: 0 !important; }
    img, svg, video {
      max-inline-size: 100% !important;
      block-size: auto !important;
      filter: ${mediaFilter} !important;
    }
    a { color: ${link} !important; }
    pre { white-space: pre-wrap !important; }
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] {
      display: none;
    }
  `;
}

export function applyReaderTheme(
  themeId: ReaderThemeId,
  controls: { toggleThemeButton: HTMLButtonElement; themeCount: HTMLElement; setBookStyles: () => void },
) {
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
  controls.toggleThemeButton.classList.toggle("dock-active", theme.mode === "dark");
  controls.toggleThemeButton.dataset.tip = `Theme: ${theme.label}`;
  controls.toggleThemeButton.setAttribute("aria-label", `Change theme, current theme ${theme.label}`);
  controls.themeCount.textContent = String(themeIndex + 1);
  controls.setBookStyles();
}

export function applyReaderLayout(view: FoliateViewElement, readerRoot: HTMLElement) {
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
  view.renderer?.setAttribute("animated", "");
  if (state.flow === "paginated") {
    view.renderer?.setAttribute("max-inline-size", `${maxInlineSize}px`);
    view.renderer?.setAttribute("max-column-count", allowThreeColumns ? "3" : "2");
    return;
  }

  view.renderer?.setAttribute("max-inline-size", `${PAGINATED_SINGLE_COLUMN_MAX_INLINE_SIZE}px`);
  view.renderer?.removeAttribute("max-column-count");
}

export function applyBookRenderingPreferences(view: FoliateViewElement, readerRoot: HTMLElement) {
  applyReaderLayout(view, readerRoot);
  view.renderer?.setStyles?.(getBookStyles());
}

export function clampReaderFontSize(fontSize: number) {
  return clamp(fontSize, MIN_READER_FONT_SIZE, MAX_READER_FONT_SIZE);
}

export function clampReaderMargin(margin: number) {
  return clamp(margin, MIN_READER_MARGIN, MAX_READER_MARGIN);
}

export function clampReaderSpacing(spacing: number) {
  return clamp(spacing, MIN_READER_SPACING, MAX_READER_SPACING);
}

export function applyReaderFontSize(fontSize: number, view?: FoliateViewElement | null) {
  state.readerFontSize = clampReaderFontSize(fontSize);
  view?.renderer?.setStyles?.(getBookStyles());
}

export function applyReaderSpacing(spacing: number, view?: FoliateViewElement | null) {
  state.readerSpacing = clampReaderSpacing(spacing);
  view?.renderer?.setStyles?.(getBookStyles());
}

export function applyReaderMargin(fontSize: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  state.readerMargin = clampReaderMargin(fontSize);
  if (view) applyReaderLayout(view, readerRoot);
}

export function changeReaderFontSize(delta: number, view?: FoliateViewElement | null) {
  const nextSize = clampReaderFontSize(state.readerFontSize + delta);
  if (nextSize === state.readerFontSize) return;
  applyReaderFontSize(nextSize, view);
}

export function changeReaderWidth(delta: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const nextMargin = clampReaderMargin(state.readerMargin - delta);
  if (nextMargin === state.readerMargin) return;
  applyReaderMargin(nextMargin, view, readerRoot);
}

export function changeReaderDensity(delta: number, view?: FoliateViewElement | null) {
  const nextSpacing = clampReaderSpacing(state.readerSpacing + delta);
  if (nextSpacing === state.readerSpacing) return;
  applyReaderSpacing(nextSpacing, view);
}

export function applyReaderFlow(flow: ReaderFlow, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  state.flow = flow;
  if (view) applyReaderLayout(view, readerRoot);
}

export function changeReaderFlow(view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const nextFlow = state.flow === "paginated" ? "scrolled" : "paginated";
  applyReaderFlow(nextFlow, view, readerRoot);
}

export function updateFlowButton(toggleFlowButton: HTMLButtonElement) {
  const isPaginated = state.flow === "paginated";
  const label = isPaginated ? "Switch to scrolling mode" : "Switch to paginated mode";

  toggleFlowButton.classList.toggle("dock-active", !isPaginated);
  toggleFlowButton.dataset.tip = label;
  toggleFlowButton.setAttribute("aria-label", label);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
