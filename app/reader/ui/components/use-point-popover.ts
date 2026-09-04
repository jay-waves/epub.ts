import { useCallback, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { claimReaderPointer } from "../../interaction-arbiter";

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
  const openRef = useRef(open);
  const onDismissRef = useRef(onDismiss);
  openRef.current = open;
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const handleDismiss = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed" && openRef.current) {
        // Let the browser finish light-dismiss before React unmounts the node.
        // The completed toggle is the single close boundary for the popover.
        openRef.current = false;
        onDismissRef.current();
      }
    };
    popover.addEventListener("toggle", handleDismiss);
    return () => {
      popover.removeEventListener("toggle", handleDismiss);
    };
  }, [open]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;
    const claimLightDismiss = (event: PointerEvent) => {
      if (!event.composedPath().includes(popover)) claimReaderPointer(event, "control");
    };
    window.addEventListener("pointerdown", claimLightDismiss, { capture: true });
    return () => window.removeEventListener("pointerdown", claimLightDismiss, { capture: true });
  }, [open]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (!open) {
      if (popover.matches(":popover-open")) popover.hidePopover();
      return;
    }

    if (!popover.matches(":popover-open")) popover.showPopover();

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
