const EDGE_EPSILON = 2;

export type ScrolledNavigationState = {
  atBookEnd: boolean;
  atBookStart: boolean;
  end: number;
  extent: number;
  page: number;
  pages: number;
  size: number;
  start: number;
};

export function isAtScrolledBookEdge(state: ScrolledNavigationState, direction: -1 | 1) {
  if (direction < 0) return state.atBookStart && state.page <= 1;
  return state.atBookEnd && state.page >= state.pages - 2;
}

export function planScrolledNavigation(
  state: ScrolledNavigationState,
  direction: -1 | 1,
  distance?: number,
) {
  if (isAtScrolledBookEdge(state, direction)) return { kind: "book-edge" } as const;
  const remaining = direction < 0 ? state.start : state.extent - state.end;
  if (remaining <= EDGE_EPSILON) return { kind: "cross-window" } as const;
  const step = Math.min(distance ?? state.size, remaining);
  return { kind: "scroll", offset: state.start + direction * step } as const;
}
