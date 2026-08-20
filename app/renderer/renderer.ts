import type { Book, Content, Resolved } from "./reader-view.js";
import type { RenderMode } from "./shared/flow-geometry";

export type RendererStyles = string | [string, string];

export interface Renderer {
  readonly element: HTMLElement;
  readonly mode: RenderMode;
  atEnd?: boolean;
  atStart?: boolean;
  beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void;
  end?: number;
  start?: number;
  viewSize?: number;
  destroy(): void;
  getContents(): Content[];
  goTo(target: Resolved): Promise<unknown>;
  next(distance?: number): Promise<void>;
  nextPage?(): Promise<void>;
  open(book: Book): void | Promise<void>;
  prev(distance?: number): Promise<void>;
  prevPage?(): Promise<void>;
  panBy?(dx: number, dy: number): void;
  scrollToAnchor?(anchor: number, select?: boolean): Promise<void>;
  setStyles?(styles: RendererStyles): void;
  settle?(velocityX: number, velocityY: number): void;
}
