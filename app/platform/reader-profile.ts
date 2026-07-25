import type { ReaderProfile } from "./types";

export function createBundledReaderProfile(
  assetUrl: (filename: string) => string,
  defaultFontSize: number,
): ReaderProfile {
  return {
    defaultFontSize,
    fontFamily: "LXGW WenKai EPUB",
    fontUrl: assetUrl("LXGWWenKaiLite-Regular.ttf"),
    fontFormat: "truetype",
    latinFontUrl: assetUrl("EBGaramond-VariableFont_wght.ttf"),
    latinFontFormat: "truetype",
    monoFontUrl: assetUrl("Monaspace Argon Var.ttf"),
    monoFontFormat: "truetype",
    monoFontWeight: "100 900",
    fontSizeAdjust: "0.54",
    lineHeightOffset: 0,
  };
}

export const webReaderProfile: ReaderProfile = {
  defaultFontSize: 15,
  fontFamily: "system-ui",
  fontFormat: "truetype",
  latinFontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond:vf@5.2.7/latin-wght-normal.woff2",
  latinFontFormat: "woff2-variations",
  monoFontUrl: "https://cdn.jsdelivr.net/fontsource/fonts/monaspace-argon@5.2.5/latin-400-normal.woff2",
  monoFontFormat: "woff2",
  monoFontWeight: "400",
  fontSizeAdjust: "none",
  lineHeightOffset: 0.1,
};
