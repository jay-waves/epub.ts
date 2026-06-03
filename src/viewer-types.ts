export type TocItem = {
  label?: string;
  href?: string;
  subitems?: TocItem[];
  children?: TocItem[];
  items?: TocItem[];
};

export type BookMetadata = {
  altIdentifier?: string | string[] | Record<string, string> | Array<string | Record<string, string>>;
  title?: string | Record<string, string>;
  author?: string | { name?: string | Record<string, string> } | Array<string | { name?: string | Record<string, string> }>;
  contributor?: unknown;
  description?: unknown;
  identifier?: string | string[] | Record<string, string> | Array<string | Record<string, string>>;
  language?: unknown;
  modified?: unknown;
  publisher?: unknown;
  published?: unknown;
  subject?: unknown;
};

export type BookSection = {
  cfi?: string;
  createDocument?: () => Promise<Document>;
  id?: number | string;
  linear?: string;
  load?: () => Promise<string | null>;
  size?: number;
  unload?: () => void;
};

export type FoliateBook = {
  dir?: string;
  metadata?: BookMetadata;
  sections?: BookSection[];
  toc?: TocItem[];
};

export type FoliateRenderer = HTMLElement & {
  atEnd?: boolean;
  atStart?: boolean;
  end?: number;
  next?: (distance?: number) => Promise<void>;
  removeAttribute(name: string): void;
  nextSection?: () => Promise<void>;
  prev?: (distance?: number) => Promise<void>;
  prevSection?: () => Promise<void>;
  setAttribute(name: string, value: string): void;
  scrollToAnchor?: (anchor: number, select?: boolean) => Promise<void>;
  scrollBy?: (dx: number, dy: number) => void;
  setStyles?: (cssText: string) => void;
  start?: number;
  viewSize?: number;
  getContents?: () => Array<{
    doc?: Document;
    index: number;
    overlayer?: {
      element?: SVGSVGElement;
      hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
    };
  }>;
};

export type FoliateViewElement = HTMLElement & {
  book?: FoliateBook;
  renderer: FoliateRenderer;
  clearSearch?: () => void;
  close: () => void;
  init: (options: { lastLocation?: string | { fraction: number }; showTextStart?: boolean }) => Promise<void>;
  open: (input: File | string) => Promise<void>;
  prev: (distance?: number) => Promise<void>;
  next: (distance?: number) => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  goTo: (target: string | number | { fraction: number }) => Promise<void>;
  addAnnotation?: (annotation: ReaderHighlight, remove?: boolean) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation?: (annotation: ReaderHighlight) => Promise<{ index: number; label: string } | undefined>;
  deselect?: () => void;
  getCFI?: (index: number, range?: Range) => string;
  getSectionFractions?: () => number[];
  showAnnotation?: (annotation: ReaderHighlight) => Promise<void>;
  search?: (options: {
    index?: number;
    matchCase?: boolean;
    matchDiacritics?: boolean;
    query: string;
  }) => AsyncIterable<unknown>;
  select?: (target: string) => Promise<void>;
};

export type ReaderThemeMode = "light" | "dark";

export type ReaderFlow = "paginated" | "scrolled";

export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark";

export type ReaderSettings = {
  flow: ReaderFlow;
  fontSize: number;
  layoutLevel: number;
  margin?: number;
  spacing?: number;
  theme: ReaderThemeId;
};

export type ReaderTheme = {
  id: ReaderThemeId;
  label: string;
  bodyTheme: string;
  mode: ReaderThemeMode;
  background: string;
  foreground: string;
  link: string;
};

export type ReadingPosition = {
  cfi?: string;
  fraction?: number;
  settings?: Partial<ReaderSettings>;
  updatedAt: number;
};

export type ReadingHistory = Record<string, ReadingPosition>;

export type ReaderHighlight = {
  value: string;
  color: string;
  kind?: "annotation" | "highlight";
  text?: string;
  note?: string;
  index?: number;
  fraction?: number;
  createdAt: number;
};

export type ReaderHighlights = Record<string, ReaderHighlight[]>;

export type RelocateDetail = {
  cfi?: string;
  fraction?: number;
  index?: number;
  location?: {
    current?: number;
    total?: number;
  };
  pageItem?: {
    label?: string;
  };
  tocItem?: TocItem;
};

export type SearchHit = {
  cfi: string;
  excerpt?: string;
};
