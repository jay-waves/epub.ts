import { useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";

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
    const handleToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed" && openRef.current) {
        onDismissRef.current();
      }
    };
    popover.addEventListener("toggle", handleToggle);
    return () => popover.removeEventListener("toggle", handleToggle);
  });

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (!open) {
      if (popover.matches(":popover-open")) popover.hidePopover();
      return;
    }

    if (!popover.matches(":popover-open")) popover.showPopover();
    const { height, width } = popover.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER);
    const below = y + gap;
    const top = below + height <= window.innerHeight - VIEWPORT_GUTTER
      ? below
      : Math.max(VIEWPORT_GUTTER, y - gap - height);
    popover.style.left = `${Math.min(Math.max(VIEWPORT_GUTTER, x), maxLeft)}px`;
    popover.style.top = `${top}px`;
  });

  return {
    popoverStyle: { left: x, top: y } satisfies CSSProperties,
    setPopover: (element: HTMLElement | null) => {
      popoverRef.current = element;
    },
  };
}
