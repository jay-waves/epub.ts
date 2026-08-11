export type Parts = unknown[] & { parent?: unknown[] };

export const isCFI: RegExp;
export function joinIndir(...parts: string[]): string;
export function parse(cfi: string): Parts;
export function collapse(parts: Parts, toEnd?: boolean): Parts;
export function compare(a: string | Parts, b: string | Parts): number;
export function fromRange(range: Range, filter?: (node: Node) => boolean): string;
export function toRange(doc: Document, parts: Parts, filter?: (node: Node) => boolean): Range;
export function fromElements(elements: Element[]): string[];
export function toElement(doc: Document, parts: unknown[]): Element | null;

export const fake: {
  fromIndex(index: number): string;
  toIndex(parts: unknown): number;
};
