import { queryRequired } from "./dom";

export const elements = queryRequired<{
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
  searchForm: HTMLFormElement;
  searchInput: HTMLInputElement;
  searchNav: HTMLElement;
  searchPrevButton: HTMLButtonElement;
  searchNextButton: HTMLButtonElement;
  searchCloseButton: HTMLButtonElement;
  searchCount: HTMLElement;
  tocRoot: HTMLElement;
  tocModal: HTMLDialogElement;
}>({
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
  searchForm: "#search-form",
  searchInput: "#search-input",
  searchNav: "#search-nav",
  searchPrevButton: "#search-prev-button",
  searchNextButton: "#search-next-button",
  searchCloseButton: "#search-close-button",
  searchCount: "#search-count",
  tocRoot: "#toc-root",
  tocModal: "#toc-modal",
});
