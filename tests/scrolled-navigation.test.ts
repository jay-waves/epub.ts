import assert from "node:assert/strict";
import test from "node:test";

import { planScrolledNavigation } from "../app/renderer/scrolled/scrolled-navigation.ts";

const state = {
  atBookEnd: false,
  atBookStart: false,
  end: 1_600,
  extent: 4_000,
  page: 1,
  pages: 5,
  size: 800,
  start: 800,
};

test("scrolled navigation advances by viewport or requested distance", () => {
  assert.deepEqual(planScrolledNavigation(state, 1), { kind: "scroll", offset: 1_600 });
  assert.deepEqual(planScrolledNavigation(state, -1, 300), { kind: "scroll", offset: 500 });
});

test("scrolled navigation crosses a depleted cache window", () => {
  assert.deepEqual(planScrolledNavigation({ ...state, end: 4_000 }, 1), {
    kind: "cross-window",
  });
});
