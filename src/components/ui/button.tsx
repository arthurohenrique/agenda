import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "default" | "small" | "icon";
};

const variants = {
  primary: "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm hover:-translate-y-0.5 hover:shadow-md disabled:bg-zinc-400",
  secondary: "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--surface-soft)]",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "bg-transparent text-zinc-700 hover:bg-[var(--surface-soft)] hover:text-[var(--foreground)]",
} as const;

const sizes = {
  default: "min-h-12 px-5 py-3",
  small: "min-h-10 px-4 py-2 text-sm",
  icon: "size-11 p-0",
} as const;

export function Button({
  className,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-70",
        variants[variant],
        sizes[size],
        className,
      )}
      tabIndex={0}
      type={type}
      {...props}
    />
  );
}
