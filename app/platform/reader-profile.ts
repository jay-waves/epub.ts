import type { ReaderProfile } from "./types";

export function createBundledReaderProfile(
  assetUrl: (filename: string) => string,
  defaultFontSize: number,
): ReaderProfile {
  return {
    defaultFontSize,
    fontFamily: "LXGW WenKai EPUB",
    fontLocalName: "LXGW WenKai",
    latinFontUrl: assetUrl("EBGaramond-VariableFont_wght.ttf"),
    latinFontFormat: "truetype",
    latinItalicFontUrl: assetUrl("EBGaramond-Italic-VariableFont_wght.ttf"),
    latinItalicFontFormat: "truetype",
    monoFontUrl: assetUrl("Monaspace Argon Var.woff2"),
    monoFontFormat: "woff2-variations",
    monoFontWeight: "100 900",
    fontSizeAdjust: "0.54",
    lineHeightOffset: 0,
  };
}

export const webReaderProfile: ReaderProfile = {
  defaultFontSize: 15,
  fontFamily: "system-ui",
  latinFontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond:vf@5.2.7/latin-wght-normal.woff2",
  latinFontFormat: "woff2-variations",
  latinItalicFontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond:vf@5.2.7/latin-wght-italic.woff2",
  latinItalicFontFormat: "woff2-variations",
  monoFontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/monaspace-argon@5.2.5/latin-400-normal.woff2",
  monoFontFormat: "woff2",
  monoFontWeight: "400",
  fontSizeAdjust: "none",
  lineHeightOffset: 0.1,
};
