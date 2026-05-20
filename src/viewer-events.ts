import type { TocItem } from "./viewer-types";

export const VIEWER_EVENTS = {
  highlightContextAction: "reader:highlight-context-action",
  highlightContextClose: "reader:highlight-context-close",
  highlightContextOpen: "reader:highlight-context-open",
  dockAction: "reader:dock-action",
  dockUpdate: "reader:dock-update",
  pageTurn: "reader:page-turn",
  searchClear: "reader:search-clear",
  searchCollect: "reader:search-collect",
  searchNext: "reader:search-next",
  searchOpen: "reader:search-open",
  searchPrevious: "reader:search-previous",
  searchUpdate: "reader:search-update",
  tocOpen: "reader:toc-open",
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

export type DockAction =
  | "toggle-flow"
  | "toggle-theme"
  | "decrease-font"
  | "increase-font"
  | "decrease-width"
  | "increase-width"
  | "toggle-search"
  | "open-toc"
  | "export";

export type DockActionDetail = {
  action: DockAction;
};

export type DockUpdateDetail = {
  canExport: boolean;
  canSearch: boolean;
  flowActive: boolean;
  flowLabel: string;
  searchActive: boolean;
  themeActive: boolean;
  themeCount: string;
  themeLabel: string;
};

export type PageTurnDirection = "left" | "right";

export type PageTurnDetail = {
  direction: PageTurnDirection;
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
