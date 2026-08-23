export type PaginatedNavigationState = {
  atBookEnd: boolean;
  atBookStart: boolean;
  edgeTurns: number;
  turn: number;
  turns: number;
};

type PaginatedNavigationAction =
  | { kind: "book-edge" }
  | { kind: "turn"; turn: number }
  | { kind: "turn-and-cross"; turn: number; turnsAfterCross: number };

export function isAtPaginatedBookEdge(
  state: PaginatedNavigationState,
  direction: -1 | 1,
) {
  if (direction < 0) return state.atBookStart && state.turn <= state.edgeTurns;
  return state.atBookEnd && state.turn >= state.turns - state.edgeTurns - 1;
}

export function planPaginatedNavigation(
  state: PaginatedNavigationState,
  direction: -1 | 1,
  turns = 1,
): PaginatedNavigationAction {
  if (isAtPaginatedBookEdge(state, direction)) return { kind: "book-edge" };
  const requestedTurn = state.turn + direction * Math.max(1, turns);
  const turn = Math.max(0, Math.min(state.turns - 1, requestedTurn));
  const turnsAfterCross = direction < 0
    ? Math.max(0, -requestedTurn - 1)
    : Math.max(0, requestedTurn - state.turns);
  const crossesWindow = direction < 0 ? turn === 0 : turn === state.turns - 1;
  return crossesWindow
    ? { kind: "turn-and-cross", turn, turnsAfterCross }
    : { kind: "turn", turn };
}
