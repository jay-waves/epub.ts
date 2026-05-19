import { queryRequired } from "./dom";

export type ViewerElements = {
  readerRoot: HTMLDivElement;
  toggleFlowButton: HTMLButtonElement;
  toggleThemeButton: HTMLButtonElement;
  themeCount: HTMLElement;
  decreaseFontButton: HTMLButtonElement;
  increaseFontButton: HTMLButtonElement;
  decreaseWidthButton: HTMLButtonElement;
  increaseWidthButton: HTMLButtonElement;
  openSearchButton: HTMLButtonElement;
  openTocButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  pageLeftZone: HTMLButtonElement;
  pageRightZone: HTMLButtonElement;
  readingProgress: HTMLElement;
  readingProgressTrack: HTMLElement;
  readingProgressFill: HTMLElement;
  readingProgressLabel: HTMLElement;
  tocRoot: HTMLElement;
  tocModal: HTMLDialogElement;
};

export function getViewerElements() {
  return queryRequired<ViewerElements>({
    readerRoot: "#reader-root",
    toggleFlowButton: "#toggle-flow-button",
    toggleThemeButton: "#toggle-theme-button",
    themeCount: "#theme-count",
    decreaseFontButton: "#decrease-font-button",
    increaseFontButton: "#increase-font-button",
    decreaseWidthButton: "#decrease-width-button",
    increaseWidthButton: "#increase-width-button",
    openSearchButton: "#open-search-button",
    openTocButton: "#open-toc-button",
    exportButton: "#export-button",
    pageLeftZone: "#page-left-zone",
    pageRightZone: "#page-right-zone",
    readingProgress: "#reading-progress",
    readingProgressTrack: ".reader-progress-track",
    readingProgressFill: "#reading-progress-fill",
    readingProgressLabel: "#reading-progress-label",
    tocRoot: "#toc-root",
    tocModal: "#toc-modal",
  });
}
