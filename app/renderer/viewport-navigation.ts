export type NavigationDirection = -1 | 1;

export type ViewportNavigationState = {
  atBookEnd: boolean;
  atBookStart: boolean;
  end: number;
  extent: number;
  mode: "paginated" | "scrolled";
  page: number;
  pages: number;
  size: number;
  start: number;
};

export type ViewportNavigationAction =
  | { kind: "book-edge" }
  | { kind: "cross-window" }
  | { kind: "page"; page: number; crossWindowAfter: boolean }
  | { kind: "scroll"; offset: number };

const EDGE_EPSILON = 2;

export function isAtBookEdge(state: ViewportNavigationState, direction: NavigationDirection) {
  if (direction < 0) return state.atBookStart && state.page <= 1;
  return state.atBookEnd && state.page >= state.pages - 2;
}

export function planViewportNavigation(
  state: ViewportNavigationState,
  direction: NavigationDirection,
  distance?: number,
): ViewportNavigationAction {
  if (isAtBookEdge(state, direction)) return { kind: "book-edge" };

  if (state.mode === "paginated") {
    const page = state.page + direction;
    return {
      kind: "page",
      page,
      crossWindowAfter: direction < 0 ? page <= 0 : page >= state.pages - 1,
    };
  }

  const remaining = direction < 0 ? state.start : state.extent - state.end;
  if (remaining <= EDGE_EPSILON) return { kind: "cross-window" };
  const step = Math.min(distance ?? state.size, remaining);
  return { kind: "scroll", offset: state.start + direction * step };
}
