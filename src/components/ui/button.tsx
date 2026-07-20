import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "default" | "small" | "icon";
};

const variants = {
  primary: "bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-400",
  secondary: "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "bg-transparent text-zinc-700 hover:bg-zinc-100",
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
