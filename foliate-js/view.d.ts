export type TocItem = {
  label?: string;
  href?: string;
  subitems?: TocItem[];
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
  beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void;
  end?: number;
  next?: (distance?: number) => Promise<void>;
  removeAttribute(name: string): void;
  nextSection?: () => Promise<void>;
  prev?: (distance?: number) => Promise<void>;
  prevSection?: () => Promise<void>;
  setAttribute(name: string, value: string): void;
  scrollToAnchor?: (anchor: number, select?: boolean) => Promise<void>;
  scrollBy?: (dx: number, dy: number) => void;
  setStyles?: (cssText: string | [string, string]) => void;
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

export type RelocateDetail = {
  cfi?: string;
  fraction?: number;
  index: number;
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

export type FoliateAnnotation = {
  value: string;
  color?: string;
  [key: string]: unknown;
};

export type FoliateViewElement = HTMLElement & {
  book?: FoliateBook;
  enhanceDocument?: (doc: Document, index: number) => Promise<void> | void;
  enhanceRenderedDocument?: (doc: Document, index: number) => Promise<void> | void;
  renderer: FoliateRenderer;
  clearSearch?: () => void;
  close: () => void;
  init: (options: { lastLocation?: string | { fraction: number }; showTextStart?: boolean }) => Promise<void>;
  open: (input: File | string) => Promise<void>;
  prev: (distance?: number) => Promise<void>;
  resolveNavigation?: (target: string) => {
    anchor?: (doc: Document) => Node | Range;
    index: number;
  } | undefined;
  next: (distance?: number) => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  goTo: (target: string | number | { fraction: number }) => Promise<void>;
  addAnnotation?: (annotation: FoliateAnnotation, remove?: boolean) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation?: (annotation: FoliateAnnotation) => Promise<{ index: number; label: string } | undefined>;
  deselect?: () => void;
  getCFI?: (index: number, range?: Range) => string;
  getSectionFractions?: () => number[];
  showAnnotation?: (annotation: FoliateAnnotation) => Promise<void>;
  search?: (options: {
    index?: number;
    matchCase?: boolean;
    matchDiacritics?: boolean;
    query: string;
  }) => AsyncIterable<unknown>;
  select?: (target: string) => Promise<void>;
};
