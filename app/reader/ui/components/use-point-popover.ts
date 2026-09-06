import { useCallback, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { overlayInput } from "../../overlay-input";

const VIEWPORT_GUTTER = 8;

export function usePointPopover({
  gap = 8,
  onDismiss,
  open,
  x,
  y,
}: {
  gap?: number;
  onDismiss: () => void;
  open: boolean;
  x: number;
  y: number;
}) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // React owns visibility; the input lock owns all outside/Escape dismissal.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;
    const release = overlayInput.register({
      contains: (event) => event.composedPath().includes(popover),
      dismiss: () => onDismissRef.current(),
    });
    popover.showPopover();
    return () => {
      if (popover.matches(":popover-open")) popover.hidePopover();
      release();
    };
  }, [open]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;

    const position = () => {
      const { height, width } = popover.getBoundingClientRect();
      const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER);
      const below = y + gap;
      const top = below + height <= window.innerHeight - VIEWPORT_GUTTER
        ? below
        : Math.max(VIEWPORT_GUTTER, y - gap - height);
      const leftValue = `${Math.min(Math.max(VIEWPORT_GUTTER, x), maxLeft)}px`;
      const topValue = `${top}px`;
      if (popover.style.left !== leftValue) popover.style.left = leftValue;
      if (popover.style.top !== topValue) popover.style.top = topValue;
    };

    position();
    const resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(popover);
    window.addEventListener("resize", position);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [gap, open, x, y]);

  const setPopover = useCallback((element: HTMLElement | null) => {
    popoverRef.current = element;
  }, []);

  return {
    popoverStyle: { left: x, top: y } satisfies CSSProperties,
    setPopover,
  };
}
