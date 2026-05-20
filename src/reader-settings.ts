import { state } from "./viewer-state";
import type { FoliateViewElement, ReaderFlow, ReaderSettings, ReaderTheme, ReaderThemeId } from "./viewer-types";
import githubLightHighlightTheme from "highlight.js/styles/github.css?raw";
import githubDarkHighlightTheme from "highlight.js/styles/github-dark.css?raw";
import atomOneLightHighlightTheme from "highlight.js/styles/atom-one-light.css?raw";
import nordHighlightTheme from "highlight.js/styles/nord.css?raw";

export const READER_FONT_FAMILY = "LXGW WenKai EPUB";
export const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
export const READER_FONT_URL = chrome.runtime.getURL("LXGWWenKai-Regular.ttf");
export const READER_MONO_FONT_URL = chrome.runtime.getURL("Monaspace Argon Var.ttf");

const MIN_READER_FONT_SIZE = 14;
const MAX_READER_FONT_SIZE = 32;
export const READER_FONT_SIZE_STEP = 1;
const MIN_READER_LAYOUT_LEVEL = 0;
const MAX_READER_LAYOUT_LEVEL = 4;
export const READER_LAYOUT_LEVEL_STEP = 1;

const PAGINATED_GAP = "2.5%";
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

const READER_LAYOUT_PRESETS = [
  {
    margin: 20,
    singleColumnMaxInlineSize: 880,
    multiColumnMaxInlineSize: 720,
    lineHeight: 1.58,
    letterSpacing: "-0.01em",
    wordSpacing: "-0.01em",
    paragraphSpacing: "0.55em",
  },
  {
    margin: 14,
    singleColumnMaxInlineSize: 960,
    multiColumnMaxInlineSize: 780,
    lineHeight: 1.64,
    letterSpacing: "-0.005em",
    wordSpacing: "0em",
    paragraphSpacing: "0.72em",
  },
  {
    margin: 8,
    singleColumnMaxInlineSize: 1040,
    multiColumnMaxInlineSize: 840,
    lineHeight: 1.7,
    letterSpacing: "0em",
    wordSpacing: "0.01em",
    paragraphSpacing: "0.92em",
  },
  {
    margin: 4,
    singleColumnMaxInlineSize: 1120,
    multiColumnMaxInlineSize: 900,
    lineHeight: 1.77,
    letterSpacing: "0.008em",
    wordSpacing: "0.02em",
    paragraphSpacing: "1.12em",
  },
  {
    margin: 0,
    singleColumnMaxInlineSize: 1200,
    multiColumnMaxInlineSize: 960,
    lineHeight: 1.84,
    letterSpacing: "0.015em",
    wordSpacing: "0.03em",
    paragraphSpacing: "1.34em",
  },
] as const;

const SCROLLED_LAYOUT_WIDTH_BASELINE = READER_LAYOUT_PRESETS[2];

function normalizeHighlightThemeCss(themeCss: string) {
  return themeCss
    .replaceAll("pre code.hljs", "pre.hljs")
    .replaceAll("code.hljs", "pre.hljs")
    .replaceAll("code .", "pre.hljs .")
    .replace(
      /\b(color|background|background-color|font-style|font-weight):\s*([^;!}{]+)(?:\s*!important)?/gu,
      "$1: $2 !important",
    );
}

const READER_CODE_HIGHLIGHT_THEMES: Record<ReaderThemeId, string> = {
  light: normalizeHighlightThemeCss(githubLightHighlightTheme),
  grey: normalizeHighlightThemeCss(atomOneLightHighlightTheme),
  dark: normalizeHighlightThemeCss(nordHighlightTheme),
  "one-dark": normalizeHighlightThemeCss(githubDarkHighlightTheme),
};

function getTheme(themeId = state.readerTheme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

function getLayoutPreset(layoutLevel = state.readerLayoutLevel) {
  return READER_LAYOUT_PRESETS[clampLayoutLevel(layoutLevel)] ?? READER_LAYOUT_PRESETS[2];
}

export function getBookStyles(themeId = state.readerTheme) {
  const theme = getTheme(themeId);
  const layout = getLayoutPreset();
  const { background, foreground, link } = theme;
  const mediaFilter =
    theme.mode === "dark" ? "brightness(0.72) contrast(0.92) saturate(0.88)" : "none";
  const highlightThemeCss = READER_CODE_HIGHLIGHT_THEMES[theme.id];

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
    html,
    body {
      --theme-bg-color: ${background} !important;
      --reader-fg-color: ${foreground};
      --reader-link-color: ${link};
      --reader-muted-color: color-mix(in srgb, ${foreground} 72%, ${background});
      --reader-border-color: color-mix(in srgb, ${foreground} 18%, ${background});
      --reader-panel-bg: color-mix(in srgb, ${foreground} 7%, ${background});
      --reader-font-size: ${state.readerFontSize}px;
      --reader-line-height: ${layout.lineHeight};
      --reader-letter-spacing: ${layout.letterSpacing};
      --reader-word-spacing: ${layout.wordSpacing};
      --reader-paragraph-spacing: ${layout.paragraphSpacing};
      --reader-font-serif: ${READER_SERIF_STACK};
      --reader-font-sans: ${READER_SANS_STACK};
      --reader-font-mono: ${READER_MONO_STACK};
      color-scheme: ${theme.mode};
      font-size: var(--reader-font-size) !important;
      background: ${background} !important;
      color: ${foreground} !important;
      margin: 0 !important;
      padding: 0 !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    body {
      font-family: var(--reader-font-serif) !important;
      line-height: var(--reader-line-height) !important;
      letter-spacing: var(--reader-letter-spacing) !important;
    }
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
    body,
    body :where(*:not(svg):not(svg *):not(a):not(a *):not(.hljs):not(.hljs *)) {
      color: var(--reader-fg-color) !important;
      -webkit-text-fill-color: var(--reader-fg-color) !important;
      caret-color: var(--reader-fg-color) !important;
      text-shadow: none !important;
    }
    a,
    a :where(*:not(svg):not(svg *)) {
      color: var(--reader-link-color) !important;
      -webkit-text-fill-color: var(--reader-link-color) !important;
    }
    body *:not(svg):not(svg *):not(code):not(pre):not(kbd):not(samp):not(input):not(textarea):not(select):not(button):not(.hljs):not(.hljs *) {
      font-family: var(--reader-font-serif) !important;
    }
    :is(code, pre, kbd, samp, textarea, [class*="code" i], [class*="source" i], [class*="program" i], [class*="verbatim" i], [class*="mono" i]) {
      font-family: var(--reader-font-mono) !important;
    }
    :is(code, pre, kbd, samp, [class*="code" i], [class*="source" i], [class*="program" i], [class*="verbatim" i], [class*="mono" i]):not(.hljs),
    :is(code, pre, kbd, samp):not(.hljs) *:not(.hljs *) {
      color: var(--reader-fg-color) !important;
      -webkit-text-fill-color: var(--reader-fg-color) !important;
      text-shadow: none !important;
    }
    :is(input, textarea, select, button) {
      font-family: var(--reader-font-sans) !important;
    }
    body *:not(img):not(svg):not(video):not(audio):not(canvas):not(iframe):not(.hljs):not(.hljs *) {
      background: transparent !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      box-sizing: border-box !important;
    }
    :is(p, li, blockquote, dd, dt, td, th),
    [epub|type~="bodymatter"] p,
    [epub|type~="bodymatter"] div,
    [class~="para"],
    [class*="para-" i],
    [class*="paragraph" i],
    [class*="bodytext" i],
    [class*="body-text" i] {
      font-size: var(--reader-font-size) !important;
      line-height: var(--reader-line-height) !important;
      letter-spacing: var(--reader-letter-spacing) !important;
      text-align: justify;
      hyphens: auto !important;
      hanging-punctuation: allow-end last;
      word-spacing: var(--reader-word-spacing) !important;
    }
    :is(p, [epub|type~="bodymatter"] p, [class~="para"], [class*="para-" i], [class*="paragraph" i], [class*="bodytext" i], [class*="body-text" i]) {
      margin-block-start: 0 !important;
      margin-block-end: var(--reader-paragraph-spacing) !important;
    }
    :is(p, li, blockquote, dd, dt, td, th, [class~="para"], [class*="para-" i], [class*="paragraph" i], [class*="bodytext" i], [class*="body-text" i])
      :where(span, a, em, strong, b, i) {
      font-size: inherit !important;
      line-height: inherit !important;
      letter-spacing: inherit !important;
      word-spacing: inherit !important;
    }
    :is(h1, h2, h3, h4, h5, h6, [role="heading"], [epub|type~="title"], [epub|type~="subtitle"], [class*="title" i], [class*="heading" i], [class*="chapter" i]),
    :is(h1, h2, h3, h4, h5, h6, [role="heading"], [epub|type~="title"], [epub|type~="subtitle"], [class*="title" i], [class*="heading" i], [class*="chapter" i]) * {
      font-family: var(--reader-font-serif) !important;
      font-weight: 700 !important;
      font-style: normal !important;
      letter-spacing: 0 !important;
      font-variation-settings: "wght" 700 !important;
      font-synthesis: weight !important;
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
    :is(h1, h2, h3, h4, h5, h6, [role="heading"], [epub|type~="title"], [epub|type~="subtitle"], [class*="title" i], [class*="heading" i], [class*="chapter" i])
      :where(span, a, em, strong, b, i) {
      font-size: inherit !important;
      line-height: inherit !important;
      font-weight: inherit !important;
    }
    :is(figcaption, caption,
    [epub|type~="caption"],
    [epub|type~="subtitle"],
    [epub|type~="credit"],
    [class*="caption" i],
    [class*="figcaption" i],
    [class*="legend" i],
    [class*="credit" i]) {
      color: var(--reader-muted-color) !important;
      -webkit-text-fill-color: var(--reader-muted-color) !important;
      font-size: 0.82em !important;
      line-height: 1.45 !important;
      text-align: center !important;
      word-spacing: 0 !important;
      opacity: 1 !important;
    }
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"],
    a[epub|type~="biblioref"],
    a[role~="doc-biblioref"],
    a[epub|type~="glossref"],
    a[role~="doc-glossref"],
    sup a,
    a sup,
    small a[href^="#"]) {
      display: inline !important;
      margin: 0 !important;
      padding: 0 0.08em !important;
      border: 0 !important;
      background: transparent !important;
      font-size: 0.72em !important;
      line-height: 0 !important;
      text-align: inherit !important;
      vertical-align: super !important;
      word-spacing: 0 !important;
    }
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"]) img.epub-footnote,
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"]) img[alt] {
      display: none !important;
    }
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"]):has(img.epub-footnote)::after,
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"]):has(img[alt])::after {
      content: attr(data-footnote-label) !important;
      display: inline !important;
      font-size: 0.9em !important;
      line-height: 1 !important;
      vertical-align: baseline !important;
    }
    :is(a[epub|type~="noteref"],
    a[role~="doc-noteref"],
    a[epub|type~="biblioref"],
    a[role~="doc-biblioref"],
    a[epub|type~="glossref"],
    a[role~="doc-glossref"],
    sup a,
    a sup,
    small a[href^="#"]) * {
      display: inline !important;
      font-size: inherit !important;
      line-height: inherit !important;
      text-align: inherit !important;
      vertical-align: baseline !important;
    }
    :is(blockquote, q, cite, [class*="quote" i], [class*="blockquote" i]),
    :is(blockquote, q, cite, [class*="quote" i], [class*="blockquote" i]) * {
      font-size: 0.94em !important;
      line-height: 1.62 !important;
      word-spacing: 0 !important;
      opacity: 0.94 !important;
    }
    blockquote {
      margin-block: 1.1em !important;
      margin-inline: 1.25em !important;
      padding-inline-start: 1em !important;
      border-inline-start: 0.18em solid var(--reader-border-color) !important;
    }
    :is(aside, details,
    [epub|type~="note"],
    [epub|type~="footnote"],
    [epub|type~="endnote"],
    [epub|type~="rearnote"],
    [epub|type~="sidebar"],
    [epub|type~="annotation"],
    [epub|type~="z3998:annotation"],
    [class*="note" i],
    [class*="annotation" i],
    [class*="comment" i],
    [class*="remark" i],
    [class*="sidebar" i]),
    :is(aside, details, [epub|type~="note"], [epub|type~="footnote"], [epub|type~="endnote"], [epub|type~="rearnote"], [epub|type~="sidebar"], [epub|type~="annotation"], [epub|type~="z3998:annotation"], [class*="note" i], [class*="annotation" i], [class*="comment" i], [class*="remark" i], [class*="sidebar" i]) * {
      font-size: 0.86em !important;
      line-height: 1.52 !important;
      word-spacing: 0 !important;
      opacity: 0.92 !important;
    }
    :is(aside, details, [epub|type~="sidebar"], [class*="sidebar" i]) {
      margin-block: 1em !important;
      padding: 0.85em 1em !important;
      border: 1px solid var(--reader-border-color) !important;
      border-radius: 0.35em !important;
      background: var(--reader-panel-bg) !important;
    }
    :is(aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    aside[role~="doc-footnote"],
    aside[role~="doc-endnote"],
    li[epub|type~="footnote"],
    li[epub|type~="endnote"],
    li[epub|type~="rearnote"],
    li[role~="doc-footnote"],
    li[role~="doc-endnote"],
    [data-reader-footnote-target="true"]) {
      display: block !important;
      position: relative !important;
      margin-block: 0.55em !important;
      margin-inline: 0 !important;
      padding: 0 0 0 2.1em !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--reader-muted-color) !important;
      -webkit-text-fill-color: var(--reader-muted-color) !important;
      font-size: 0.72em !important;
      line-height: 1.42 !important;
      text-align: start !important;
    }
    :is(aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    aside[role~="doc-footnote"],
    aside[role~="doc-endnote"],
    li[epub|type~="footnote"],
    li[epub|type~="endnote"],
    li[epub|type~="rearnote"],
    li[role~="doc-footnote"],
    li[role~="doc-endnote"],
    [data-reader-footnote-target="true"])::before {
      content: attr(data-footnote-label) !important;
      position: absolute !important;
      inset-inline-start: 0 !important;
      top: 0 !important;
      min-inline-size: 1.6em !important;
      color: var(--reader-muted-color) !important;
      -webkit-text-fill-color: var(--reader-muted-color) !important;
      font-family: var(--reader-font-sans) !important;
      font-size: 0.9em !important;
      font-weight: 700 !important;
      line-height: inherit !important;
      text-align: end !important;
    }
    :is(aside[epub|type~="footnote"],
    aside[epub|type~="endnote"],
    aside[epub|type~="rearnote"],
    aside[role~="doc-footnote"],
    aside[role~="doc-endnote"],
    li[epub|type~="footnote"],
    li[epub|type~="endnote"],
    li[epub|type~="rearnote"],
    li[role~="doc-footnote"],
    li[role~="doc-endnote"],
    [data-reader-footnote-target="true"]) :is(p, div, span, a, small) {
      color: var(--reader-muted-color) !important;
      -webkit-text-fill-color: var(--reader-muted-color) !important;
      font-size: inherit !important;
      line-height: inherit !important;
      text-align: start !important;
    }
    nav, header, footer, aside, .sans, [class*="sans"] {
      font-family: var(--reader-font-sans) !important;
    }
    :is(ul, ol, dl) { margin-inline: 0 !important; }
    :is(figure, .figure, [class*="figure" i], [class*="illustration" i], [class*="image" i]) {
      max-inline-size: 100% !important;
      margin-inline: auto !important;
      text-align: center !important;
      box-sizing: border-box !important;
    }
    img, svg, video {
      max-inline-size: 100% !important;
      max-width: 100% !important;
      block-size: auto !important;
      height: auto !important;
      filter: ${mediaFilter} !important;
    }
    img {
      display: block !important;
      margin-inline: auto !important;
    }
    img[data-reader-zoomable="true"] {
      inline-size: auto !important;
      width: auto !important;
      max-inline-size: 61.8% !important;
      max-width: 61.8% !important;
      border-radius: 0.5rem !important;
      cursor: zoom-in !important;
    }
    figure img[data-reader-zoomable="true"] {
      margin-block-end: 0.75em !important;
    }
    .medium-zoom-overlay {
      backdrop-filter: blur(10px) saturate(115%);
      -webkit-backdrop-filter: blur(10px) saturate(115%);
    }
    .medium-zoom-image--opened {
      border-radius: 0.95rem !important;
      box-shadow: 0 24px 60px color-mix(in srgb, var(--reader-fg-color) 18%, transparent) !important;
    }
    :is(table, .table, [class*="table" i]) {
      max-inline-size: 100% !important;
      max-width: 100% !important;
      inline-size: auto !important;
      width: auto !important;
      margin-inline: auto !important;
      border-collapse: collapse;
      table-layout: auto;
    }
    :is(table, .table, [class*="table" i]) :is(img, svg, video) {
      max-inline-size: 100% !important;
      max-width: 100% !important;
    }
    :is(figure, table) :is(figcaption, caption),
    :is(figcaption, caption,
    [epub|type~="caption"],
    [class*="caption" i],
    [class*="figcaption" i],
    [class*="legend" i]) {
      display: block !important;
      margin-inline: auto !important;
      text-align: center !important;
    }
    a { color: var(--reader-link-color) !important; }
    code, kbd, samp {
      font-size: 0.9em !important;
      line-height: 1.5 !important;
      border-radius: 0.25em !important;
      background: var(--reader-panel-bg) !important;
      padding: 0.08em 0.28em !important;
    }
    pre,
    .hljs {
      white-space: pre-wrap !important;
      font-size: 0.78em !important;
      line-height: 1.55 !important;
      font-family: var(--reader-font-mono) !important;
      margin-block: 1em !important;
      padding: 0.9em 1em !important;
      border: 1px solid var(--reader-border-color) !important;
      border-radius: 0.35em !important;
      background: var(--reader-panel-bg) !important;
      overflow: auto !important;
    }
    ${highlightThemeCss}
    .hljs {
      display: block !important;
      overflow-x: visible !important;
      padding: 0.9em 1em !important;
      white-space: pre-wrap !important;
      font-family: var(--reader-font-mono) !important;
      font-size: 0.78em !important;
      line-height: 1.55 !important;
      -webkit-text-fill-color: currentColor !important;
    }
    .hljs * {
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
      -webkit-text-fill-color: currentColor !important;
    }
  `;
}

export function applyReaderTheme(themeId: ReaderThemeId) {
  const theme = getTheme(themeId);
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
}

export function applyReaderLayout(view: FoliateViewElement, readerRoot: HTMLElement) {
  const layout = getLayoutPreset();
  const readerWidth = readerRoot.getBoundingClientRect().width;
  const allowMultipleColumns =
    state.flow === "paginated" && readerWidth >= PAGINATED_TWO_COLUMN_MIN_WIDTH;
  const allowThreeColumns =
    state.flow === "paginated" && readerWidth >= PAGINATED_THREE_COLUMN_MIN_WIDTH;
  const maxInlineSize = allowMultipleColumns
    ? layout.multiColumnMaxInlineSize
    : layout.singleColumnMaxInlineSize;

  view.renderer?.setAttribute("flow", state.flow);
  view.renderer?.setAttribute("gap", state.flow === "paginated" ? PAGINATED_GAP : "1.5%");
  view.renderer?.setAttribute("animated", "");
  if (state.flow === "paginated") {
    view.renderer?.setAttribute("margin", `${layout.margin}px`);
    view.renderer?.setAttribute("max-inline-size", `${maxInlineSize}px`);
    view.renderer?.setAttribute("max-column-count", allowThreeColumns ? "3" : "2");
    return;
  }

  view.renderer?.setAttribute("margin", `${SCROLLED_LAYOUT_WIDTH_BASELINE.margin}px`);
  view.renderer?.setAttribute("max-inline-size", `${SCROLLED_LAYOUT_WIDTH_BASELINE.singleColumnMaxInlineSize}px`);
  view.renderer?.removeAttribute("max-column-count");

}

function clampReaderFontSize(fontSize: number) {
  return clamp(fontSize, MIN_READER_FONT_SIZE, MAX_READER_FONT_SIZE);
}

function clampLayoutLevel(layoutLevel: number) {
  return clamp(layoutLevel, MIN_READER_LAYOUT_LEVEL, MAX_READER_LAYOUT_LEVEL);
}

function getLegacyLayoutLevel(settings: Partial<ReaderSettings>) {
  const spacingScore = typeof settings.spacing === "number" ? settings.spacing : 0;
  const marginScore = typeof settings.margin === "number" ? (8 - settings.margin) / 8 : 0;
  const legacyScore = spacingScore + marginScore;
  return clampLayoutLevel(Math.round(legacyScore / 2) + 2);
}

export function resolveReaderLayoutLevel(settings?: Partial<ReaderSettings>) {
  if (typeof settings?.layoutLevel === "number") {
    return clampLayoutLevel(settings.layoutLevel);
  }

  if (typeof settings?.spacing === "number" || typeof settings?.margin === "number") {
    return getLegacyLayoutLevel(settings);
  }

  return 2;
}

export function applyReaderFontSize(fontSize: number, view?: FoliateViewElement | null) {
  state.readerFontSize = clampReaderFontSize(fontSize);
  view?.renderer?.setStyles?.(getBookStyles());
}

export function applyReaderLayoutLevel(layoutLevel: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  state.readerLayoutLevel = clampLayoutLevel(layoutLevel);
  view?.renderer?.setStyles?.(getBookStyles());
  if (view) applyReaderLayout(view, readerRoot);
}

export function changeReaderFontSize(delta: number, view?: FoliateViewElement | null) {
  const nextSize = clampReaderFontSize(state.readerFontSize + delta);
  if (nextSize === state.readerFontSize) return;
  applyReaderFontSize(nextSize, view);
}

export function changeReaderLayoutLevel(delta: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const nextLevel = clampLayoutLevel(state.readerLayoutLevel + delta);
  if (nextLevel === state.readerLayoutLevel) return;
  applyReaderLayoutLevel(nextLevel, view, readerRoot);
}

export function applyReaderFlow(flow: ReaderFlow, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  state.flow = flow;
  if (view) applyReaderLayout(view, readerRoot);
}

export function changeReaderFlow(view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const nextFlow = state.flow === "paginated" ? "scrolled" : "paginated";
  applyReaderFlow(nextFlow, view, readerRoot);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
