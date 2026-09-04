import assert from "node:assert/strict";
import test from "node:test";

import {
  claimReaderPointer,
  consumeReaderPointerClaim,
} from "../app/reader/interaction-arbiter.ts";

test("a descendant highlight claim supersedes a retargeted content claim", () => {
  const previousNode = globalThis.Node;
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1 },
  });

  try {
    const ownerDocument = {} as Document;
    const target = { nodeType: 1, ownerDocument } as Element;
    const pointer = { pointerId: 7, target } as PointerEvent;

    assert.equal(claimReaderPointer(pointer, "content"), "content");
    assert.equal(claimReaderPointer(pointer, "highlight"), "highlight");
    assert.equal(consumeReaderPointerClaim(pointer), "highlight");
    assert.equal(consumeReaderPointerClaim(pointer), undefined);
  } finally {
    if (previousNode) {
      Object.defineProperty(globalThis, "Node", { configurable: true, value: previousNode });
    } else {
      delete (globalThis as { Node?: unknown }).Node;
    }
  }
});

test("a light-dismiss control claim cannot be downgraded to content", () => {
  const previousNode = globalThis.Node;
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1 },
  });

  try {
    const ownerDocument = {} as Document;
    const target = { nodeType: 1, ownerDocument } as Element;
    const pointer = { pointerId: 8, target } as PointerEvent;

    assert.equal(claimReaderPointer(pointer, "control"), "control");
    assert.equal(claimReaderPointer(pointer, "content"), "control");
    assert.equal(consumeReaderPointerClaim(pointer), "control");
  } finally {
    if (previousNode) {
      Object.defineProperty(globalThis, "Node", { configurable: true, value: previousNode });
    } else {
      delete (globalThis as { Node?: unknown }).Node;
    }
  }
});
