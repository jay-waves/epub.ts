import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
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

    const reference = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
    let active = true;
    const cleanup = autoUpdate(reference, popover, () => {
      void computePosition(reference, popover, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(gap), flip({ padding: VIEWPORT_GUTTER }),
          shift({ padding: VIEWPORT_GUTTER, crossAxis: true })],
      }).then(({ x, y }) => {
        if (active) Object.assign(popover.style, { left: `${x}px`, top: `${y}px` });
      });
    });
    return () => {
      active = false;
      cleanup();
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
