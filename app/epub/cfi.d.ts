export type Parts = unknown[] & { parent?: unknown[] };

export const isCFI: RegExp;
export function joinIndir(...parts: string[]): string;
export function parse(cfi: string): Parts;
export function fromRange(range: Range, filter?: (node: Node) => number): string;
export function toRange(doc: Document, parts: Parts, filter?: (node: Node) => number): Range;
export function fromElements(elements: Element[]): string[];
export function toElement(doc: Document, parts: unknown[]): Element | null;

export const fake: {
  fromIndex(index: number): string;
  toIndex(parts: unknown): number;
};
