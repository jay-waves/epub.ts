import { forwardRef } from "react";
import type { DialogHTMLAttributes, ReactNode } from "react";

type DialogProps = DialogHTMLAttributes<HTMLDialogElement> & {
  children: ReactNode;
};

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog(
  { children, className, ...props },
  ref,
) {
  return (
    <dialog className={["reader-modal", className].filter(Boolean).join(" ")} ref={ref} {...props}>
      {children}
    </dialog>
  );
});

export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function DialogBackdrop() {
  return (
    <form className="reader-modal-backdrop" method="dialog">
      <button>close</button>
    </form>
  );
}
