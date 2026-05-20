import type { TocItem } from "./viewer-types";

export const VIEWER_EVENTS = {
  highlightContextAction: "reader:highlight-context-action",
  highlightContextClose: "reader:highlight-context-close",
  highlightContextOpen: "reader:highlight-context-open",
  searchClear: "reader:search-clear",
  searchCollect: "reader:search-collect",
  searchNext: "reader:search-next",
  searchOpen: "reader:search-open",
  searchPrevious: "reader:search-previous",
  searchUpdate: "reader:search-update",
  tocNavigate: "reader:toc-navigate",
  tocUpdate: "reader:toc-update",
} as const;

export type HighlightContextAction = "copy" | "delete" | "highlight" | "translate";

export type HighlightContextActionDetail = {
  action: HighlightContextAction;
};

export type HighlightContextOpenDetail = {
  canCopy: boolean;
  canDelete: boolean;
  canHighlight: boolean;
  x: number;
  y: number;
};

export type SearchCollectDetail = {
  query: string;
  highlightedOnly?: boolean;
};

export type SearchUpdateDetail = {
  canNavigate: boolean;
  countText: string;
  placeholder: string;
  visible: boolean;
};

export type TocUpdateDetail = {
  currentHref: string;
  items: TocItem[];
};

export type TocNavigateDetail = {
  href: string;
};
