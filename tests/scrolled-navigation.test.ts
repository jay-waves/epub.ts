import assert from "node:assert/strict";
import test from "node:test";

import { planScrolledNavigation } from "../app/renderer/scrolled/scrolled-navigation.ts";

const state = {
  atBookEnd: false,
  atBookStart: false,
  end: 1_600,
  extent: 4_000,
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

test("book boundaries do not discard a remaining partial viewport", () => {
  assert.deepEqual(planScrolledNavigation({
    ...state, atBookStart: true, start: 300, end: 1_100,
  }, -1), { kind: "scroll", offset: 0 });
  assert.deepEqual(planScrolledNavigation({
    ...state, atBookEnd: true, start: 3_000, end: 3_800,
  }, 1), { kind: "scroll", offset: 3_200 });
});

test("physical alignment reserve is not navigable book content", () => {
  assert.deepEqual(planScrolledNavigation({
    ...state, atBookEnd: true, start: 3_900, end: 4_700,
  }, 1), { kind: "book-edge" });
});

test("short books and subpixel edges stop without crossing the window", () => {
  const short = { ...state, atBookStart: true, atBookEnd: true,
    start: 0, end: 800, extent: 400 };
  assert.deepEqual(planScrolledNavigation(short, -1), { kind: "book-edge" });
  assert.deepEqual(planScrolledNavigation(short, 1), { kind: "book-edge" });
  assert.deepEqual(planScrolledNavigation({
    ...state, atBookEnd: true, end: 3_999.5,
  }, 1), { kind: "book-edge" });
});
