import assert from "node:assert/strict";
import test from "node:test";

import { getLayoutGap } from "../app/renderer/shared/flow-geometry.ts";

test("equalizes a percentage column gap with outer padding", () => {
  assert.equal(getLayoutGap("10%", 900), 100);
  assert.ok(Math.abs(getLayoutGap("2.5%", 780) - 20) < Number.EPSILON * 100);
});
