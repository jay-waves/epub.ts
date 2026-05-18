import type { ReaderThemeId } from "./viewer-types";

export const state = {
  flow: "paginated" as "paginated" | "scrolled",
  currentHref: "",
  currentBookKey: "",
  currentSourceUrl: "",
  readerMargin: 8,
  isRestoring: false,
  readerFontSize: 19,
  readerSpacing: 0,
  readerTheme: "light" as ReaderThemeId,
};
