import assert from "node:assert/strict";
import test from "node:test";
import { ScrollCoordinator } from "../app/renderer/scrolled/scroll-coordinator.ts";

function fixture(frameLeft = 0) {
  const container = Object.assign(new EventTarget(), {
    scrollTop: 0, scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
  });
  const points: number[][] = [];
  const text = {};
  const range = { startContainer: text, setStart() {}, collapse() {} };
  const doc = {
    defaultView: { frameElement: {
      offsetWidth: 400, offsetHeight: 300,
      getBoundingClientRect: () => ({
        left: frameLeft, top: 0, right: frameLeft + 800, bottom: 600,
        width: 800, height: 600,
      }),
    } },
    caretPositionFromPoint: (x: number, y: number) => {
      points.push([x, y]);
      return { offsetNode: text, offset: 0 };
    },
    createRange: () => range,
  } as unknown as Document;
  return { coordinator: new ScrollCoordinator(container as unknown as HTMLElement, () => {}),
    doc, points, range };
}

test("reading-edge sampling follows writing direction and iframe scale", () => {
  for (const [mode, expected] of [
    ["horizontal-tb", [200, 20]],
    ["vertical-lr", [20, 150]],
    ["vertical-rl", [380, 150]],
  ] as const) {
    const { coordinator, doc, points, range } = fixture();
    assert.equal(coordinator.readingRange(doc, 40, mode), range);
    assert.deepEqual(points, [expected]);
  }
});

test("an offscreen frame cannot supply a reading anchor", () => {
  const { coordinator, doc, points } = fixture(900);
  assert.equal(coordinator.readingRange(doc, 40), undefined);
  assert.deepEqual(points, []);
});
