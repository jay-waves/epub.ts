import assert from "node:assert/strict";
import test from "node:test";
import { getPaginatedAnchorOffset } from "../app/renderer/paginated/paginated-layout.ts";

test("restoration keeps the target column first across one, two and three visible columns", () => {
  for (const count of [1, 2, 3]) {
    assert.equal(getPaginatedAnchorOffset(300, 1250, 300, 6000, count * 300), 1500);
  }
  assert.equal(getPaginatedAnchorOffset(300, 1250, 200, 6000, 600), 1500);
});

test("restoration clamps only at track boundaries", () => {
  assert.equal(getPaginatedAnchorOffset(0, 0, 300, 6000, 900), 0);
  assert.equal(getPaginatedAnchorOffset(0, 5900, 300, 6000, 900), 5100);
  assert.equal(getPaginatedAnchorOffset(0, 200, 300, 300, 900), 0);
});

import {
  planPaginatedNavigation,
  type PaginatedNavigationState,
} from "../app/renderer/paginated/paginated-navigation.ts";

const state = (turn: number): PaginatedNavigationState => ({
  atBookEnd: false,
  atBookStart: false,
  edgeTurns: 3,
  turn,
  turns: 10,
});

test("paginated navigation steps by one column by default", () => {
  assert.deepEqual(planPaginatedNavigation(state(4), 1), {
    kind: "turn",
    turn: 5,
  });
});

test("paginated navigation can advance by a whole spread", () => {
  assert.deepEqual(planPaginatedNavigation(state(4), 1, 3), {
    kind: "turn",
    turn: 7,
  });
});

test("whole-spread navigation clamps at the cache edge", () => {
  assert.deepEqual(planPaginatedNavigation(state(8), 1, 3), {
    kind: "turn-and-cross",
    turn: 9,
    turnsAfterCross: 1,
  });
});

test("whole-spread navigation preserves turns beyond the cache edge", () => {
  assert.deepEqual(planPaginatedNavigation(state(9), 1, 3), {
    kind: "turn-and-cross",
    turn: 9,
    turnsAfterCross: 2,
  });
});

test("backward navigation preserves turns beyond the cache edge", () => {
  assert.deepEqual(planPaginatedNavigation(state(0), -1, 3), {
    kind: "turn-and-cross",
    turn: 0,
    turnsAfterCross: 2,
  });
});
