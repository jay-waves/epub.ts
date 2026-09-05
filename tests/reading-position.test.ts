import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorForPosition,
  clampFraction,
  createReadingPosition,
  fractionAnchor,
  isFractionAnchor,
  readingEdgeRange,
  resolveSectionAnchor,
  resolveReadingPosition,
  resolveSemanticTarget,
  uncollapseRange,
} from "../app/renderer/shared/navigation.ts";

test("normalizes every reading position to a section fraction", () => {
  assert.equal(clampFraction(-0.5), 0);
  assert.equal(clampFraction(1.5), 1);
  assert.equal(clampFraction(Number.NaN, 0.25), 0.25);
  assert.deepEqual(createReadingPosition(3, undefined), { index: 3, fraction: 0 });
});

test("keeps fractional and DOM anchors distinct while resolving navigation", () => {
  const doc = {} as Document;
  const element = {} as Element;

  assert.deepEqual(fractionAnchor(-0.5), { kind: "fraction", fraction: 0 });
  assert.deepEqual(fractionAnchor(1.5), { kind: "fraction", fraction: 1 });
  assert.equal(isFractionAnchor(fractionAnchor(0.4)), true);
  assert.deepEqual(resolveSectionAnchor(undefined, doc), fractionAnchor(0));
  assert.equal(resolveSectionAnchor(() => element, doc), element);
  assert.deepEqual(resolveSectionAnchor(() => null, doc), fractionAnchor(0));
});

test("uses a DOM range only for its owning live section document", () => {
  const node = {} as Node;
  const document = {
    contains: (candidate: Node) => candidate === node,
  } as Document;
  Object.assign(node, { ownerDocument: document });
  const clone = { cloned: true, collapse: () => {} };
  const range = {
    startContainer: node,
    endContainer: node,
    cloneRange: () => clone,
  } as unknown as Range;
  const position = createReadingPosition(2, 0.4, range);

  assert.equal(anchorForPosition(position, 2, document), clone);
  assert.deepEqual(anchorForPosition(position, 1, document), fractionAnchor(0));
  assert.deepEqual(
    anchorForPosition(position, 2, { contains: () => false } as Document),
    fractionAnchor(0.4),
  );
});

test("keeps a measured range when navigation prefers only a fraction", () => {
  const range = { marker: "visible edge" } as unknown as Range;
  const measured = createReadingPosition(5, 0.2, range);

  assert.deepEqual(resolveReadingPosition(measured, { index: 5, fraction: 0.6 }), {
    index: 5,
    fraction: 0.6,
    range,
  });
  assert.deepEqual(resolveReadingPosition(measured, { index: 6, fraction: 0 }), {
    index: 6,
    fraction: 0,
  });
});

test("uses a collapsed clone as the transferable reading edge", () => {
  let collapsed = false;
  const clone = { collapse: (toStart: boolean) => collapsed = toStart } as Range;
  const range = { cloneRange: () => clone } as Range;

  assert.equal(readingEdgeRange(range), clone);
  assert.equal(collapsed, true);
  assert.equal(readingEdgeRange(undefined), undefined);
});

test("transfers layout modes by CFI with the current section fraction as fallback", () => {
  const anchor = () => null;
  const resolve = (cfi: string) => cfi === "epubcfi(/6/8)"
    ? { index: 3, anchor }
    : undefined;

  const position = { index: 3, fraction: 0.6 };
  assert.deepEqual(resolveSemanticTarget(position, "epubcfi(/6/8)", resolve), {
    index: 3,
    anchor,
  });
  const fallback = { index: 3, anchor: fractionAnchor(0.6) };
  assert.deepEqual(resolveSemanticTarget(position, "invalid", resolve), fallback);
  assert.deepEqual(resolveSemanticTarget(position, undefined, resolve), fallback);
});

test("measuring a collapsed text anchor expands a copy without changing the saved point", () => {
  const previousNode = globalThis.Node;
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1 },
  });
  try {
    const text = { nodeType: 3, nodeValue: "ab" } as Node;
    const forward = {
      collapsed: true,
      endContainer: text,
      endOffset: 1,
      setEnd(_node: Node, offset: number) { this.endOffset = offset; },
      startContainer: text,
      cloneRange() { return { ...this }; },
    } as unknown as Range;
    const expandedForward = uncollapseRange(forward) as Range;
    assert.notEqual(expandedForward, forward);
    assert.equal(expandedForward.endOffset, 2);
    assert.equal(forward.endOffset, 1);

    const backward = {
      collapsed: true,
      endContainer: text,
      endOffset: 2,
      startOffset: 2,
      setStart(_node: Node, offset: number) { this.startOffset = offset; },
      startContainer: text,
      cloneRange() { return { ...this }; },
    } as unknown as Range;
    const expandedBackward = uncollapseRange(backward) as Range;
    assert.notEqual(expandedBackward, backward);
    assert.equal(expandedBackward.startOffset, 1);
    assert.equal(backward.startOffset, 2);
  } finally {
    if (previousNode) Object.defineProperty(globalThis, "Node", { configurable: true, value: previousNode });
    else delete (globalThis as { Node?: unknown }).Node;
  }
});
