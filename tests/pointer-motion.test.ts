import assert from "node:assert/strict";
import test from "node:test";

import { PointerMotion } from "../app/reader/pointer-motion.ts";

const options = { axisRatio: 1.2, threshold: 8 };

test("pointer motion preserves taps inside the movement threshold", () => {
  const motion = new PointerMotion(100, 100, 0, options);
  motion.move(106, 105, 16);
  assert.equal(motion.axis, null);
  assert.equal(motion.isTap(106, 105), true);
});

test("pointer motion locks a dominant axis once", () => {
  const motion = new PointerMotion(100, 100, 0, options);
  assert.equal(motion.move(90, 98, 10).axis, "horizontal");
  assert.equal(motion.move(91, 120, 20).axis, "horizontal");
  assert.equal(motion.isTap(100, 100), false);
});

test("pointer motion reports signed velocity and drops it after an idle release", () => {
  const motion = new PointerMotion(100, 100, 0, options);
  motion.move(80, 110, 10);
  assert.deepEqual(motion.velocity(50), [-2, 1]);
  assert.deepEqual(motion.velocity(100), [0, 0]);
});
