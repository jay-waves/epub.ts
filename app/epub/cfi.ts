// Project-owned EPUB CFI implementation.

type CFIStep = {
  index: number;
  id?: string;
  offset?: number;
  temporal?: number;
  spatial?: number[];
  text?: string[];
  side?: string;
};

/** A CFI path split at each `!` indirection. */
type CFIPath = CFIStep[][];

type CFIRange = {
  parent: CFIPath;
  start: CFIPath;
  end: CFIPath;
};

export type ParsedCFI = CFIPath | CFIRange;
type CFIFilter = (node: Node) => number;

type TokenType = "/" | ":" | "~" | "@" | "[" | ";s" | "!" | ",";
type Token =
  | [type: "/" | ":" | "~" | "@", value: number]
  | [type: "[" | ";s", value: string]
  | [type: "!" | ","];
type IndexedNode = Node | Node[] | "first" | "last" | "before" | "after" | null;
type NodePosition =
  | { kind: "offset"; node: Node; offset: number }
  | { kind: "boundary"; node: Node; side: "before" | "after" };

const splitAt = <T>(items: T[], indices: number[]) => {
  let start = 0;
  return [...indices, items.length].map((end) => {
    const part = items.slice(start, end);
    start = end + 1;
    return part;
  });
};

const isNumber = /\d/;
const isTokenStart = (value: string): value is "/" | ":" | "~" | "@" | "[" | "!" | "," =>
  value.length === 1 && "/:~@[!,".includes(value);
export const isCFI = /^epubcfi\((.*)\)$/;
const escapeCFI = (value: string) => value.replace(/[\^[\](),;=]/g, "^$&");
const wrap = (value: string) => isCFI.test(value) ? value : `epubcfi(${value})`;
const unwrap = (value: string) => value.match(isCFI)?.[1] ?? value;

export const joinIndir = (...parts: string[]) =>
  wrap(parts.map(unwrap).join("!"));

const tokenize = (value: string) => {
  const tokens: Token[] = [];
  let state: TokenType | ";" | `;${string}` | undefined;
  let escaped = false;
  let buffer = "";
  const pushed = () => {
    state = undefined;
    buffer = "";
  };
  const pushNumber = (type: "/" | ":" | "~" | "@", value: number) => {
    tokens.push([type, value]);
    pushed();
  };
  const pushText = (type: "[" | ";s", value: string) => {
    tokens.push([type, value]);
    pushed();
  };
  const pushSeparator = (type: "!" | ",") => {
    tokens.push([type]);
    pushed();
  };
  const append = (char: string) => {
    buffer += char;
    escaped = false;
  };

  for (const char of [...value.trim(), ""]) {
    if (char === "^" && !escaped) {
      escaped = true;
      continue;
    }
    if (state === "!") pushSeparator("!");
    else if (state === ",") pushSeparator(",");
    else if (state === "/" || state === ":") {
      if (isNumber.test(char)) {
        append(char);
        continue;
      }
      pushNumber(state, Number.parseInt(buffer));
    } else if (state === "~") {
      if (isNumber.test(char) || char === ".") {
        append(char);
        continue;
      }
      pushNumber("~", Number.parseFloat(buffer));
    } else if (state === "@") {
      if (char === ":") {
        pushNumber("@", Number.parseFloat(buffer));
        state = "@";
        continue;
      }
      if (isNumber.test(char) || char === ".") {
        append(char);
        continue;
      }
      pushNumber("@", Number.parseFloat(buffer));
    } else if (state === "[") {
      if (char === ";" && !escaped) {
        pushText("[", buffer);
        state = ";";
      } else if (char === "," && !escaped) {
        pushText("[", buffer);
        state = "[";
      } else if (char === "]" && !escaped) pushText("[", buffer);
      else append(char);
      continue;
    } else if (state?.startsWith(";")) {
      if (char === "=" && !escaped) {
        state = `;${buffer}`;
        buffer = "";
      } else if (char === ";" && !escaped) {
        if (state === ";s") pushText(";s", buffer);
        state = ";";
      } else if (char === "]" && !escaped) {
        if (state === ";s") pushText(";s", buffer);
        else {
          state = undefined;
          buffer = "";
        }
      } else append(char);
      continue;
    }
    if (isTokenStart(char)) state = char;
  }
  return tokens;
};

const findTokens = (tokens: Token[], type: TokenType) => tokens
  .flatMap(([candidate], index) => candidate === type ? [index] : []);

const parsePath = (tokens: Token[]): CFIStep[] => {
  const steps: CFIStep[] = [];
  let previousType: TokenType | undefined;
  for (const [type, value] of tokens) {
    if (type === "/") steps.push({ index: value });
    else {
      const step = steps.at(-1);
      if (!step) continue;
      if (type === ":") step.offset = value;
      else if (type === "~") step.temporal = value;
      else if (type === "@") (step.spatial ??= []).push(value);
      else if (type === ";s") step.side = value;
      else if (type === "[") {
        if (previousType === "/" && value) step.id = value;
        else (step.text ??= []).push(value);
      }
    }
    previousType = type;
  }
  return steps;
};

const parseIndirections = (tokens: Token[]): CFIPath =>
  splitAt(tokens, findTokens(tokens, "!")).map(parsePath);

export const parse = (cfi: string): ParsedCFI => {
  const tokens = tokenize(unwrap(cfi));
  const commas = findTokens(tokens, ",");
  if (!commas.length) return parseIndirections(tokens);
  const [parent, start, end] = splitAt(tokens, commas).map(parseIndirections);
  return { parent, start, end };
};

const stepToString = ({ index, id, offset, temporal, spatial, text, side }: CFIStep) => {
  const parameter = side ? `;s=${side}` : "";
  return `/${index}`
    + (id ? `[${escapeCFI(id)}${parameter}]` : "")
    + (offset != null && index % 2 ? `:${offset}` : "")
    + (temporal ? `~${temporal}` : "")
    + (spatial ? `@${spatial.join(":")}` : "")
    + (text || (!id && side)
      ? `[${text?.map(escapeCFI).join(",") ?? ""}${parameter}]`
      : "");
};

const pathToString = (path: CFIPath) =>
  path.map(steps => steps.map(stepToString).join("")).join("!");

const toString = (parsed: ParsedCFI): string => wrap(!Array.isArray(parsed)
  ? [parsed.parent, parsed.start, parsed.end].map(pathToString).join(",")
  : pathToString(parsed));

const collapse = (value: ParsedCFI, toEnd = false): CFIPath => {
  if (Array.isArray(value)) return value;
  const path = value[toEnd ? "end" : "start"];
  const parent = value.parent;
  return [
    ...parent.slice(0, -1),
    [...parent.at(-1) ?? [], ...path[0] ?? []],
    ...path.slice(1),
  ];
};

const buildRange = (from: CFIPath, to: CFIPath) => {
  const collapsedFrom = collapse(from);
  const collapsedTo = collapse(to, true);
  const localFrom = collapsedFrom.at(-1) ?? [];
  const localTo = collapsedTo.at(-1) ?? [];
  const localParent: CFIStep[] = [];
  const localStart: CFIStep[] = [];
  const localEnd: CFIStep[] = [];
  let shared = true;
  const length = Math.max(localFrom.length, localTo.length);
  for (let index = 0; index < length; index++) {
    const a = localFrom[index];
    const b = localTo[index];
    shared &&= a?.index === b?.index && a?.offset == null && b?.offset == null;
    if (shared && a) localParent.push(a);
    else {
      if (a) localStart.push(a);
      if (b) localEnd.push(b);
    }
  }
  const parent = [...collapsedFrom.slice(0, -1), localParent];
  return toString({ parent, start: [localStart], end: [localEnd] });
};

const isTextNode = (node: Node) =>
  node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
const isElementNode = (node: Node) => node.nodeType === Node.ELEMENT_NODE;
const isNode = (value: IndexedNode | undefined): value is Node =>
  value != null && typeof value !== "string" && !Array.isArray(value);

const getChildNodes = (node: Node, filter?: CFIFilter): Node[] => {
  const nodes = [...node.childNodes].filter(child => isTextNode(child) || isElementNode(child));
  if (!filter) return nodes;
  return nodes.flatMap(child => {
    const result = filter(child);
    if (result === NodeFilter.FILTER_REJECT) return [];
    if (result === NodeFilter.FILTER_SKIP) return getChildNodes(child, filter);
    return [child];
  });
};

// Child nodes are represented as [element, text chunk, element, ...].
const indexChildNodes = (node: Node, filter?: CFIFilter): IndexedNode[] => {
  const indexed: IndexedNode[] = [];
  for (const child of getChildNodes(node, filter)) {
    const last = indexed.at(-1);
    if (last == null) indexed.push(child);
    else if (isTextNode(child)) {
      if (Array.isArray(last)) last.push(child);
      else if (isNode(last) && isTextNode(last)) indexed[indexed.length - 1] = [last, child];
      else indexed.push(child);
    } else if (isNode(last) && isElementNode(last)) {
      indexed.push(null, child);
    } else indexed.push(child);
  }
  const first = indexed[0];
  if (isNode(first) && isElementNode(first)) indexed.unshift("first");
  const last = indexed.at(-1);
  if (isNode(last) && isElementNode(last)) indexed.push("last");
  indexed.unshift("before");
  indexed.push("after");
  return indexed;
};

const partsToNode = (node: Node, parts: CFIStep[], filter?: CFIFilter): NodePosition | null => {
  if (!parts.length) return null;
  const id = parts.at(-1)?.id;
  if (id) {
    const element = node.ownerDocument?.getElementById(id);
    if (element) return { kind: "offset", node: element, offset: 0 };
  }
  let current: IndexedNode = node;
  for (const { index } of parts) {
    if (!isNode(current)) return null;
    const next: IndexedNode | undefined = indexChildNodes(current, filter)[index];
    if (next === "first") return { kind: "offset", node: current.firstChild ?? current, offset: 0 };
    if (next === "last") return { kind: "offset", node: current.lastChild ?? current, offset: 0 };
    if (next === "before") return { kind: "boundary", node: current, side: "before" };
    if (next === "after") return { kind: "boundary", node: current, side: "after" };
    if (!next) return null;
    current = next;
  }
  const offset = parts.at(-1)?.offset ?? 0;
  if (isNode(current)) return { kind: "offset", node: current, offset };
  if (!Array.isArray(current)) return null;
  let consumed = 0;
  for (const text of current) {
    const length = text.nodeValue?.length ?? 0;
    if (consumed + length >= offset) return { kind: "offset", node: text, offset: offset - consumed };
    consumed += length;
  }
  return null;
};

const nodeToParts = (node: Node, offset?: number, filter?: CFIFilter): CFIStep[] => {
  let parent = node.parentNode;
  while (filter && parent
    && parent !== node.ownerDocument?.documentElement
    && filter(parent) === NodeFilter.FILTER_SKIP) parent = parent.parentNode;
  if (!parent) return [];

  const indexed = indexChildNodes(parent, filter);
  const index = indexed.findIndex(candidate => Array.isArray(candidate)
    ? candidate.includes(node)
    : candidate === node);
  const chunk = indexed[index];
  if (Array.isArray(chunk) && offset != null) {
    let adjusted = 0;
    for (const text of chunk) {
      if (text === node) {
        adjusted += offset;
        break;
      }
      adjusted += text.nodeValue?.length ?? 0;
    }
    offset = adjusted;
  }
  const step: CFIStep = {
    id: isElementNode(node) ? (node as Element).id || undefined : undefined,
    index,
    offset,
  };
  const root = node.ownerDocument?.documentElement;
  const parts = parent !== root ? [...nodeToParts(parent, undefined, filter), step] : [step];
  return parts.filter(part => part.index !== -1);
};

export const fromRange = (range: Range, filter?: CFIFilter) => {
  const start = nodeToParts(range.startContainer, range.startOffset, filter);
  if (range.collapsed) return toString([start]);
  const end = nodeToParts(range.endContainer, range.endOffset, filter);
  return buildRange([start], [end]);
};

export const toRange = (doc: Document, parsed: ParsedCFI, filter?: CFIFilter) => {
  // The supplied document owns the final path; preceding indirections locate it.
  const start = partsToNode(doc.documentElement, collapse(parsed).at(-1) ?? [], filter);
  const end = partsToNode(doc.documentElement, collapse(parsed, true).at(-1) ?? [], filter);
  if (!start?.node || !end?.node) throw new Error("CFI does not resolve to a range in this document");

  const range = doc.createRange();
  if (start.kind === "boundary") {
    if (start.side === "before") range.setStartBefore(start.node);
    else range.setStartAfter(start.node);
  } else range.setStart(start.node, start.offset);
  if (end.kind === "boundary") {
    if (end.side === "before") range.setEndBefore(end.node);
    else range.setEndAfter(end.node);
  } else range.setEnd(end.node, end.offset);
  return range;
};

// Faster way of generating CFIs for sorted sibling elements.
export const fromElements = (elements: Element[]) => {
  const parent = elements[0]?.parentNode;
  if (!parent) return [];
  const parentParts = nodeToParts(parent);
  const results: string[] = [];
  for (const [index, node] of indexChildNodes(parent).entries()) {
    const element = elements[results.length];
    if (node === element) results.push(toString([[...parentParts, { id: element.id, index }]]));
  }
  return results;
};

export const toElement = (doc: Document, parts: CFIStep[]) => {
  const node = partsToNode(doc.documentElement, parts)?.node;
  return node?.nodeType === Node.ELEMENT_NODE ? node as Element : null;
};

export const fake = {
  fromIndex: (index: number) => wrap(`/6/${(index + 1) * 2}`),
  toIndex: (parts: CFIStep[]) => (parts.at(-1)?.index ?? 0) / 2 - 1,
};
