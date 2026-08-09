import { useLayoutEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from "@floating-ui/react";

type FloatingPoint = {
  x: number;
  y: number;
};

type FloatingPositionOptions = {
  gap?: number;
  gutter?: number;
  onDismiss: () => void;
  open: boolean;
  point: FloatingPoint;
};

export function useFloatingPosition(options: FloatingPositionOptions) {
  const {
    gap = 8,
    gutter = 12,
    onDismiss,
    open,
    point,
  } = options;
  const {
    context,
    floatingStyles,
    isPositioned,
    refs,
  } = useFloating({
    middleware: [
      offset(gap),
      flip({ padding: gutter }),
      shift({ padding: gutter }),
    ],
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onDismiss();
    },
    open,
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    if (!open) {
      refs.setPositionReference(null);
      return;
    }

    refs.setPositionReference({
      getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
    });
    return () => refs.setPositionReference(null);
  }, [open, point.x, point.y, refs]);

  const dismiss = useDismiss(context, { enabled: open });
  const { getFloatingProps } = useInteractions([dismiss]);

  return {
    floatingStyles: {
      ...floatingStyles,
      visibility: isPositioned ? undefined : "hidden",
    },
    floatingProps: getFloatingProps({
      onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
      onPointerDown: (event: ReactMouseEvent) => event.stopPropagation(),
    }),
    refs,
  };
}
