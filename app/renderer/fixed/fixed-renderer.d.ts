import type { Renderer } from "../renderer";

export class FixedRenderer extends HTMLElement implements Renderer {
  readonly element: HTMLElement;
  readonly mode: "fixed";
  atEnd?: boolean;
  atStart?: boolean;
  beforeRenderDocument?: Renderer["beforeRenderDocument"];
  destroy: Renderer["destroy"];
  getContents: Renderer["getContents"];
  goTo: Renderer["goTo"];
  next: Renderer["next"];
  open: Renderer["open"];
  prev: Renderer["prev"];
  setStyles: NonNullable<Renderer["setStyles"]>;
}
