import assert from "node:assert/strict";
import test from "node:test";

import { Overlay } from "../app/renderer/shared/overlay.ts";

class FakeSvgElement {
  readonly style = {};
  readonly children: FakeSvgElement[] = [];
  parentNode: FakeSvgElement | null = null;

  append(child: FakeSvgElement) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  replaceWith(replacement: FakeSvgElement) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const index = parent.children.indexOf(this);
    if (index < 0) return;
    replacement.remove();
    replacement.parentNode = parent;
    parent.children[index] = replacement;
    this.parentNode = null;
  }

  getRootNode() { return this; }
}

const rects = [{}] as unknown as DOMRectList;
const emptyRects = [] as unknown as DOMRectList;
const range = { getClientRects: () => rects } as Range;

test("overlay keeps the previous item when an update or redraw fails", () => {
  const previousDocument = globalThis.document;
  const previousWarn = console.warn;
  let warningCount = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElementNS: () => new FakeSvgElement(),
    },
  });
  console.warn = () => { warningCount += 1; };

  try {
    const overlay = new Overlay();
    const first = new FakeSvgElement();
    let redrawFails = false;
    overlay.add("annotation", range, () => {
      if (redrawFails) throw new Error("draw unavailable");
      return first as unknown as SVGElement;
    });
    assert.equal(overlay.getRange("annotation"), range);
    assert.equal(overlay.getRange("missing"), undefined);

    redrawFails = true;
    overlay.redraw();
    assert.equal(warningCount, 1);
    assert.deepEqual(
      (overlay.element as unknown as FakeSvgElement).children,
      [first],
    );

    assert.throws(() => overlay.add(
      "annotation",
      () => { throw new Error("range unavailable"); },
      () => new FakeSvgElement() as unknown as SVGElement,
    ));
    assert.deepEqual(
      (overlay.element as unknown as FakeSvgElement).children,
      [first],
    );

    assert.equal(overlay.add(
      "annotation",
      { getClientRects: () => emptyRects } as Range,
      () => new FakeSvgElement() as unknown as SVGElement,
    ), false);
    assert.deepEqual(
      (overlay.element as unknown as FakeSvgElement).children,
      [first],
    );

    const replacement = new FakeSvgElement();
    overlay.add("annotation", range, () => replacement as unknown as SVGElement);
    assert.deepEqual(
      (overlay.element as unknown as FakeSvgElement).children,
      [replacement],
    );
    overlay.remove("annotation");
    assert.equal(overlay.getRange("annotation"), undefined);
  } finally {
    console.warn = previousWarn;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
});
