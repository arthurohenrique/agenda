"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

const storageKey = "agenda-theme";
const themeEvent = "agenda-theme-change";

function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function savedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Theme still works when browser storage is unavailable.
  }
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = () => callback();
  const handleSystemChange = () => {
    if (savedTheme()) return;
    const theme: Theme = media.matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    callback();
  };

  window.addEventListener(themeEvent, handleThemeChange);
  media.addEventListener("change", handleSystemChange);
  return () => {
    window.removeEventListener(themeEvent, handleThemeChange);
    media.removeEventListener("change", handleSystemChange);
  };
}

export function ThemeToggle({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  const dark = theme === "dark";
  const label = dark ? "Ativar tema claro" : "Ativar tema escuro";

  function toggleTheme() {
    const nextTheme: Theme = dark ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    persistTheme(nextTheme);
    window.dispatchEvent(new Event(themeEvent));
  }

  return (
    <button
      aria-label={label}
      aria-pressed={dark}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--control-border)] bg-[var(--surface)] px-3 text-sm font-semibold leading-none text-[var(--foreground)] shadow-sm hover:-translate-y-0.5 hover:bg-[var(--surface-soft)]",
        compact && "size-11 p-0",
        className,
      )}
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      {dark ? <Sun aria-hidden="true" className="shrink-0" size={17} /> : <Moon aria-hidden="true" className="shrink-0" size={17} />}
      {compact ? null : <span className="whitespace-nowrap">{dark ? "Tema claro" : "Tema escuro"}</span>}
    </button>
  );
}
