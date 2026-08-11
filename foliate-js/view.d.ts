import type {
  Book as NavigationBook,
  Location,
  Navigation,
  RawLocation,
  Resolved,
} from "../app/reader/navigation";

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
  resolveHref?: (href: string) => string;
  size?: number;
  unload?: () => void;
};

export type FoliateBook = Omit<NavigationBook, "sections" | "toc"> & {
  dir?: string;
  destroy?: () => void | Promise<void>;
  metadata?: BookMetadata;
  isExternal?: (href: string) => boolean;
  sections: BookSection[];
  toc?: TocItem[];
};

export type FoliateContent = {
  doc?: Document;
  index: number;
  overlayer?: {
    element?: SVGSVGElement;
    hitTest?: (event: { x: number; y: number }) => [string | undefined, Range | undefined];
  };
};

export type FoliateRenderer = HTMLElement & {
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
  setStyles?: (cssText: string | [string, string]) => void;
  start?: number;
  viewSize?: number;
  getContents?: () => FoliateContent[];
  goTo: (target: Resolved) => Promise<unknown>;
};

export type RawRelocateDetail = RawLocation;
export type RelocateDetail = Location;

export type SearchHit = {
  cfi: string;
  excerpt?: string;
};

export type FoliateAnnotation = {
  value: string;
  color?: string;
  [key: string]: unknown;
};

export type FoliateAnnotationDrawOptions = {
  annotationValue?: string;
  color: string;
  hasNote?: boolean;
  onBadgeClick?: (event: MouseEvent) => void;
  width?: number;
};

export type FoliateAnnotationDrawFunction = (
  rects: DOMRectList,
  options?: FoliateAnnotationDrawOptions,
) => SVGElement;

export type FoliateViewEventMap<Annotation extends FoliateAnnotation = FoliateAnnotation> = {
  "create-overlay": { index: number };
  "draw-annotation": {
    annotation: Annotation;
    doc: Document;
    draw: (func: FoliateAnnotationDrawFunction, options: FoliateAnnotationDrawOptions) => void;
    range: Range;
  };
  "edge-click": { x: number };
  "external-link": { a: HTMLAnchorElement; href_: string };
  link: { a: HTMLAnchorElement; href: string };
  load: { doc: Document; index: number };
  unload: { doc: Document };
  relocate: RawRelocateDetail;
  "show-annotation": { index: number; range?: Range; value: string };
};

export interface FoliateViewElement<Annotation extends FoliateAnnotation = FoliateAnnotation> extends HTMLElement {
  addEventListener<EventName extends keyof FoliateViewEventMap<Annotation>>(
    type: EventName,
    listener: (
      this: FoliateViewElement<Annotation>,
      event: CustomEvent<FoliateViewEventMap<Annotation>[EventName]>,
    ) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  book?: FoliateBook;
  enhanceRenderedDocument?: (doc: Document, index: number, signal: AbortSignal) => Promise<void> | void;
  isFixedLayout: boolean;
  navigation?: Navigation;
  renderer: FoliateRenderer;
  clearSearch?: () => void;
  destroy: () => void;
  open: (book: FoliateBook, navigation: Navigation) => Promise<void>;
  addAnnotation?: (annotation: Annotation, remove?: boolean) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation?: (annotation: Annotation) => Promise<{ index: number; label: string } | undefined>;
  showAnnotation?: (annotation: Annotation) => Promise<void>;
  search?: (options: {
    index?: number;
    matchCase?: boolean;
    matchDiacritics?: boolean;
    query: string;
  }) => AsyncIterable<unknown>;
}
