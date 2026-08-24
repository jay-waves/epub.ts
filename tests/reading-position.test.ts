import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorForPosition,
  clampFraction,
  createReadingPosition,
  resolveReadingPosition,
} from "../app/renderer/shared/reading-position.ts";

test("normalizes every reading position to a section fraction", () => {
  assert.equal(clampFraction(-0.5), 0);
  assert.equal(clampFraction(1.5), 1);
  assert.equal(clampFraction(Number.NaN, 0.25), 0.25);
  assert.deepEqual(createReadingPosition(3, undefined), { index: 3, fraction: 0 });
});

test("uses a DOM range only for its owning live section document", () => {
  const node = {} as Node;
  const document = {
    contains: (candidate: Node) => candidate === node,
  } as Document;
  Object.assign(node, { ownerDocument: document });
  const clone = { cloned: true };
  const range = {
    startContainer: node,
    endContainer: node,
    cloneRange: () => clone,
  } as unknown as Range;
  const position = createReadingPosition(2, 0.4, range);

  assert.equal(anchorForPosition(position, 2, document), clone);
  assert.equal(anchorForPosition(position, 1, document), 0);
  assert.equal(anchorForPosition(position, 2, { contains: () => false } as Document), 0.4);
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
