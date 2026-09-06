import type { ReaderProfile } from "./types";

const DEFAULT_READER_FONT_SIZE = 18;

export function createBundledReaderProfile(
  assetUrl: (filename: string) => string,
): ReaderProfile {
  return {
    defaultFontSize: DEFAULT_READER_FONT_SIZE,
    latinFontUrl: assetUrl("EBGaramond-VariableFont_wght.ttf"),
    latinFontFormat: "truetype",
    latinItalicFontUrl: assetUrl("EBGaramond-Italic-VariableFont_wght.ttf"),
    latinItalicFontFormat: "truetype",
    monoFontUrl: assetUrl("Monaspace Argon Var.woff2"),
    monoFontFormat: "woff2-variations",
    monoFontWeight: "100 900",
    fontSizeAdjust: "none",
    lineHeightOffset: 0,
  };
}

export function openExternal(url: string) {
  try {
    const target = new URL(url, window.location.href);
    if (target.protocol !== "http:" && target.protocol !== "https:") return;
    window.open(target.href, "_blank", "noopener,noreferrer");
  } catch {
    // Ignore malformed or unsafe external targets.
  }
}
