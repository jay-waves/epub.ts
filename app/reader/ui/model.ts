import type { TocItem } from "../../renderer";
import type { BookInfo } from "../book-info";
import type { TypographyThemeId } from "../../typography/model";

export type AnnotationDetail = {
  note: string;
  sourceText: string;
  value: string;
  x: number;
  y: number;
};

export type ContentContextAction =
  | "annotate"
  | "copy"
  | "delete"
  | "highlight"
  | "lookup"
  | "translate";

export type ContentContextMenu = {
  canAnnotate: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canHighlight: boolean;
  canLookUp: boolean;
  canTranslate: boolean;
  x: number;
  y: number;
};

export type ContentContextMenuDetail = {
  menu: ContentContextMenu;
  onAction: (action: ContentContextAction) => void;
  onClose: () => void;
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

export type DockState = {
  canSearch: boolean;
  layoutLabel: string;
  hasUnsavedChanges: boolean;
  searchActive: boolean;
};

export type ProgressUpdate = {
  fraction: number;
  index?: number;
  reset?: boolean;
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

export type SearchState = {
  hitCount: number;
  hitIndex: number;
  placeholder: string;
  visible: boolean;
};

export type TocState = {
  currentHref: string;
  currentItem?: TocItem | null;
  items: TocItem[];
};

export type TranslationDetail = {
  message?: string;
  progress?: number;
  sourceLanguage?: string;
  sourceText: string;
  status: "downloadable" | "error" | "loading" | "success";
  targetLanguage: string;
  translatedText?: string;
  x: number;
  y: number;
};

export type ReaderUiState = {
  annotation: AnnotationDetail | null;
  bookInfo: BookInfo;
  bookInfoOpen: boolean;
  contextMenu: ContentContextMenuDetail | null;
  dock: DockState;
  dockOpen: boolean;
  progress: ProgressUpdate;
  progressReturnRequest: number;
  search: SearchState;
  theme: TypographyThemeId | null;
  toc: TocState;
  tocOpen: boolean;
  translation: TranslationDetail | null;
  welcome: boolean;
};

export type ReaderUiActions = {
  closeAnnotation: () => void;
  closeBookInfo: () => void;
  closeContextMenu: () => void;
  closeSearch: () => void;
  closeTheme: () => void;
  closeToc: () => void;
  closeTranslation: () => void;
  collectSearch: (query: string, highlightedOnly: boolean) => void;
  deleteAnnotation: (value: string) => void;
  downloadTranslation: () => void;
  navigateToc: (item: TocItem) => void;
  nextSearchResult: () => void;
  openLocalFile: (file: File) => void;
  pickLocalFile?: () => Promise<void>;
  previousSearchResult: () => void;
  runDockAction: (action: DockAction) => void;
  seek: (progress: number) => void;
  selectTheme: (theme: TypographyThemeId) => void;
  setDockOpen: (open: boolean) => void;
  updateAnnotation: (note: string) => void;
};
