/** Coordinate projections shared by renderer-owned layout code. */
export type RenderMode = "paginated" | "scrolled" | "fixed";

export const supportsContinuousSpine = (bookDir: string | undefined, rtl: boolean, vertical: boolean) =>
  !vertical && !rtl && bookDir !== "rtl";

/** Makes the inner percentage gap match the renderer's outer padding. */
export function getLayoutGap(value: string, viewportSize: number) {
  const fraction = parseFloat(value) / 100;
  return fraction / (1 - fraction) * viewportSize;
}
