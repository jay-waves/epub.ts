import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

type ButtonVariant = "ghost";
type ButtonSize = "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  children,
  className,
  size = "icon",
  variant = "ghost",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = cn("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className);

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}
