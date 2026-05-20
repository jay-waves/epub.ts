import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../classnames";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input className={cn("ui-input", className)} ref={ref} {...props} />;
});
