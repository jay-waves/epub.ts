import * as SliderPrimitive from "@radix-ui/react-slider";
import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  DialogHTMLAttributes,
  ElementRef,
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
>(function Dialog({ children, className, onClick, ...props }, ref) {
  return (
    <dialog
      className={cn("reader-modal", className)}
      ref={ref}
      onClick={(event) => {
        onClick?.(event);
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left
          || event.clientX > rect.right
          || event.clientY < rect.top
          || event.clientY > rect.bottom
        ) event.currentTarget.close();
      }}
      {...props}
    >
      {children}
    </dialog>
  );
});

type SliderProps = ComponentPropsWithoutRef<typeof SliderPrimitive.Root>;

export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider({ className, ...props }, ref) {
  return <SliderPrimitive.Root className={className} ref={ref} {...props} />;
});

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
