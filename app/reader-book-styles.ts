import atomOneLightHighlightTheme from "highlight.js/styles/atom-one-light.css?raw";
import githubDarkHighlightTheme from "highlight.js/styles/github-dark.css?raw";
import githubLightHighlightTheme from "highlight.js/styles/github.css?raw";
import nordHighlightTheme from "highlight.js/styles/nord.css?raw";
import { platform } from "#platform";
import readerBookStyles from "./reader-book.css?raw";
import type { ReaderTheme, ReaderThemeId } from "./reader";

const readerProfile = platform.readerProfile;

export const READER_FONT_FAMILY = readerProfile.fontFamily;
export const READER_LATIN_FONT_FAMILY = "EB Garamond EPUB";
export const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
const READER_FONT_LOCAL_NAME = readerProfile.fontLocalName;
export const READER_LATIN_FONT_URL = readerProfile.latinFontUrl;
export const READER_LATIN_ITALIC_FONT_URL = readerProfile.latinItalicFontUrl;
export const READER_MONO_FONT_URL = readerProfile.monoFontUrl;
export const READER_LATIN_FONT_FORMAT = readerProfile.latinFontFormat;
export const READER_LATIN_ITALIC_FONT_FORMAT = readerProfile.latinItalicFontFormat;
export const READER_MONO_FONT_FORMAT = readerProfile.monoFontFormat;
export const READER_MONO_FONT_WEIGHT = readerProfile.monoFontWeight;

const READER_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "${READER_FONT_FAMILY}", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif`;
const READER_SANS_STACK =
  `"${READER_FONT_FAMILY}", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
const READER_MONO_STACK =
  `"${READER_MONO_FONT_FAMILY}", "Sarasa Mono SC", "Maple Mono SC NF", "Cascadia Code", "SFMono-Regular", Consolas, monospace`;

const DEFAULT_READER_IMAGE_MAX_INLINE_SIZE = 80;
const MIN_READER_IMAGE_MAX_INLINE_SIZE = 72;
const MAX_READER_IMAGE_MAX_INLINE_SIZE = 92;
const READER_IMAGE_SCALE_PER_FONT_PIXEL = 2;

type ReaderBookLayout = {
  letterSpacing: string;
  lineHeight: number;
  paragraphSpacing: string;
  wordSpacing: string;
};

type ReaderBookStyleOptions = {
  fontSize: number;
  layout: ReaderBookLayout;
  layoutLevel: number;
  theme: ReaderTheme;
};

let cachedBookStyles: { key: string; value: [string, string] } | null = null;

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

const READER_BOOK_FOUNDATION_STYLES = `
  ${READER_FONT_LOCAL_NAME ? `
  @font-face {
    font-family: "${READER_FONT_FAMILY}";
    src: local("${READER_FONT_LOCAL_NAME}");
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
    font-family: "${READER_LATIN_FONT_FAMILY}";
    src: url("${READER_LATIN_ITALIC_FONT_URL}") format("${READER_LATIN_ITALIC_FONT_FORMAT}");
    font-weight: 400 800;
    font-style: italic;
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
`;

export function createReaderBookStyles(options: ReaderBookStyleOptions): [string, string] {
  const { fontSize, layout, layoutLevel, theme } = options;
  const cacheKey = `${theme.id}|${fontSize}|${layoutLevel}`;
  if (cachedBookStyles?.key === cacheKey) return cachedBookStyles.value;

  const imageMaxInlineSize = clamp(
    DEFAULT_READER_IMAGE_MAX_INLINE_SIZE
      + (fontSize - readerProfile.defaultFontSize) * READER_IMAGE_SCALE_PER_FONT_PIXEL,
    MIN_READER_IMAGE_MAX_INLINE_SIZE,
    MAX_READER_IMAGE_MAX_INLINE_SIZE,
  );
  const mediaFilter = theme.mode === "dark"
    ? "brightness(0.72) contrast(0.92) saturate(0.88)"
    : "none";
  const dynamicStyles = `
    html,
    body {
      --theme-bg-color: ${theme.background} !important;
      --reader-fg-color: ${theme.foreground};
      --reader-link-color: ${theme.link};
      --reader-muted-color: color-mix(in srgb, ${theme.foreground} 72%, ${theme.background});
      --reader-border-color: color-mix(in srgb, ${theme.foreground} 18%, ${theme.background});
      --reader-panel-bg: color-mix(in srgb, ${theme.foreground} 7%, ${theme.background});
      --reader-font-size: ${fontSize}px;
      --reader-line-height: ${layout.lineHeight + readerProfile.lineHeightOffset};
      --reader-letter-spacing: ${layout.letterSpacing};
      --reader-word-spacing: ${layout.wordSpacing};
      --reader-paragraph-spacing: ${layout.paragraphSpacing};
      --reader-media-filter: ${mediaFilter};
      --reader-image-max-inline-size: ${imageMaxInlineSize}%;
      --reader-color-scheme: ${theme.mode};
      --reader-config-font-serif: ${READER_SERIF_STACK};
      --reader-config-font-sans: ${READER_SANS_STACK};
      --reader-config-font-mono: ${READER_MONO_STACK};
      --reader-font-size-adjust: ${readerProfile.fontSizeAdjust};
      color-scheme: ${theme.mode};
    }
    ${READER_CODE_HIGHLIGHT_THEMES[theme.id]}
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
  const value: [string, string] = [
    READER_BOOK_FOUNDATION_STYLES,
    `${readerBookStyles}\n${dynamicStyles}`,
  ];
  cachedBookStyles = { key: cacheKey, value };
  return value;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
