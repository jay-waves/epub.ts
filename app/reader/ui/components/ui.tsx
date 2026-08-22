import * as SliderPrimitive from "@radix-ui/react-slider";
import { forwardRef, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  DialogHTMLAttributes,
  ReactNode,
} from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button className={cn("ui-button", className)} type={type} {...props}>
      {children}
    </button>
  );
}

export const Dialog = forwardRef<
  HTMLDialogElement,
  DialogHTMLAttributes<HTMLDialogElement>
>(function Dialog({
  children,
  className,
  onClick,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  ...props
}, ref) {
  const backdropPointer = useRef<number | null>(null);
  const isBackdropPoint = (dialog: HTMLDialogElement, x: number, y: number) => {
    const rect = dialog.getBoundingClientRect();
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
  };
  return (
    <dialog
      className={cn("reader-modal", className)}
      ref={ref}
      onClick={(event) => {
        onClick?.(event);
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        backdropPointer.current = event.button === 0
          && isBackdropPoint(event.currentTarget, event.clientX, event.clientY)
          ? event.pointerId
          : null;
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        const activeBackdropPointer = backdropPointer.current;
        backdropPointer.current = null;
        if (
          activeBackdropPointer === event.pointerId
          && isBackdropPoint(event.currentTarget, event.clientX, event.clientY)
        ) event.currentTarget.close();
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        backdropPointer.current = null;
      }}
      {...props}
    >
      {children}
    </dialog>
  );
});

export const Slider = SliderPrimitive.Root;
export const SliderTrack = SliderPrimitive.Track;
export const SliderRange = SliderPrimitive.Range;
export const SliderThumb = SliderPrimitive.Thumb;

export function Tooltip({
  children,
  label,
  side = "bottom",
}: {
  children: ReactNode;
  label: string;
  side?: "right" | "bottom";
}) {
  return (
    <span className={`reader-tooltip reader-tooltip-${side}`} data-tip={label}>
      {children}
    </span>
  );
}
