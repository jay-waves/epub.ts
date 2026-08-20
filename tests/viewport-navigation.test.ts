import assert from "node:assert/strict";
import test from "node:test";

import {
  planViewportNavigation,
  type ViewportNavigationState,
} from "../app/renderer/shared/viewport-navigation.ts";

const state = (turn: number): ViewportNavigationState => ({
  atBookEnd: false,
  atBookStart: false,
  edgeTurns: 3,
  end: turn + 3,
  extent: 12,
  mode: "paginated",
  start: turn,
  turn,
  turns: 10,
});

test("paginated navigation steps by one column by default", () => {
  assert.deepEqual(planViewportNavigation(state(4), 1), {
    kind: "turn",
    turn: 5,
    crossWindowAfter: false,
  });
});

test("paginated navigation can advance by a whole spread", () => {
  assert.deepEqual(planViewportNavigation(state(4), 1, { turns: 3 }), {
    kind: "turn",
    turn: 7,
    crossWindowAfter: false,
  });
});

test("whole-spread navigation clamps at the cache edge", () => {
  assert.deepEqual(planViewportNavigation(state(8), 1, { turns: 3 }), {
    kind: "turn",
    turn: 9,
    crossWindowAfter: true,
  });
});
