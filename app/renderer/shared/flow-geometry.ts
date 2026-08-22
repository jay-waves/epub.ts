/** Coordinate projections shared by renderer-owned layout code. */
export type RenderMode = "paginated" | "scrolled" | "fixed";

export type WritingContext = {
  bookDir?: string;
  rtl: boolean;
  vertical: boolean;
};

export type ScrollAxis = "scrollLeft" | "scrollTop";
export type ExtentSide = "height" | "width";

export type SingleTrackProjection = {
  kind: "single";
  viewportSize: number;
};

export type PaginatedTrackProjection = {
  kind: "paginated";
  viewportSize: number;
};

export type ScrolledTrackProjection = {
  kind: "scrolled";
  viewportSize: number;
};

export type TrackProjection =
  | SingleTrackProjection
  | PaginatedTrackProjection
  | ScrolledTrackProjection;

export type ReflowableGeometry<
  Mode extends "paginated" | "scrolled",
> = {
  mode: Mode;
  continuous: (context: WritingContext) => boolean;
  extentSide: (context: WritingContext) => ExtentSide;
  inactiveScrollAxis: (context: WritingContext) => ScrollAxis;
  scrollAxis: (context: WritingContext) => ScrollAxis;
  trackProjection: (context: WritingContext, viewportSize: number) => TrackProjection;
};

export type PaginatedGeometry = ReflowableGeometry<"paginated"> & {
  columnCount: (viewportWidth: number) => 1 | 2 | 3;
};

export type ScrolledGeometry = ReflowableGeometry<"scrolled">;

export const supportsContinuousSpine = ({ bookDir, rtl, vertical }: WritingContext) =>
  !vertical && !rtl && bookDir !== "rtl";

/** Makes the inner percentage gap match the renderer's outer padding. */
export function getLayoutGap(value: string, viewportSize: number) {
  const fraction = parseFloat(value) / 100;
  return fraction / (1 - fraction) * viewportSize;
}
