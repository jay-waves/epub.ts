import type { OverlayDraw, OverlayDrawOptions } from "./shared/overlay";
import type { RenderMode } from "./shared/flow-geometry";
import type { Renderer, RendererStyles } from "./renderer";
import type { RelocateDetail } from "./shared/navigation";

export type { Renderer } from "./renderer";

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
    element?: SVGElement;
    hitTest?: (event: { x: number; y: number }) => [string, Range] | [];
  };
};

export type { ReadingPosition, RelocateDetail } from "./shared/navigation";

type ViewNavigation = {
  attach?(renderer: Renderer): void;
  cfi?(index: number, range?: Range): string;
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
  relocate: RelocateDetail;
  "show-annotation": { index: number; range?: Range; value: string };
};

export interface ReaderView<Item extends Annotation = Annotation> extends HTMLElement {
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
  readonly renderMode: RenderMode;
  navigation?: ViewNavigation;
  renderer: Renderer;
  setRenderMode: (
    mode: Exclude<RenderMode, "fixed">,
    configure?: (renderer: Renderer) => void,
  ) => Promise<void>;
  setStyles: (styles: RendererStyles) => void;
  addDecoration: (index: number, decoration: Decoration) => void;
  removeDecoration: (index: number, key: string) => void;
  destroy: () => void;
  open: (book: Book, navigation: ViewNavigation) => Promise<void>;
  addAnnotation?: (
    annotation: Item,
    remove?: boolean,
    target?: { index: number; range: Range },
  ) => Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation?: (annotation: Item) => Promise<{ index: number; label: string } | undefined>;
  showAnnotation?: (annotation: Item) => Promise<void>;
}

export type View<Item extends Annotation = Annotation> = ReaderView<Item>;
