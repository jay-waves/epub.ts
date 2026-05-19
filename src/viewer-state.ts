import type { ReaderFlow, ReaderThemeId } from "./viewer-types";

export const state = {
  flow: "paginated" as ReaderFlow,
  currentHref: "",
  currentBookKey: "",
  currentSourceUrl: "",
  readerMargin: 8,
  isRestoring: false,
  readerFontSize: 19,
  readerSpacing: 0,
  readerTheme: "light" as ReaderThemeId,
};
