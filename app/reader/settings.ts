import { createBookStyles } from "../typography/styles/book-styles";
import { readerSettings } from "./model";
import type { ReaderFlow, ReaderTheme, ReaderThemeId } from "./model";
import type { TypographyFonts, TypographyTextAlignment } from "../typography/model";
import type { ReaderView } from "./model";
import type { Renderer } from "../renderer";

type ReaderLayoutTarget = {
  view: ReaderView | null;
};

const READER_THEMES: ReaderTheme[] = [
  {
    id: "light",
    bodyTheme: "lofi",
    mode: "light",
    background: "#fffefd",
    foreground: "#1f2933",
    link: "#1f5f8f",
    primary: "#2563eb",
    secondary: "#f4c430",
    secondaryInk: "#1f2933",
  },
  {
    id: "grey",
    bodyTheme: "corporate",
    mode: "light",
    background: "#f1f1ee",
    foreground: "#2f3438",
    link: "#4c6a7f",
    primary: "#5f8f86",
    secondary: "#78a79f",
    secondaryInk: "#2d332f",
  },
  {
    id: "dark",
    bodyTheme: "nord",
    mode: "dark",
    background: "#212830",
    foreground: "#e5e9f0",
    link: "#88c0d0",
    primary: "#88c0d0",
    secondary: "#5e81ac",
    secondaryInk: "#eceff4",
  },
  {
    id: "one-dark",
    bodyTheme: "dim",
    mode: "dark",
    background: "#0f1117",
    foreground: "#d7dae0",
    link: "#61afef",
    primary: "#61afef",
    secondary: "#56b6c2",
    secondaryInk: "#0f1117",
  },
  {
    id: "gruvbox",
    bodyTheme: "coffee",
    mode: "dark",
    background: "#2d2c2a",
    foreground: "#ebdbb2",
    link: "#c7ce94",
    primary: "#c7ce94",
    secondary: "#c9b77a",
    secondaryInk: "#2d2c2a",
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
  document.documentElement.style.setProperty("--reader-accent-primary", theme.primary);
  document.documentElement.style.setProperty("--reader-accent-secondary", theme.secondary);
  document.documentElement.style.setProperty("--reader-annotation-color", theme.secondary);
  document.documentElement.style.setProperty("--reader-comment-color", theme.secondary);
  document.documentElement.style.setProperty("--reader-comment-ink", theme.secondaryInk);
  document.documentElement.style.setProperty("--reader-search-outline", theme.secondary);
  document.documentElement.style.setProperty("--reader-search-current", theme.primary);
  document.documentElement.style.setProperty(
    "--reader-search-current-fill",
    `color-mix(in srgb, ${theme.primary} 24%, transparent)`,
  );
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
const READER_LAYOUT_MODE_ORDER: ReaderFlow[] = ["paginated", "scrolled"];
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
  return createBookStyles({
    fonts: readerSettings.fonts,
    fontSize: readerSettings.fontSize,
    layout: getLayoutPreset(),
    layoutLevel: readerSettings.layoutLevel,
    theme: getReaderTheme(themeId),
    textAlignment: readerSettings.textAlignment,
  });
}

export function applyReaderLayout({ view }: ReaderLayoutTarget) {
  if (!view || view.renderMode === "fixed") return;

  configureReaderRenderer(view.renderer, readerSettings.layoutMode);
}

function configureReaderRenderer(renderer: Renderer, flow: ReaderFlow) {
  const layout = getLayoutPreset();
  const element = renderer.element;
  element.setAttribute("gap", flow === "paginated" ? PAGINATED_GAP : "1.5%");
  element.setAttribute("animated", "");
  if (flow === "paginated") {
    element.setAttribute("margin", `${layout.margin}px`);
    element.setAttribute("max-inline-size", `${layout.singleColumnMaxInlineSize}px`);
    element.setAttribute("max-column-inline-size", `${layout.multiColumnMaxInlineSize}px`);
    // Keep the visible spread count independent from the chosen text width.
    // Otherwise Zoom out can make a second off-screen column fit and silently
    // turn a single-page viewport into a multi-page canvas.
    element.setAttribute("max-column-count", "3");
    return;
  }

  element.setAttribute("margin", `${SCROLLED_LAYOUT_WIDTH_BASELINE.margin}px`);
  element.setAttribute("max-inline-size", `${SCROLLED_LAYOUT_WIDTH_BASELINE.singleColumnMaxInlineSize}px`);
  element.removeAttribute("max-column-inline-size");
  element.removeAttribute("max-column-count");
}

function clampReaderFontSize(fontSize: number) {
  return clamp(fontSize, MIN_READER_FONT_SIZE, MAX_READER_FONT_SIZE);
}

function clampLayoutLevel(layoutLevel: number) {
  return clamp(Math.round(layoutLevel), MIN_READER_LAYOUT_LEVEL, MAX_READER_LAYOUT_LEVEL);
}

export function applyReaderFontSize(fontSize: number, view?: ReaderView | null) {
  readerSettings.fontSize = clampReaderFontSize(fontSize);
  view?.setStyles(getBookStyles());
}

export function applyReaderFonts(fonts: TypographyFonts, view?: ReaderView | null) {
  readerSettings.fonts = fonts;
  view?.setStyles(getBookStyles());
}

export function applyReaderTextAlignment(alignment: TypographyTextAlignment, view?: ReaderView | null) {
  readerSettings.textAlignment = alignment;
  view?.setStyles(getBookStyles());
}

export function applyReaderLayoutLevel(layoutLevel: number, target: ReaderLayoutTarget) {
  readerSettings.layoutLevel = clampLayoutLevel(layoutLevel);
  target.view?.setStyles(getBookStyles());
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

export async function applyReaderLayoutMode(mode: ReaderFlow, target: ReaderLayoutTarget) {
  readerSettings.layoutMode = mode;
  const { view } = target;
  if (view && view.renderMode !== "fixed" && view.renderMode !== mode) {
    await view.setRenderMode(mode, (renderer) => {
      configureReaderRenderer(renderer, mode);
      renderer.setStyles?.(getBookStyles());
    });
    return;
  }
  applyReaderLayout(target);
}

export async function changeReaderLayoutMode(target: ReaderLayoutTarget) {
  if (target.view?.renderMode === "fixed") {
    readerSettings.layoutMode = "paginated";
    return;
  }
  const index = READER_LAYOUT_MODE_ORDER.indexOf(readerSettings.layoutMode);
  const nextMode = READER_LAYOUT_MODE_ORDER[(index + 1) % READER_LAYOUT_MODE_ORDER.length] ?? "paginated";
  await applyReaderLayoutMode(nextMode, target);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
