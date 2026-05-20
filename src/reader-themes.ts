import atomOneLightHighlightTheme from "highlight.js/styles/atom-one-light.css?raw";
import githubDarkHighlightTheme from "highlight.js/styles/github-dark.css?raw";
import githubLightHighlightTheme from "highlight.js/styles/github.css?raw";
import nordHighlightTheme from "highlight.js/styles/nord.css?raw";
import { state } from "./viewer-state";
import type { ReaderTheme, ReaderThemeId } from "./viewer-types";

export const READER_THEMES: ReaderTheme[] = [
  { id: "light", label: "Light", bodyTheme: "lofi", mode: "light", background: "#fffefd", foreground: "#1f2933", link: "#1f5f8f" },
  { id: "grey", label: "Grey", bodyTheme: "corporate", mode: "light", background: "#f1f1ee", foreground: "#2f3438", link: "#4c6a7f" },
  { id: "dark", label: "Dark", bodyTheme: "nord", mode: "dark", background: "#212830", foreground: "#e5e9f0", link: "#88c0d0" },
  { id: "one-dark", label: "One Dark", bodyTheme: "dim", mode: "dark", background: "#0f1117", foreground: "#d7dae0", link: "#61afef" },
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

export function getReaderTheme(themeId = state.readerTheme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

export function getReaderThemeIndex(themeId = state.readerTheme) {
  return READER_THEMES.findIndex((theme) => theme.id === getReaderTheme(themeId).id);
}

export function getNextReaderTheme(themeId = state.readerTheme) {
  const currentIndex = getReaderThemeIndex(themeId);
  return READER_THEMES[(currentIndex + 1) % READER_THEMES.length] ?? READER_THEMES[0];
}

export function getReaderCodeHighlightTheme(themeId = state.readerTheme) {
  return READER_CODE_HIGHLIGHT_THEMES[getReaderTheme(themeId).id];
}

export function getReaderMediaFilter(themeId = state.readerTheme) {
  return getReaderTheme(themeId).mode === "dark"
    ? "brightness(0.72) contrast(0.92) saturate(0.88)"
    : "none";
}

export function applyReaderTheme(themeId: ReaderThemeId) {
  const theme = getReaderTheme(themeId);
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
