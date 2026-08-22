import atomOneLightHighlightTheme from "highlight.js/styles/atom-one-light.css?raw";
import githubDarkHighlightTheme from "highlight.js/styles/github-dark.css?raw";
import githubLightHighlightTheme from "highlight.js/styles/github.css?raw";
import gruvboxDarkHighlightTheme from "highlight.js/styles/base16/gruvbox-dark-medium.css?raw";
import nordHighlightTheme from "highlight.js/styles/nord.css?raw";
import { platform } from "#platform";
import bookStyles from "./book.css?raw";
import type {
  TypographyFonts,
  TypographyTextAlignment,
  TypographyTheme,
  TypographyThemeId,
} from "../model";

const readerProfile = platform.readerProfile;

export const READER_LATIN_FONT_FAMILY = "EB Garamond EPUB";
export const READER_MONO_FONT_FAMILY = "Monaspace Argon EPUB";
const READER_LATIN_FONT_URL = readerProfile.latinFontUrl;
const READER_LATIN_ITALIC_FONT_URL = readerProfile.latinItalicFontUrl;
const READER_MONO_FONT_URL = readerProfile.monoFontUrl;
const READER_LATIN_FONT_FORMAT = readerProfile.latinFontFormat;
const READER_LATIN_ITALIC_FONT_FORMAT = readerProfile.latinItalicFontFormat;
const READER_MONO_FONT_FORMAT = readerProfile.monoFontFormat;
const READER_MONO_FONT_WEIGHT = readerProfile.monoFontWeight;
// 18px * 114% preserves the previous EB Garamond glyph size of 19px * 108%,
// while CJK and other fallback fonts use the smaller reader base size.
const READER_LATIN_FONT_SIZE_ADJUST = "114%";

const READER_HANT_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif", "Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", "PMingLiU", "MingLiU", Georgia, "Times New Roman", serif`;
const READER_HANT_SANS_STACK =
  `"Noto Sans", "Noto Sans TC", "Noto Sans CJK TC", "Source Han Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif`;
const READER_HK_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif", "Noto Serif TC", "Noto Serif CJK HK", "Source Han Serif HC", "Songti HK", "LiSong Pro", Georgia, "Times New Roman", serif`;
const READER_HK_SANS_STACK =
  `"Noto Sans", "Noto Sans HK", "Noto Sans CJK HK", "Source Han Sans HC", "PingFang HK", "LiHei Pro", system-ui, sans-serif`;
const READER_JA_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif", "Noto Serif JP", "Noto Serif CJK JP", "Yu Mincho", "Hiragino Mincho ProN", serif`;
const READER_JA_SANS_STACK =
  `"Noto Sans", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
const READER_KO_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif", "Noto Serif KR", "Noto Serif CJK KR", "Batang", serif`;
const READER_KO_SANS_STACK =
  `"Noto Sans", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif`;
const READER_ARABIC_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Naskh Arabic", "Noto Serif Arabic", "Amiri", serif`;
const READER_ARABIC_SANS_STACK =
  `"Noto Sans Arabic", "Noto Kufi Arabic", sans-serif`;
const READER_HEBREW_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif Hebrew", "Times New Roman", serif`;
const READER_HEBREW_SANS_STACK =
  `"Noto Sans Hebrew", Arial, sans-serif`;
const READER_DEVANAGARI_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif Devanagari", "Nirmala UI", serif`;
const READER_DEVANAGARI_SANS_STACK =
  `"Noto Sans Devanagari", "Nirmala UI", sans-serif`;
const READER_THAI_SERIF_STACK =
  `"${READER_LATIN_FONT_FAMILY}", "Noto Serif Thai", "Th Sarabun New", Tahoma, serif`;
const READER_THAI_SANS_STACK =
  `"Noto Sans Thai", Tahoma, sans-serif`;

export const READER_SCRIPT_FONT_STACKS = {
  "zh-hant": { serif: READER_HANT_SERIF_STACK, sans: READER_HANT_SANS_STACK },
  "zh-hant-hk": { serif: READER_HK_SERIF_STACK, sans: READER_HK_SANS_STACK },
  ja: { serif: READER_JA_SERIF_STACK, sans: READER_JA_SANS_STACK },
  ko: { serif: READER_KO_SERIF_STACK, sans: READER_KO_SANS_STACK },
  arabic: { serif: READER_ARABIC_SERIF_STACK, sans: READER_ARABIC_SANS_STACK },
  hebrew: { serif: READER_HEBREW_SERIF_STACK, sans: READER_HEBREW_SANS_STACK },
  devanagari: { serif: READER_DEVANAGARI_SERIF_STACK, sans: READER_DEVANAGARI_SANS_STACK },
  thai: { serif: READER_THAI_SERIF_STACK, sans: READER_THAI_SANS_STACK },
} as const;

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
  fonts: TypographyFonts;
  fontSize: number;
  layout: ReaderBookLayout;
  layoutLevel: number;
  theme: TypographyTheme;
  textAlignment: TypographyTextAlignment;
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

const READER_CODE_HIGHLIGHT_THEMES: Record<TypographyThemeId, string> = {
  light: normalizeHighlightThemeCss(githubLightHighlightTheme),
  grey: normalizeHighlightThemeCss(atomOneLightHighlightTheme),
  dark: normalizeHighlightThemeCss(nordHighlightTheme),
  "one-dark": normalizeHighlightThemeCss(githubDarkHighlightTheme),
  gruvbox: normalizeHighlightThemeCss(gruvboxDarkHighlightTheme),
};

const READER_BOOK_FOUNDATION_STYLES = `
  @font-face {
    font-family: "${READER_LATIN_FONT_FAMILY}";
    src: url("${READER_LATIN_FONT_URL}") format("${READER_LATIN_FONT_FORMAT}");
    font-weight: 400 800;
    font-style: normal;
    size-adjust: ${READER_LATIN_FONT_SIZE_ADJUST};
    font-display: swap;
    unicode-range: U+0000-024F, U+1E00-1EFF, U+2000-206F, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2150-218F, U+FB00-FB06;
  }
  @font-face {
    font-family: "${READER_LATIN_FONT_FAMILY}";
    src: url("${READER_LATIN_ITALIC_FONT_URL}") format("${READER_LATIN_ITALIC_FONT_FORMAT}");
    font-weight: 400 800;
    font-style: italic;
    size-adjust: ${READER_LATIN_FONT_SIZE_ADJUST};
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

export function createBookStyles(options: ReaderBookStyleOptions): [string, string] {
  const { fonts, fontSize, layout, layoutLevel, textAlignment, theme } = options;
  const cacheKey = `${theme.id}|${fonts.serif}|${fonts.sans}|${fonts.mono}|${fontSize}|${layoutLevel}|${textAlignment}`;
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
      --reader-accent-primary: ${theme.primary};
      --reader-accent-secondary: ${theme.secondary};
      --reader-highlight-bg: ${theme.secondary};
      --reader-highlight-fg: ${theme.secondaryInk};
      --reader-selection-color: color-mix(in srgb, ${theme.primary} 38%, transparent);
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
      --reader-config-font-serif: ${serializeFontFamily(fonts.serif, READER_LATIN_FONT_FAMILY)};
      --reader-config-font-sans: ${serializeFontFamily(fonts.sans, "system-ui")};
      --reader-config-font-mono: ${serializeFontFamily(fonts.mono, READER_MONO_FONT_FAMILY)};
      --reader-font-size-adjust: ${readerProfile.fontSizeAdjust};
      ${textAlignment === "auto" ? "" : `--reader-text-align-override: ${textAlignment};`}
      color-scheme: ${theme.mode};
    }
    ::selection {
      background-color: var(--reader-selection-color) !important;
      color: var(--reader-fg-color) !important;
      text-shadow: none !important;
    }
    body span:not([class~="highlight"]):not([class~="highlighted"]):not([class~="hilite"]) {
      background: transparent !important;
    }
    body :is(mark, [class~="highlight"], [class~="highlighted"], [class~="hilite"]) {
      background: var(--reader-highlight-bg) !important;
    }
    body :is(mark, [class~="highlight"], [class~="highlighted"], [class~="hilite"]),
    body :is(mark, [class~="highlight"], [class~="highlighted"], [class~="hilite"])
      :where(*:not(svg):not(svg *)) {
      color: var(--reader-highlight-fg) !important;
      -webkit-text-fill-color: var(--reader-highlight-fg) !important;
      text-shadow: none !important;
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
    `${bookStyles}\n${dynamicStyles}`,
  ];
  cachedBookStyles = { key: cacheKey, value };
  return value;
}

function serializeFontFamily(value: string, fallback: string) {
  const families = value
    .split(",")
    .map((family) => family.trim().replace(/^(["'])(.*)\1$/u, "$2"))
    .filter(Boolean);
  return (families.length ? families : [fallback])
    .map((family) => CSS_GENERIC_FONT_FAMILIES.has(family.toLowerCase()) ? family : JSON.stringify(family))
    .join(", ");
}

const CSS_GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
