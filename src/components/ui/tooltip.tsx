import type { ReactNode } from "react";

type TooltipProps = {
  children: ReactNode;
  label: string;
  side?: "right" | "bottom";
};

export function Tooltip({ children, label, side = "bottom" }: TooltipProps) {
  return (
    <span className={`reader-tooltip reader-tooltip-${side}`} data-tip={label}>
      {children}
    </span>
  );
}
