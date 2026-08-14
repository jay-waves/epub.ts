import {
  supportsContinuousSpine,
  type PaginatedGeometry,
} from "../shared/flow-geometry";

export const paginatedGeometry: PaginatedGeometry = Object.freeze({
  mode: "paginated",
  sectionLayout: "columns",
  continuous: supportsContinuousSpine,
  columnCount: (viewportWidth) => viewportWidth >= 2000
    ? 3
    : viewportWidth >= 1500 ? 2 : 1,
  scrollAxis: ({ vertical }) => vertical ? "scrollTop" : "scrollLeft",
  inactiveScrollAxis: ({ vertical }) => vertical ? "scrollLeft" : "scrollTop",
  extentSide: ({ vertical }) => vertical ? "height" : "width",
  trackProjection(context, viewportSize) {
    return supportsContinuousSpine(context)
      ? { kind: "paginated", viewportSize }
      : { kind: "single", viewportSize };
  },
});
