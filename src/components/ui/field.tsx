import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

export function Field({ label, error, hint, id, className, ...props }: FieldProps) {
  const inputId = id ?? props.name;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <label className="grid gap-2 text-sm font-medium text-zinc-800" htmlFor={inputId}>
      {label}
      <input
        aria-describedby={errorId ?? hintId}
        aria-invalid={Boolean(error)}
        className={cn(
          "form-control text-base placeholder:text-zinc-400",
          error && "border-red-500 focus:border-red-600 focus:ring-red-600/10",
          className,
        )}
        id={inputId}
        suppressHydrationWarning
        {...props}
      />
      {hint ? (
        <span className="font-normal text-zinc-500" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="font-medium text-red-700" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
