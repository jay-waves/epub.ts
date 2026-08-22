import { useId, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";

type PopoverStyle = CSSProperties & {
  anchorName?: string;
  positionAnchor?: string;
};

export function usePointPopover({
  onDismiss,
  open,
  x,
  y,
}: {
  onDismiss: () => void;
  open: boolean;
  x: number;
  y: number;
}) {
  const id = useId().replace(/[^a-z0-9]/giu, "");
  const anchorName = `--reader-point-${id}`;
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
  }, []);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    if (open && !popover.matches(":popover-open")) popover.showPopover();
    if (!open && popover.matches(":popover-open")) popover.hidePopover();
  }, [open]);

  return {
    anchorStyle: {
      anchorName,
      left: x,
      top: y,
    } satisfies PopoverStyle,
    popoverStyle: {
      positionAnchor: anchorName,
    } satisfies PopoverStyle,
    setPopover: (element: HTMLElement | null) => {
      popoverRef.current = element;
    },
  };
}
