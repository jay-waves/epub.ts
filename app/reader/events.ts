import type { TocItem } from "../renderer";
import type { BookInfo } from "./book-info";
import type { ReaderThemeId } from "./model";
import { createStore } from "zustand/vanilla";

export const VIEWER_EVENTS = {
  annotationClose: "reader:annotation-close",
  annotationDelete: "reader:annotation-delete",
  annotationOpen: "reader:annotation-open",
  annotationSave: "reader:annotation-save",
  unsavedChange: "reader:unsaved-change",
  translationClose: "reader:translation-close",
  translationDownload: "reader:translation-download",
  translationOpen: "reader:translation-open",
  translationUpdate: "reader:translation-update",
  dockAction: "reader:dock-action",
  dockToggle: "reader:dock-toggle",
  dockUpdate: "reader:dock-update",
  documentOpen: "reader:document-open",
  progressReturn: "reader:progress-return",
  progressSeek: "reader:progress-seek",
  progressUpdate: "reader:progress-update",
  readerCommand: "reader:command",
  searchClear: "reader:search-clear",
  searchCollect: "reader:search-collect",
  searchNext: "reader:search-next",
  searchPrevious: "reader:search-previous",
  searchUpdate: "reader:search-update",
  bookInfoOpen: "reader:book-info-open",
  bookInfoUpdate: "reader:book-info-update",
  tocOpen: "reader:toc-open",
  tocClose: "reader:toc-close",
  tocNavigate: "reader:toc-navigate",
  tocUpdate: "reader:toc-update",
  themeOpen: "reader:theme-open",
  themeSelect: "reader:theme-select",
  welcomeOpen: "reader:welcome-open",
} as const;

type TranslationStatus = "downloadable" | "error" | "loading" | "success";

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
  | "toggle-layout"
  | "open-theme"
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
  layoutLabel: string;
  hasUnsavedChanges: boolean;
  searchActive: boolean;
};

export type ReaderCommand =
  | "escape"
  | "open-search"
  | "open-toc"
  | "step-left"
  | "step-right"
  | "paginate-previous"
  | "paginate-next"
  | "save-book"
  | "toggle-dock"
  | "scroll-previous"
  | "scroll-next"
  | "zoom-in"
  | "zoom-out";

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

type ProgressUpdateDetail = {
  fraction: number;
  index?: number;
  reset?: boolean;
};

export type TocUpdateDetail = {
  currentHref: string;
  currentItem?: TocItem | null;
  items: TocItem[];
};

type TocNavigateDetail = {
  href: string;
  item: TocItem;
};

export type ViewerEventDetailMap = {
  [VIEWER_EVENTS.annotationClose]: void;
  [VIEWER_EVENTS.annotationDelete]: { value: string };
  [VIEWER_EVENTS.annotationOpen]: AnnotationDetail;
  [VIEWER_EVENTS.annotationSave]: { note: string; value: string };
  [VIEWER_EVENTS.unsavedChange]: void;
  [VIEWER_EVENTS.translationClose]: void;
  [VIEWER_EVENTS.translationDownload]: void;
  [VIEWER_EVENTS.translationOpen]: TranslationDetail;
  [VIEWER_EVENTS.translationUpdate]: TranslationDetail;
  [VIEWER_EVENTS.dockAction]: DockAction;
  [VIEWER_EVENTS.dockToggle]: void;
  [VIEWER_EVENTS.dockUpdate]: DockUpdateDetail;
  [VIEWER_EVENTS.documentOpen]: void;
  [VIEWER_EVENTS.progressReturn]: void;
  [VIEWER_EVENTS.progressSeek]: number;
  [VIEWER_EVENTS.progressUpdate]: ProgressUpdateDetail;
  [VIEWER_EVENTS.readerCommand]: ReaderCommand;
  [VIEWER_EVENTS.searchClear]: void;
  [VIEWER_EVENTS.searchCollect]: SearchCollectDetail;
  [VIEWER_EVENTS.searchNext]: void;
  [VIEWER_EVENTS.searchPrevious]: void;
  [VIEWER_EVENTS.searchUpdate]: SearchUpdateDetail;
  [VIEWER_EVENTS.bookInfoOpen]: void;
  [VIEWER_EVENTS.bookInfoUpdate]: BookInfo;
  [VIEWER_EVENTS.tocOpen]: void;
  [VIEWER_EVENTS.tocClose]: void;
  [VIEWER_EVENTS.tocNavigate]: TocNavigateDetail;
  [VIEWER_EVENTS.tocUpdate]: TocUpdateDetail;
  [VIEWER_EVENTS.themeOpen]: ReaderThemeId;
  [VIEWER_EVENTS.themeSelect]: ReaderThemeId;
  [VIEWER_EVENTS.welcomeOpen]: void;
};

const VIEWER_SIGNALS = [
  VIEWER_EVENTS.annotationClose,
  VIEWER_EVENTS.unsavedChange,
  VIEWER_EVENTS.translationClose,
  VIEWER_EVENTS.translationDownload,
  VIEWER_EVENTS.dockToggle,
  VIEWER_EVENTS.documentOpen,
  VIEWER_EVENTS.progressReturn,
  VIEWER_EVENTS.searchClear,
  VIEWER_EVENTS.searchNext,
  VIEWER_EVENTS.searchPrevious,
  VIEWER_EVENTS.bookInfoOpen,
  VIEWER_EVENTS.tocOpen,
  VIEWER_EVENTS.tocClose,
  VIEWER_EVENTS.welcomeOpen,
] as const satisfies readonly (keyof ViewerEventDetailMap)[];

type ViewerSignalName = typeof VIEWER_SIGNALS[number];
type ViewerPayloadName = Exclude<keyof ViewerEventDetailMap, ViewerSignalName>;

const viewerEvents = new EventTarget();
const STATE_EVENTS = new Set<string>([
  VIEWER_EVENTS.dockUpdate,
  VIEWER_EVENTS.progressUpdate,
  VIEWER_EVENTS.searchUpdate,
  VIEWER_EVENTS.bookInfoUpdate,
  VIEWER_EVENTS.tocUpdate,
]);

export function isViewerStateEvent(eventName: keyof ViewerEventDetailMap) {
  return STATE_EVENTS.has(eventName);
}

type ViewerStateUpdate = { detail: unknown; revision: number };
type ViewerState = { updates: Record<string, ViewerStateUpdate | undefined> };

export const viewerStore = createStore<ViewerState>(() => ({ updates: {} }));

export function emitViewerSignal(eventName: ViewerSignalName) {
  viewerEvents.dispatchEvent(new Event(eventName));
}

export function emitViewerEvent<EventName extends ViewerPayloadName>(
  eventName: EventName,
  detail: ViewerEventDetailMap[EventName],
) {
  if (STATE_EVENTS.has(eventName)) {
    viewerStore.setState((state) => ({
      updates: {
        ...state.updates,
        [eventName]: {
          detail,
          revision: (state.updates[eventName]?.revision ?? 0) + 1,
        },
      },
    }));
    return;
  }
  viewerEvents.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function listenViewerEvent<EventName extends keyof ViewerEventDetailMap>(
  eventName: EventName,
  handler: (detail: ViewerEventDetailMap[EventName]) => void,
  options?: AddEventListenerOptions,
) {
  if (STATE_EVENTS.has(eventName)) {
    if (options?.signal?.aborted) return () => {};
    let revision = viewerStore.getState().updates[eventName]?.revision ?? 0;
    const unsubscribe = viewerStore.subscribe((state) => {
      const update = state.updates[eventName];
      if (!update || update.revision === revision) return;
      revision = update.revision;
      handler(update.detail as ViewerEventDetailMap[EventName]);
    });
    options?.signal?.addEventListener("abort", unsubscribe, { once: true });
    return unsubscribe;
  }
  const listener = (event: Event) => {
    handler((event as CustomEvent<ViewerEventDetailMap[EventName]>).detail);
  };
  viewerEvents.addEventListener(eventName, listener, options);
  return () => viewerEvents.removeEventListener(eventName, listener, options);
}
