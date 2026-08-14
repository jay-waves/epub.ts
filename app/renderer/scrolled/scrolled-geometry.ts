import {
  supportsContinuousSpine,
  type ScrolledGeometry,
} from "../shared/flow-geometry";

export const scrolledGeometry: ScrolledGeometry = Object.freeze({
  mode: "scrolled",
  sectionLayout: "scrolled",
  continuous: supportsContinuousSpine,
  scrollAxis: ({ vertical }) => vertical ? "scrollLeft" : "scrollTop",
  inactiveScrollAxis: ({ vertical }) => vertical ? "scrollTop" : "scrollLeft",
  extentSide: ({ vertical }) => vertical ? "width" : "height",
  trackProjection(context, viewportSize) {
    return supportsContinuousSpine(context)
      ? { kind: "scrolled", viewportSize }
      : { kind: "single", viewportSize };
  },
});
