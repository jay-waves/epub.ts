export type ReaderTapRegion = "left" | "center" | "right";

/** Divides the reader viewport into three full-height tap targets. */
export function getReaderTapRegion(x: number, width: number): ReaderTapRegion | null {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0 || x < 0 || x > width) return null;
  if (x < width / 3) return "left";
  if (x > width * 2 / 3) return "right";
  return "center";
}
