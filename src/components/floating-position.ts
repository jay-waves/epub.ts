import { RefObject, useLayoutEffect, useState } from "react";

type FloatingPoint = {
  x: number;
  y: number;
};

type FloatingSize = {
  height: number;
  width: number;
};

const fallbackSize: FloatingSize = {
  height: 0,
  width: 0,
};

export function useFloatingPosition(
  ref: RefObject<HTMLElement | null>,
  point: FloatingPoint,
  open: boolean,
  options: { fallbackHeight?: number; fallbackWidth?: number; gap?: number; gutter?: number } = {},
) {
  const {
    fallbackHeight = 0,
    fallbackWidth = 0,
    gap = 8,
    gutter = 12,
  } = options;
  const [size, setSize] = useState<FloatingSize>(fallbackSize);

  useLayoutEffect(() => {
    if (!open) return;

    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ height: rect.height, width: rect.width });
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    window.addEventListener("resize", update);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open, ref]);

  const width = size.width || fallbackWidth;
  const height = size.height || fallbackHeight;
  const maxLeft = Math.max(gutter, window.innerWidth - width - gutter);
  const maxTop = Math.max(gutter, window.innerHeight - height - gutter);
  const preferredBelowTop = point.y + gap;
  const preferredAboveTop = point.y - height - gap;

  return {
    left: Math.min(Math.max(point.x, gutter), maxLeft),
    top: preferredBelowTop + height > window.innerHeight - gutter && preferredAboveTop >= gutter
      ? preferredAboveTop
      : Math.min(Math.max(preferredBelowTop, gutter), maxTop),
  };
}
