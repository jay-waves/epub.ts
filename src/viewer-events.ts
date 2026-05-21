import type { TocItem } from "./viewer-types";

export const VIEWER_EVENTS = {
  contentEdgeClick: "reader:content-edge-click",
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
export type PageTurnDirection = "left" | "right";
export type ContentEdgeClickDetail = {
  x: number;
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

export type DockUpdateDetail = {
  canExport: boolean;
  canSearch: boolean;
  flowActive: boolean;
  flowLabel: string;
  searchActive: boolean;
  themeActive: boolean;
  themeCount: string;
};

export type SearchCollectDetail = {
  query: string;
  highlightedOnly?: boolean;
};

export type SearchUpdateDetail = {
  hitCount: number;
  hitIndex: number;
  placeholder: string;
  visible: boolean;
};

export type TocUpdateDetail = {
  currentHref: string;
  items: TocItem[];
};

export type ViewerEventDetailMap = {
  [VIEWER_EVENTS.contentEdgeClick]: ContentEdgeClickDetail;
  [VIEWER_EVENTS.highlightContextAction]: HighlightContextAction;
  [VIEWER_EVENTS.highlightContextClose]: void;
  [VIEWER_EVENTS.highlightContextOpen]: HighlightContextOpenDetail;
  [VIEWER_EVENTS.dockAction]: DockAction;
  [VIEWER_EVENTS.dockUpdate]: DockUpdateDetail;
  [VIEWER_EVENTS.pageTurn]: PageTurnDirection;
  [VIEWER_EVENTS.searchClear]: void;
  [VIEWER_EVENTS.searchCollect]: SearchCollectDetail;
  [VIEWER_EVENTS.searchNext]: void;
  [VIEWER_EVENTS.searchOpen]: void;
  [VIEWER_EVENTS.searchPrevious]: void;
  [VIEWER_EVENTS.searchUpdate]: SearchUpdateDetail;
  [VIEWER_EVENTS.tocOpen]: void;
  [VIEWER_EVENTS.tocNavigate]: string;
  [VIEWER_EVENTS.tocUpdate]: TocUpdateDetail;
};

export function emitViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  ...detail: ViewerEventDetailMap[EventName] extends void ? [] : [ViewerEventDetailMap[EventName]]
) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: detail[0] }));
}

export function listenViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<ViewerEventDetailMap[EventName]>).detail);
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
