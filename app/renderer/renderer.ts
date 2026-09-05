import type { Book, Content, ResolvedNavigationTarget } from "./reader-view.js";
export type RendererStyles = readonly [before: string, main: string];

interface RendererBase extends HTMLElement {
  readonly atEnd: boolean;
  readonly atStart: boolean;
  beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void;
  cancelNavigation?(): void;
  capturePosition?(): void;
  destroy(): void;
  getContents(): Content[];
  goTo(target: ResolvedNavigationTarget): Promise<void>;
  next(distance?: number): Promise<void>;
  nextPage?(): Promise<void>;
  open(book: Book): void | Promise<void>;
  prev(distance?: number): Promise<void>;
  prevPage?(): Promise<void>;
  panBy?(dx: number, dy: number): void;
  setStyles?(styles: RendererStyles, options?: { reflow?: boolean }): void;
  settle?(velocityX: number, velocityY: number): void;
}

export interface FixedLayoutRenderer extends RendererBase {
  readonly mode: "fixed";
}

export interface ReflowableRenderer extends RendererBase {
  readonly mode: "paginated" | "scrolled";
  readonly end: number;
  readonly start: number;
  readonly viewSize: number;
  cancelNavigation(): void;
  capturePosition(): void;
  panBy(dx: number, dy: number): void;
  setStyles(styles: RendererStyles, options?: { reflow?: boolean }): void;
}

export type Renderer = FixedLayoutRenderer | ReflowableRenderer;
