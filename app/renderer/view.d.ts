import type { OverlayDraw, OverlayDrawOptions } from "./overlay";

export type TocItem = {
  label?: string;
  href?: string;
  subitems?: TocItem[];
};

type BookMetadata = {
  altIdentifier?: string | string[] | Record<string, string> | Array<string | Record<string, string>>;
  title?: string | Record<string, string>;
  author?: string | { name?: string | Record<string, string> } | Array<string | { name?: string | Record<string, string> }>;
  contributor?: unknown;
  description?: unknown;
  identifier?: string | string[] | Record<string, string> | Array<string | Record<string, string>>;
  language?: string | string[];
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
  pageSpread?: string;
  resolveHref?: (href: string) => string;
  size?: number;
  unload?: () => void;
};

export type Anchor = number | ((doc: Document) => Node | Range | number | null);

export type Resolved = { anchor?: Anchor; index: number; select?: boolean };

export type Book = {
  dir?: string;
  destroy?: () => void | Promise<void>;
  getTOCFragment?: (doc: Document, id?: string) => Element | null;
  isExternal?: (href: string) => boolean;
  landmarks?: Array<{ href?: string; type: string[] }>;
  loadText?: (path: string) => Promise<string | null>;
  metadata?: BookMetadata;
  pageList?: TocItem[];
  rendition?: { layout?: string; spread?: string; viewport?: unknown };
  resolveCFI?: (cfi: string, filter?: (node: Node) => number) => Resolved;
  resolveHref?: (href: string) => Resolved | null;
  sections: BookSection[];
  splitTOCHref?: (href?: string) => [unknown, string?] | Promise<[unknown, string?]>;
  toc?: TocItem[];
  transformTarget?: EventTarget;
};

export type Content = {
  doc?: Document;
  index: number;
  overlay?: {
    element?: SVGSVGElement;
    hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
  };
};

export type Renderer = HTMLElement & {
  atEnd?: boolean;
  atStart?: boolean;
  beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void;
  end?: number;
  next: (distance?: number) => Promise<void>;
  removeAttribute(name: string): void;
  nextSection?: () => Promise<void>;
  prev: (distance?: number) => Promise<void>;
  prevSection?: () => Promise<void>;
  setAttribute(name: string, value: string): void;
  scrollToAnchor?: (anchor: number, select?: boolean) => Promise<void>;
  scrollBy?: (dx: number, dy: number) => void;
  settle?: (velocityX: number, velocityY: number) => void;
  setStyles?: (cssText: string | [string, string]) => void;
  start?: number;
  viewSize?: number;
  getContents?: () => Content[];
  goTo: (target: Resolved) => Promise<unknown>;
};

export type RawRelocateDetail = {
  fraction?: number;
  index: number;
  range?: Range;
  reason?: string;
  size?: number;
};

type ViewNavigation = {
  go(target: string, options?: { select?: boolean }): Promise<Resolved>;
  label(index: number): string;
  resolve(target: string): Resolved | undefined;
};

export type Annotation = {
  value: string;
  color?: string;
  [key: string]: unknown;
};

export type Decoration = {
  draw: OverlayDraw;
  drawOptions?: OverlayDrawOptions;
  key: string;
  target: string | Anchor;
};

type ViewEvents<Item extends Annotation = Annotation> = {
  "create-overlay": { index: number };
  "draw-annotation": {
    annotation: Item;
    doc: Document;
    draw: <Options extends OverlayDrawOptions>(func: OverlayDraw<Options>, options?: Options) => void;
    range: Range;
  };
  load: { doc: Document; index: number };
  unload: { doc: Document };
  relocate: RawRelocateDetail;
  "show-annotation": { index: number; range?: Range; value: string };
};

export interface View<Item extends Annotation = Annotation> extends HTMLElement {
  addEventListener<EventName extends keyof ViewEvents<Item>>(
    type: EventName,
    listener: (
      this: View<Item>,
      event: CustomEvent<ViewEvents<Item>[EventName]>,
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  book?: Book;
  enhanceRenderedDocument?: (doc: Document, index: number, signal: AbortSignal) => Promise<void> | void;
  isFixedLayout: boolean;
  navigation?: ViewNavigation;
  renderer: Renderer;
  addDecoration: (index: number, decoration: Decoration) => void;
  removeDecoration: (index: number, key: string) => void;
  destroy: () => void;
  open: (book: Book, navigation: ViewNavigation) => Promise<void>;
  addAnnotation?: (annotation: Item, remove?: boolean) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation?: (annotation: Item) => Promise<{ index: number; label: string } | undefined>;
  showAnnotation?: (annotation: Item) => Promise<void>;
}
