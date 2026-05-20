import type { ReaderFlow, ReaderThemeId } from "./viewer-types";

export const state = {
  flow: "paginated" as ReaderFlow,
  currentHref: "",
  currentBookKey: "",
  currentSourceUrl: "",
  isRestoring: false,
  readerFontSize: 19,
  readerLayoutLevel: 2,
  readerTheme: "light" as ReaderThemeId,
};
