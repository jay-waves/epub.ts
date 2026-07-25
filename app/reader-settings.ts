import atomOneLightHighlightTheme from "highlight.js/styles/atom-one-light.css?raw";
import githubDarkHighlightTheme from "highlight.js/styles/github-dark.css?raw";
import githubLightHighlightTheme from "highlight.js/styles/github.css?raw";
import nordHighlightTheme from "highlight.js/styles/nord.css?raw";
import { platform } from "#platform";
import { readerSettings } from "./reader";
import type { ReaderFlow, ReaderSettings, ReaderTheme, ReaderThemeId } from "./reader";
import type { FoliateViewElement } from "./foliate";

const READER_THEMES: ReaderTheme[] = [
  { id: "light", bodyTheme: "lofi", mode: "light", background: "#fffefd", foreground: "#1f2933", link: "#1f5f8f" },
  { id: "grey", bodyTheme: "corporate", mode: "light", background: "#f1f1ee", foreground: "#2f3438", link: "#4c6a7f" },
  { id: "dark", bodyTheme: "nord", mode: "dark", background: "#212830", foreground: "#e5e9f0", link: "#88c0d0" },
  { id: "one-dark", bodyTheme: "dim", mode: "dark", background: "#0f1117", foreground: "#d7dae0", link: "#61afef" },
];

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

function getReaderTheme(themeId = readerSettings.theme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

export function getNextReaderThemeId(themeId = readerSettings.theme) {
  const currentIndex = READER_THEMES.findIndex((theme) => theme.id === getReaderTheme(themeId).id);
  return (READER_THEMES[(currentIndex + 1) % READER_THEMES.length] ?? READER_THEMES[0]).id;
}

function getReaderCodeHighlightTheme(themeId = readerSettings.theme) {
  return READER_CODE_HIGHLIGHT_THEMES[getReaderTheme(themeId).id];
}

function getReaderMediaFilter(themeId = readerSettings.theme) {
  return getReaderTheme(themeId).mode === "dark"
    ? "brightness(0.72) contrast(0.92) saturate(0.88)"
    : "none";
}

export function applyReaderTheme(themeId: ReaderThemeId) {
  const theme = getReaderTheme(themeId);
  const scrollbarThumb = theme.mode === "dark"
    ? "rgba(191, 205, 219, 0.28)"
    : "rgba(82, 94, 110, 0.35)";
  const scrollbarTrack = theme.mode === "dark"
    ? "rgba(22, 29, 37, 0.45)"
    : "rgba(255, 255, 255, 0.18)";

  readerSettings.theme = theme.id;
  document.body.dataset.theme = theme.bodyTheme;
  document.documentElement.dataset.readerTheme = theme.id;
  document.documentElement.dataset.readerMode = theme.mode;
  document.documentElement.style.setProperty("--reader-chrome-bg", theme.background);
  document.documentElement.style.setProperty("--reader-chrome-fg", theme.foreground);
  document.documentElement.style.setProperty("--reader-color-scheme", theme.mode);
  document.documentElement.style.setProperty("--reader-scrollbar-thumb", scrollbarThumb);
  document.documentElement.style.setProperty("--reader-scrollbar-track", scrollbarTrack);
}

const readerProfile = platform.readerProfile;

export const READER_FONT_FAMILY = readerProfile.fontFamily;
export const READER_LATIN_FONT_FAMILY = "EB Garamond EPUB";
export const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
export const READER_FONT_URL = readerProfile.fontUrl;
export const READER_FONT_FORMAT = readerProfile.fontFormat;
export const READER_LATIN_FONT_URL = readerProfile.latinFontUrl;
export const READER_MONO_FONT_URL = readerProfile.monoFontUrl;
export const READER_LATIN_FONT_FORMAT = readerProfile.latinFontFormat;
export const READER_MONO_FONT_FORMAT = readerProfile.monoFontFormat;
export const READER_MONO_FONT_WEIGHT = readerProfile.monoFontWeight;
const READER_FONT_SIZE_ADJUST = readerProfile.fontSizeAdjust;
const READER_LINE_HEIGHT_OFFSET = readerProfile.lineHeightOffset;

const MIN_READER_FONT_SIZE = 14;
const MAX_READER_FONT_SIZE = 22;
export const READER_FONT_SIZE_STEP = 0.5;
const MIN_READER_LAYOUT_LEVEL = 0;
export const READER_LAYOUT_LEVEL_STEP = 1;

const PAGINATED_GAP = "2.5%";
const PAGINATED_TWO_COLUMN_MIN_WIDTH = 1500;
const PAGINATED_THREE_COLUMN_MIN_WIDTH = 2000;

const READER_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "${READER_FONT_FAMILY}", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif`;
const READER_SANS_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
const READER_MONO_STACK =
  `"${READER_MONO_FONT_FAMILY}", "Sarasa Mono SC", "Maple Mono SC NF", "Cascadia Code", "SFMono-Regular", Consolas, monospace`;
const READER_MONO_SELECTOR =
  ':is(code, pre, kbd, samp, textarea, [class*="code" i], [class*="source" i], [class*="program" i], [class*="verbatim" i], [class*="mono" i])';
const READER_PARAGRAPH_SELECTOR =
  ':is(p, li, blockquote, dd, dt, td, th, [epub|type~="bodymatter"] p, [epub|type~="bodymatter"] div, [class~="para"], [class*="para-" i], [class*="paragraph" i], [class*="bodytext" i], [class*="body-text" i])';
const READER_PARAGRAPH_BLOCK_SELECTOR =
  ':is(p, [epub|type~="bodymatter"] p, [class~="para"], [class*="para-" i], [class*="paragraph" i], [class*="bodytext" i], [class*="body-text" i])';
const READER_HEADING_SELECTOR =
  ':is(h1, h2, h3, h4, h5, h6, [role="heading"], [epub|type~="title"], [epub|type~="subtitle"], [class*="title" i], [class*="heading" i], [class*="chapter" i])';
const READER_INLINE_TEXT_SELECTOR = ":where(span, a, em, strong, b, i)";
const READER_CAPTION_SELECTOR =
  ':is(figcaption, caption, [epub|type~="caption"], [epub|type~="subtitle"], [epub|type~="credit"], [class*="caption" i], [class*="figcaption" i], [class*="legend" i], [class*="credit" i])';
const READER_FIGURE_CAPTION_SELECTOR =
  ':is(figcaption, caption, [epub|type~="caption"], [class*="caption" i], [class*="figcaption" i], [class*="legend" i])';
const READER_FORM_CONTROL_SELECTOR = ":is(input, textarea, select, button)";
const READER_TEXT_COLOR_TARGET_SELECTOR = ':where(*:not(svg):not(svg *):not(a):not(a *):not(.hljs):not(.hljs *))';
const READER_LINK_COLOR_TARGET_SELECTOR = ":where(*:not(svg):not(svg *))";
const READER_SERIF_CONTENT_SELECTOR =
  "body *:not(svg):not(svg *):not(code):not(pre):not(kbd):not(samp):not(input):not(textarea):not(select):not(button):not(.hljs):not(.hljs *)";
const READER_NON_VISUAL_BACKGROUND_SELECTOR =
  "body *:not(img):not(svg):not(video):not(audio):not(canvas):not(iframe):not(.hljs):not(.hljs *)";
const READER_REFERENCE_SELECTOR =
  ':is(a[epub|type~="noteref"], a[role~="doc-noteref"], a[epub|type~="biblioref"], a[role~="doc-biblioref"], a[epub|type~="glossref"], a[role~="doc-glossref"], sup a, a sup, small a[href^="#"])';
const READER_NOTE_SELECTOR =
  ':is(aside, details, [epub|type~="note"], [epub|type~="footnote"], [epub|type~="endnote"], [epub|type~="rearnote"], [epub|type~="sidebar"], [epub|type~="annotation"], [epub|type~="z3998:annotation"], [class*="note" i], [class*="annotation" i], [class*="comment" i], [class*="remark" i], [class*="sidebar" i])';
const READER_FOOTNOTE_SELECTOR =
  ':is(aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"], aside[role~="doc-footnote"], aside[role~="doc-endnote"], li[epub|type~="footnote"], li[epub|type~="endnote"], li[epub|type~="rearnote"], li[role~="doc-footnote"], li[role~="doc-endnote"], [data-reader-footnote-target="true"])';
const READER_FOOTNOTE_LINK_SELECTOR = ':is(a[epub|type~="noteref"], a[role~="doc-noteref"])';
const READER_QUOTE_SELECTOR = ':is(blockquote, q, cite, [class*="quote" i], [class*="blockquote" i])';
const READER_TABLE_SELECTOR = ':is(table, .table, [class*="table" i])';
const READER_MEDIA_SELECTOR = ":is(img, svg, video)";
const READER_MEDIA_WRAPPER_SELECTOR =
  ':is(div, p, section, article, figure, aside, li):has(> img), :is(div, p, section, article, figure, aside, li):has(> svg), :is(div, p, section, article, figure, aside, li):has(> video), :is(div, p, section, article, figure, aside, li):has(> a > img), :is(div, p, section, article, figure, aside, li):has(> a > svg), :is(div, p, section, article, figure, aside, li):has(> a > video)';

const READER_INHERIT_INLINE_TEXT_CSS = `
      font-size: inherit !important;
      line-height: inherit !important;
      letter-spacing: inherit !important;
      word-spacing: inherit !important;
`;
const READER_SMALL_TEXT_CSS = `
      font-size: var(--reader-small-font-size) !important;
      line-height: var(--reader-small-line-height) !important;
`;
const READER_MUTED_COLOR_CSS = `
      color: var(--reader-muted-color) !important;
      -webkit-text-fill-color: var(--reader-muted-color) !important;
`;
const READER_AUTO_BREAK_CSS = `
      break-inside: auto !important;
      page-break-inside: auto !important;
      -webkit-column-break-inside: auto !important;
`;

const READER_LAYOUT_PRESETS = [
  {
    margin: 24,
    singleColumnMaxInlineSize: 760,
    multiColumnMaxInlineSize: 680,
    lineHeight: 1.62,
    letterSpacing: "-0.01em",
    wordSpacing: "0em",
    paragraphSpacing: "0.65em",
  },
  {
    margin: 20,
    singleColumnMaxInlineSize: 840,
    multiColumnMaxInlineSize: 740,
    lineHeight: 1.68,
    letterSpacing: "0em",
    wordSpacing: "0.01em",
    paragraphSpacing: "0.75em",
  },
  {
    margin: 16,
    singleColumnMaxInlineSize: 920,
    multiColumnMaxInlineSize: 800,
    lineHeight: 1.74,
    letterSpacing: "0.005em",
    wordSpacing: "0.015em",
    paragraphSpacing: "0.85em",
  },
  {
    margin: 12,
    singleColumnMaxInlineSize: 1000,
    multiColumnMaxInlineSize: 860,
    lineHeight: 1.82,
    letterSpacing: "0.008em",
    wordSpacing: "0.02em",
    paragraphSpacing: "0.95em",
  },
  {
    margin: 10,
    singleColumnMaxInlineSize: 1080,
    multiColumnMaxInlineSize: 920,
    lineHeight: 1.9,
    letterSpacing: "0.01em",
    wordSpacing: "0.025em",
    paragraphSpacing: "1.05em",
  },
  {
    margin: 8,
    singleColumnMaxInlineSize: 1160,
    multiColumnMaxInlineSize: 980,
    lineHeight: 1.98,
    letterSpacing: "0.015em",
    wordSpacing: "0.03em",
    paragraphSpacing: "1.15em",
  },
] as const;

const MAX_READER_LAYOUT_LEVEL = READER_LAYOUT_PRESETS.length - 1;
const SCROLLED_LAYOUT_WIDTH_BASELINE = READER_LAYOUT_PRESETS[3];
let cachedDynamicBookStyles: { key: string; value: string } | null = null;

function getLayoutPreset(layoutLevel = readerSettings.layoutLevel) {
  return READER_LAYOUT_PRESETS[clampLayoutLevel(layoutLevel)] ?? READER_LAYOUT_PRESETS[2];
}

export const READER_STATIC_BOOK_STYLES = `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${READER_FONT_URL ? `
    @font-face {
      font-family: "${READER_FONT_FAMILY}";
      src: url("${READER_FONT_URL}") format("truetype");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    ` : ""}
    @font-face {
      font-family: "${READER_LATIN_FONT_FAMILY}";
      src: url("${READER_LATIN_FONT_URL}") format("${READER_LATIN_FONT_FORMAT}");
      font-weight: 400 800;
      font-style: normal;
      font-display: swap;
      unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2150-218F, U+FB00-FB06;
    }
    @font-face {
      font-family: "${READER_MONO_FONT_FAMILY}";
      src: url("${READER_MONO_FONT_URL}") format("${READER_MONO_FONT_FORMAT}");
      font-weight: ${READER_MONO_FONT_WEIGHT};
      font-style: normal;
      font-display: swap;
    }
    html,
    body {
      --reader-list-font-size: calc(var(--reader-font-size) * 0.9);
      --reader-list-paragraph-spacing: calc(var(--reader-paragraph-spacing) * 0.72);
      --reader-media-spacing: max(1em, calc(var(--reader-paragraph-spacing) * 1.15));
      --reader-small-font-size: calc(var(--reader-font-size) * 0.78);
      --reader-footnote-font-size: calc(var(--reader-font-size) * 0.68);
      --reader-small-line-height: 1.4;
      --reader-font-serif: ${READER_SERIF_STACK};
      --reader-font-sans: ${READER_SANS_STACK};
      --reader-font-mono: ${READER_MONO_STACK};
      color-scheme: var(--reader-color-scheme);
      font-size: var(--reader-font-size) !important;
      background: var(--theme-bg-color) !important;
      color: var(--reader-fg-color) !important;
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
      font-size-adjust: ${READER_FONT_SIZE_ADJUST};
      line-height: var(--reader-line-height) !important;
      letter-spacing: var(--reader-letter-spacing) !important;
      text-autospace: ideograph-alpha ideograph-numeric;
    }
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    *::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
    body,
    body ${READER_TEXT_COLOR_TARGET_SELECTOR} {
      color: var(--reader-fg-color) !important;
      -webkit-text-fill-color: var(--reader-fg-color) !important;
      caret-color: var(--reader-fg-color) !important;
      text-shadow: none !important;
    }
    a,
    a ${READER_LINK_COLOR_TARGET_SELECTOR} {
      color: var(--reader-link-color) !important;
      -webkit-text-fill-color: var(--reader-link-color) !important;
    }
    ${READER_SERIF_CONTENT_SELECTOR} {
      font-family: var(--reader-font-serif) !important;
    }
    ${READER_MONO_SELECTOR} {
      font-family: var(--reader-font-mono) !important;
    }
    ${READER_MONO_SELECTOR}:not(textarea):not(.hljs),
    :is(code, pre, kbd, samp):not(.hljs) *:not(.hljs *) {
      color: var(--reader-fg-color) !important;
      -webkit-text-fill-color: var(--reader-fg-color) !important;
      text-shadow: none !important;
    }
    ${READER_FORM_CONTROL_SELECTOR} {
      font-family: var(--reader-font-sans) !important;
    }
    ${READER_NON_VISUAL_BACKGROUND_SELECTOR} {
      background: transparent !important;
      max-inline-size: none !important;
      max-width: none !important;
      inline-size: auto !important;
      width: auto !important;
      box-sizing: border-box !important;
    }
    ${READER_PARAGRAPH_SELECTOR} {
      font-size: var(--reader-font-size) !important;
      line-height: var(--reader-line-height) !important;
      letter-spacing: var(--reader-letter-spacing) !important;
      text-align: justify;
      hyphens: auto !important;
      hanging-punctuation: allow-end last;
      word-spacing: var(--reader-word-spacing) !important;
      text-autospace: ideograph-alpha ideograph-numeric;
    }
    ${READER_PARAGRAPH_BLOCK_SELECTOR} {
      margin-block-start: 0 !important;
      margin-block-end: var(--reader-paragraph-spacing) !important;
    }
    :is(ul, ol),
    blockquote,
    li,
    li ${READER_PARAGRAPH_SELECTOR} {
      font-size: var(--reader-list-font-size) !important;
      line-height: var(--reader-line-height) !important;
    }
    :is(ul, ol),
    blockquote {
      margin-block-start: 0 !important;
      margin-block-end: var(--reader-list-paragraph-spacing) !important;
    }
    li {
      margin-block-start: 0 !important;
      margin-block-end: var(--reader-list-paragraph-spacing) !important;
    }
    li > :last-child {
      margin-block-end: 0 !important;
    }
    ${READER_PARAGRAPH_SELECTOR} ${READER_INLINE_TEXT_SELECTOR} {
${READER_INHERIT_INLINE_TEXT_CSS}
    }
    ${READER_HEADING_SELECTOR},
    ${READER_HEADING_SELECTOR} * {
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
    ${READER_HEADING_SELECTOR} ${READER_INLINE_TEXT_SELECTOR} {
      font-size: inherit !important;
      line-height: inherit !important;
      font-weight: inherit !important;
    }
    ${READER_CAPTION_SELECTOR} {
${READER_MUTED_COLOR_CSS}
      font-size: 0.82em !important;
      line-height: 1.45 !important;
      text-align: center !important;
      word-spacing: 0 !important;
      opacity: 1 !important;
    }
    ${READER_REFERENCE_SELECTOR} {
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
    ${READER_FOOTNOTE_LINK_SELECTOR} img.epub-footnote,
    ${READER_FOOTNOTE_LINK_SELECTOR} img[alt] {
      display: none !important;
    }
    ${READER_FOOTNOTE_LINK_SELECTOR}:has(img.epub-footnote)::after,
    ${READER_FOOTNOTE_LINK_SELECTOR}:has(img[alt])::after {
      content: attr(data-footnote-label) !important;
      display: inline !important;
      font-size: 0.9em !important;
      line-height: 1 !important;
      vertical-align: baseline !important;
    }
    ${READER_REFERENCE_SELECTOR} * {
      display: inline !important;
      font-size: inherit !important;
      line-height: inherit !important;
      text-align: inherit !important;
      vertical-align: baseline !important;
    }
    ${READER_QUOTE_SELECTOR},
    blockquote :is(p, span, a, em, strong, b, i, code, kbd, samp, pre) {
      font-size: var(--reader-list-font-size) !important;
      line-height: var(--reader-line-height) !important;
      word-spacing: 0 !important;
      opacity: 0.94 !important;
    }
    blockquote {
      margin-inline: 1.25em !important;
      padding-inline-start: 1em !important;
      border-inline-start: 0.18em solid var(--reader-border-color) !important;
    }
    blockquote ${READER_PARAGRAPH_SELECTOR},
    blockquote ${READER_INLINE_TEXT_SELECTOR},
    blockquote ${READER_PARAGRAPH_SELECTOR} ${READER_INLINE_TEXT_SELECTOR} {
      font-size: var(--reader-list-font-size) !important;
      line-height: var(--reader-line-height) !important;
    }
    blockquote[class] :is(p, span, a, em, strong, b, i, code)[class],
    blockquote[class] :is(p, span, a, em, strong, b, i, code),
    blockquote :is(p, span, a, em, strong, b, i, code)[class] {
      font-size: var(--reader-list-font-size) !important;
      line-height: var(--reader-line-height) !important;
    }
    ${READER_NOTE_SELECTOR},
    ${READER_NOTE_SELECTOR} * {
${READER_SMALL_TEXT_CSS}
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
    ${READER_FOOTNOTE_SELECTOR} {
      display: block !important;
      position: relative !important;
      margin-block: 0.55em !important;
      margin-inline: 0 !important;
      padding: 0 0 0 2.1em !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
${READER_MUTED_COLOR_CSS}
      font-size: var(--reader-footnote-font-size) !important;
      line-height: var(--reader-small-line-height) !important;
      text-align: start !important;
    }
    ${READER_FOOTNOTE_SELECTOR}::before {
      content: attr(data-footnote-label) !important;
      position: absolute !important;
      inset-inline-start: 0 !important;
      top: 0 !important;
      min-inline-size: 1.6em !important;
${READER_MUTED_COLOR_CSS}
      font-family: var(--reader-font-sans) !important;
      font-size: calc(var(--reader-footnote-font-size) * 0.9) !important;
      font-weight: 700 !important;
      line-height: inherit !important;
      text-align: end !important;
    }
    ${READER_FOOTNOTE_SELECTOR} :is(p, div, span, a, small) {
${READER_MUTED_COLOR_CSS}
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
      margin-block: var(--reader-media-spacing) !important;
      margin-inline: auto !important;
      text-align: center !important;
      box-sizing: border-box !important;
    }
    ${READER_MEDIA_WRAPPER_SELECTOR},
    [data-reader-media-block="true"] {
      margin-block: var(--reader-media-spacing) !important;
      text-align: center !important;
    }
    ${READER_MEDIA_SELECTOR} {
      max-inline-size: 100% !important;
      max-width: 100% !important;
      block-size: auto !important;
      height: auto !important;
      filter: var(--reader-media-filter) !important;
    }
    img {
      display: block !important;
      margin-inline: auto !important;
    }
    img.reader-zoomable-image {
      inline-size: 80% !important;
      width: 80% !important;
      max-inline-size: 80% !important;
      max-width: 80% !important;
      border-radius: 0.5rem !important;
      cursor: zoom-in !important;
    }
    figure img.reader-zoomable-image {
      margin-block-end: 0.75em !important;
    }
    ${READER_TABLE_SELECTOR} {
      max-inline-size: 100% !important;
      max-width: 100% !important;
      inline-size: 100% !important;
      width: 100% !important;
      margin-block: 1.15em !important;
      margin-inline: auto !important;
      border-collapse: collapse !important;
      table-layout: auto !important;
      border: 1px solid var(--reader-border-color) !important;
      border-radius: 0.45rem !important;
      background: color-mix(in srgb, var(--reader-panel-bg) 64%, transparent) !important;
${READER_SMALL_TEXT_CSS}
      overflow-wrap: break-word !important;
      word-break: normal !important;
${READER_AUTO_BREAK_CSS}
    }
    ${READER_TABLE_SELECTOR} :is(thead, tbody, tfoot, tr, th, td) {
      border-color: var(--reader-border-color) !important;
    }
    ${READER_TABLE_SELECTOR} :is(th, td) {
      min-inline-size: 0 !important;
      max-inline-size: 18rem !important;
      padding: 0.4em 0.56em !important;
      border: 1px solid var(--reader-border-color) !important;
      vertical-align: top !important;
      font-size: inherit !important;
      overflow-wrap: break-word !important;
      word-break: keep-all !important;
      white-space: normal !important;
      hyphens: auto !important;
      line-height: inherit !important;
    }
    ${READER_TABLE_SELECTOR} th {
      background: color-mix(in srgb, var(--reader-fg-color) 9%, var(--reader-panel-bg)) !important;
      font-family: var(--reader-font-sans) !important;
      font-weight: 650 !important;
      text-align: start !important;
    }
    ${READER_TABLE_SELECTOR} thead {
      break-after: avoid !important;
      page-break-after: avoid !important;
      -webkit-column-break-after: avoid !important;
    }
    ${READER_TABLE_SELECTOR} tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      -webkit-column-break-inside: avoid !important;
    }
    ${READER_TABLE_SELECTOR} tbody tr:nth-child(even) {
      background: color-mix(in srgb, var(--reader-fg-color) 4%, transparent) !important;
    }
    ${READER_TABLE_SELECTOR} :is(th, td) > :first-child {
      margin-block-start: 0 !important;
    }
    ${READER_TABLE_SELECTOR} :is(th, td) > :last-child {
      margin-block-end: 0 !important;
    }
    :is(figure, table) :is(figcaption, caption),
    ${READER_FIGURE_CAPTION_SELECTOR} {
      display: block !important;
      margin-inline: auto !important;
      margin-block: 0.45em 0.75em !important;
      text-align: center !important;
      caption-side: bottom !important;
${READER_MUTED_COLOR_CSS}
      font-family: var(--reader-font-sans) !important;
      font-size: 0.82em !important;
      line-height: 1.45 !important;
    }
    :is(code, kbd, samp):not(pre code):not(.hljs) {
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: 0.1em !important;
${READER_SMALL_TEXT_CSS}
      border-radius: 0.25em !important;
      border: 1px solid var(--reader-border-color) !important;
      background: var(--reader-panel-bg) !important;
      padding: 0.08em 0.28em !important;
      box-decoration-break: clone !important;
      -webkit-box-decoration-break: clone !important;
    }
    pre,
    .hljs {
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
${READER_SMALL_TEXT_CSS}
      font-family: var(--reader-font-mono) !important;
      max-inline-size: 100% !important;
      margin-block: 1em !important;
      padding: 0.9em 1em !important;
      border: 1px solid var(--reader-border-color) !important;
      border-radius: 0.35em !important;
      background: var(--reader-panel-bg) !important;
      overflow: visible !important;
${READER_AUTO_BREAK_CSS}
      box-decoration-break: clone !important;
      -webkit-box-decoration-break: clone !important;
    }
    pre code,
    pre .hljs,
    .hljs code {
      white-space: inherit !important;
      overflow-wrap: inherit !important;
      word-break: inherit !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      border: 0 !important;
      background: transparent !important;
      padding: 0 !important;
    }
    blockquote :is(code, kbd, samp):not(.hljs),
    blockquote pre,
    blockquote pre code,
    blockquote pre .hljs,
    blockquote .hljs,
    blockquote .hljs * {
      font-size: var(--reader-list-font-size) !important;
      line-height: var(--reader-line-height) !important;
    }
  `;

export function getBookDynamicStyles(themeId = readerSettings.theme) {
  const cacheKey = `${themeId}|${readerSettings.fontSize}|${readerSettings.layoutLevel}`;
  if (cachedDynamicBookStyles?.key === cacheKey) return cachedDynamicBookStyles.value;

  const theme = getReaderTheme(themeId);
  const layout = getLayoutPreset();
  const lineHeight = layout.lineHeight + READER_LINE_HEIGHT_OFFSET;
  const { background, foreground, link } = theme;
  const mediaFilter = getReaderMediaFilter(theme.id);
  const highlightThemeCss = getReaderCodeHighlightTheme(theme.id);

  const styles = `
    html,
    body {
      --theme-bg-color: ${background} !important;
      --reader-fg-color: ${foreground};
      --reader-link-color: ${link};
      --reader-muted-color: color-mix(in srgb, ${foreground} 72%, ${background});
      --reader-border-color: color-mix(in srgb, ${foreground} 18%, ${background});
      --reader-panel-bg: color-mix(in srgb, ${foreground} 7%, ${background});
      --reader-font-size: ${readerSettings.fontSize}px;
      --reader-line-height: ${lineHeight};
      --reader-letter-spacing: ${layout.letterSpacing};
      --reader-word-spacing: ${layout.wordSpacing};
      --reader-paragraph-spacing: ${layout.paragraphSpacing};
      --reader-media-filter: ${mediaFilter};
      --reader-color-scheme: ${theme.mode};
      color-scheme: ${theme.mode};
      background: ${background} !important;
      color: ${foreground} !important;
    }
    ${highlightThemeCss}
    .hljs {
      display: block !important;
      overflow-x: visible !important;
      -webkit-text-fill-color: currentColor !important;
    }
    .hljs * {
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
      -webkit-text-fill-color: currentColor !important;
    }
  `;
  cachedDynamicBookStyles = { key: cacheKey, value: styles };
  return styles;
}

export function getBookStyles(themeId = readerSettings.theme): [string, string] {
  return [READER_STATIC_BOOK_STYLES, getBookDynamicStyles(themeId)];
}

export function applyReaderLayout(view: FoliateViewElement, readerRoot: HTMLElement) {
  const layout = getLayoutPreset();
  const readerWidth = readerRoot.getBoundingClientRect().width;
  const allowMultipleColumns =
    readerSettings.flow === "paginated" && readerWidth >= PAGINATED_TWO_COLUMN_MIN_WIDTH;
  const allowThreeColumns =
    readerSettings.flow === "paginated" && readerWidth >= PAGINATED_THREE_COLUMN_MIN_WIDTH;
  const maxInlineSize = allowMultipleColumns
    ? layout.multiColumnMaxInlineSize
    : layout.singleColumnMaxInlineSize;

  view.renderer?.setAttribute("flow", readerSettings.flow);
  view.renderer?.setAttribute("gap", readerSettings.flow === "paginated" ? PAGINATED_GAP : "1.5%");
  view.renderer?.setAttribute("animated", "");
  if (readerSettings.flow === "paginated") {
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
  return clamp(Math.round(layoutLevel), MIN_READER_LAYOUT_LEVEL, MAX_READER_LAYOUT_LEVEL);
}

export function applyReaderFontSize(fontSize: number, view?: FoliateViewElement | null) {
  readerSettings.fontSize = clampReaderFontSize(fontSize);
  view?.renderer?.setStyles?.(getBookStyles());
}

export function applyReaderLayoutLevel(layoutLevel: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  readerSettings.layoutLevel = clampLayoutLevel(layoutLevel);
  view?.renderer?.setStyles?.(getBookStyles());
  if (view) applyReaderLayout(view, readerRoot);
}

export function canChangeReaderFontSize(delta: number) {
  const currentSize = clampReaderFontSize(readerSettings.fontSize);
  return clampReaderFontSize(currentSize + delta) !== currentSize;
}

export function changeReaderFontSize(delta: number, view?: FoliateViewElement | null) {
  const currentSize = clampReaderFontSize(readerSettings.fontSize);
  const nextSize = clampReaderFontSize(currentSize + delta);
  if (nextSize === currentSize) {
    readerSettings.fontSize = currentSize;
    return false;
  }
  applyReaderFontSize(nextSize, view);
  return true;
}

export function canChangeReaderLayoutLevel(delta: number) {
  const currentLevel = clampLayoutLevel(readerSettings.layoutLevel);
  return clampLayoutLevel(currentLevel + delta) !== currentLevel;
}

export function changeReaderLayoutLevel(delta: number, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const currentLevel = clampLayoutLevel(readerSettings.layoutLevel);
  const nextLevel = clampLayoutLevel(currentLevel + delta);
  if (nextLevel === currentLevel) {
    readerSettings.layoutLevel = currentLevel;
    return false;
  }
  applyReaderLayoutLevel(nextLevel, view, readerRoot);
  return true;
}

export function applyReaderFlow(flow: ReaderFlow, view: FoliateViewElement | null, readerRoot: HTMLElement) {
  readerSettings.flow = flow;
  if (view) applyReaderLayout(view, readerRoot);
}

export function changeReaderFlow(view: FoliateViewElement | null, readerRoot: HTMLElement) {
  const nextFlow = readerSettings.flow === "paginated" ? "scrolled" : "paginated";
  applyReaderFlow(nextFlow, view, readerRoot);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
