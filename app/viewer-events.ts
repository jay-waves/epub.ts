import type { TocItem } from "./foliate";
import type { BookInfo } from "./book-info";

export const VIEWER_EVENTS = {
  highlightContextAction: "reader:highlight-context-action",
  highlightContextClose: "reader:highlight-context-close",
  highlightContextOpen: "reader:highlight-context-open",
  annotationClose: "reader:annotation-close",
  annotationDelete: "reader:annotation-delete",
  annotationOpen: "reader:annotation-open",
  annotationSave: "reader:annotation-save",
  unsavedChange: "reader:unsaved-change",
  translationClose: "reader:translation-close",
  translationOpen: "reader:translation-open",
  translationUpdate: "reader:translation-update",
  dockAction: "reader:dock-action",
  dockUpdate: "reader:dock-update",
  documentOpen: "reader:document-open",
  pageTurn: "reader:page-turn",
  searchClear: "reader:search-clear",
  searchCollect: "reader:search-collect",
  searchNext: "reader:search-next",
  searchOpen: "reader:search-open",
  searchPrevious: "reader:search-previous",
  searchUpdate: "reader:search-update",
  bookInfoOpen: "reader:book-info-open",
  bookInfoUpdate: "reader:book-info-update",
  tocOpen: "reader:toc-open",
  tocNavigate: "reader:toc-navigate",
  tocUpdate: "reader:toc-update",
} as const;

export type HighlightContextAction = "annotate" | "copy" | "delete" | "highlight" | "translate";
type TranslationStatus = "error" | "loading" | "success";
export type PageTurnDirection = "left" | "right";

export type HighlightContextOpenDetail = {
  canCopy: boolean;
  canDelete: boolean;
  canHighlight: boolean;
  kind: "media" | "text";
  x: number;
  y: number;
};

export type TranslationDetail = {
  message?: string;
  progress?: number;
  sourceLanguage?: string;
  sourceText: string;
  status: TranslationStatus;
  targetLanguage: string;
  translatedText?: string;
  x: number;
  y: number;
};

export type AnnotationDetail = {
  note: string;
  sourceText: string;
  value: string;
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
  | "save-book"
  | "toggle-search"
  | "open-info"
  | "open-toc";

export type DockUpdateDetail = {
  canSearch: boolean;
  flowActive: boolean;
  flowLabel: string;
  hasUnsavedChanges: boolean;
  searchActive: boolean;
};

type SearchCollectDetail = {
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
  [VIEWER_EVENTS.highlightContextAction]: HighlightContextAction;
  [VIEWER_EVENTS.highlightContextClose]: void;
  [VIEWER_EVENTS.highlightContextOpen]: HighlightContextOpenDetail;
  [VIEWER_EVENTS.annotationClose]: void;
  [VIEWER_EVENTS.annotationDelete]: { value: string };
  [VIEWER_EVENTS.annotationOpen]: AnnotationDetail;
  [VIEWER_EVENTS.annotationSave]: { note: string; value: string };
  [VIEWER_EVENTS.unsavedChange]: void;
  [VIEWER_EVENTS.translationClose]: void;
  [VIEWER_EVENTS.translationOpen]: TranslationDetail;
  [VIEWER_EVENTS.translationUpdate]: TranslationDetail;
  [VIEWER_EVENTS.dockAction]: DockAction;
  [VIEWER_EVENTS.dockUpdate]: DockUpdateDetail;
  [VIEWER_EVENTS.documentOpen]: void;
  [VIEWER_EVENTS.pageTurn]: PageTurnDirection;
  [VIEWER_EVENTS.searchClear]: void;
  [VIEWER_EVENTS.searchCollect]: SearchCollectDetail;
  [VIEWER_EVENTS.searchNext]: void;
  [VIEWER_EVENTS.searchOpen]: void;
  [VIEWER_EVENTS.searchPrevious]: void;
  [VIEWER_EVENTS.searchUpdate]: SearchUpdateDetail;
  [VIEWER_EVENTS.bookInfoOpen]: void;
  [VIEWER_EVENTS.bookInfoUpdate]: BookInfo;
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
