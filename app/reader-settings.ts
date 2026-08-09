import { createReaderBookStyles } from "./reader-book-styles";
import { readerSettings } from "./reader";
import type { ReaderFlow, ReaderTheme, ReaderThemeId } from "./reader";
import type { FoliateViewElement } from "./foliate";

type ReaderLayoutTarget = {
  root: HTMLElement;
  view: FoliateViewElement | null;
};

const READER_THEMES: ReaderTheme[] = [
  {
    id: "light",
    bodyTheme: "lofi",
    mode: "light",
    background: "#fffefd",
    foreground: "#1f2933",
    link: "#1f5f8f",
  },
  {
    id: "grey",
    bodyTheme: "corporate",
    mode: "light",
    background: "#f1f1ee",
    foreground: "#2f3438",
    link: "#4c6a7f",
  },
  {
    id: "dark",
    bodyTheme: "nord",
    mode: "dark",
    background: "#212830",
    foreground: "#e5e9f0",
    link: "#88c0d0",
  },
  {
    id: "one-dark",
    bodyTheme: "dim",
    mode: "dark",
    background: "#0f1117",
    foreground: "#d7dae0",
    link: "#61afef",
  },
];

function getReaderTheme(themeId = readerSettings.theme) {
  return READER_THEMES.find((theme) => theme.id === themeId) ?? READER_THEMES[0];
}

export function getNextReaderThemeId(themeId = readerSettings.theme) {
  const currentIndex = READER_THEMES.findIndex((theme) => theme.id === getReaderTheme(themeId).id);
  return (READER_THEMES[(currentIndex + 1) % READER_THEMES.length] ?? READER_THEMES[0]).id;
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

const MIN_READER_FONT_SIZE = 14;
const MAX_READER_FONT_SIZE = 22;
export const READER_FONT_SIZE_STEP = 0.5;
const MIN_READER_LAYOUT_LEVEL = 0;
export const READER_LAYOUT_LEVEL_STEP = 1;

const PAGINATED_GAP = "2.5%";
const PAGINATED_TWO_COLUMN_MIN_WIDTH = 1500;
const PAGINATED_THREE_COLUMN_MIN_WIDTH = 2000;

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

function getLayoutPreset(layoutLevel = readerSettings.layoutLevel) {
  return READER_LAYOUT_PRESETS[clampLayoutLevel(layoutLevel)] ?? READER_LAYOUT_PRESETS[2];
}

export function getBookStyles(themeId = readerSettings.theme): [string, string] {
  return createReaderBookStyles({
    fontSize: readerSettings.fontSize,
    layout: getLayoutPreset(),
    layoutLevel: readerSettings.layoutLevel,
    theme: getReaderTheme(themeId),
  });
}

export function applyReaderLayout({ root, view }: ReaderLayoutTarget) {
  if (!view || view.isFixedLayout) return;

  const layout = getLayoutPreset();
  const readerWidth = root.getBoundingClientRect().width;
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

export function applyReaderLayoutLevel(layoutLevel: number, target: ReaderLayoutTarget) {
  readerSettings.layoutLevel = clampLayoutLevel(layoutLevel);
  target.view?.renderer?.setStyles?.(getBookStyles());
  applyReaderLayout(target);
}

export function canChangeReaderFontSize(delta: number) {
  const currentSize = clampReaderFontSize(readerSettings.fontSize);
  return clampReaderFontSize(currentSize + delta) !== currentSize;
}

export function canChangeReaderLayoutLevel(delta: number) {
  const currentLevel = clampLayoutLevel(readerSettings.layoutLevel);
  return clampLayoutLevel(currentLevel + delta) !== currentLevel;
}

export function applyReaderFlow(flow: ReaderFlow, target: ReaderLayoutTarget) {
  readerSettings.flow = flow;
  applyReaderLayout(target);
}

export function changeReaderFlow(target: ReaderLayoutTarget) {
  if (target.view?.isFixedLayout) {
    readerSettings.flow = "paginated";
    return;
  }
  const nextFlow = readerSettings.flow === "paginated" ? "scrolled" : "paginated";
  applyReaderFlow(nextFlow, target);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
