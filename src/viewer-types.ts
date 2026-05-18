export type TocItem = {
  label?: string;
  href?: string;
  subitems?: TocItem[];
  children?: TocItem[];
  items?: TocItem[];
};

export type BookMetadata = {
  title?: string | Record<string, string>;
  author?: string | { name?: string | Record<string, string> } | Array<string | { name?: string | Record<string, string> }>;
};

export type FoliateBook = {
  metadata?: BookMetadata;
  toc?: TocItem[];
};

export type FoliateRenderer = HTMLElement & {
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  setStyles?: (cssText: string) => void;
};

export type FoliateViewElement = HTMLElement & {
  book?: FoliateBook;
  renderer: FoliateRenderer;
  clearSearch?: () => void;
  close: () => void;
  init: (options: { lastLocation?: string | { fraction: number }; showTextStart?: boolean }) => Promise<void>;
  open: (input: File | string) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  goTo: (target: string | number | { fraction: number }) => Promise<void>;
  search?: (options: {
    index?: number;
    matchCase?: boolean;
    matchDiacritics?: boolean;
    query: string;
  }) => AsyncIterable<unknown>;
  select?: (target: string) => Promise<void>;
};

export type ReaderThemeMode = "light" | "dark";

export type ReaderThemeId = "light" | "grey" | "dark" | "one-dark";

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
  updatedAt: number;
};

export type ReadingHistory = Record<string, ReadingPosition>;

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
