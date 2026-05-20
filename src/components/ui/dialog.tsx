import { forwardRef } from "react";
import type { DialogHTMLAttributes, ReactNode } from "react";
import { cn } from "../../classnames";

type DialogProps = DialogHTMLAttributes<HTMLDialogElement> & {
  children: ReactNode;
};

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { children, className, ...props },
  ref,
) {
  return (
    <dialog className={cn("reader-modal", className)} ref={ref} {...props}>
      {children}
    </dialog>
  );
});
