"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  ContactRound,
  LogOut,
  Menu,
  Settings2,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import type { TenantContext } from "@/features/tenants/access";

interface TenantTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
}

const navigation = [
  { label: "Agenda", icon: CalendarDays, path: "" },
  { label: "Clientes", icon: ContactRound, path: "/clientes" },
  { label: "Serviços", icon: Sparkles, path: "/servicos" },
  { label: "Equipe", icon: UsersRound, path: "/profissionais" },
  { label: "Relatórios", icon: BarChart3, path: "/relatorios" },
  { label: "Configurações", icon: Settings2, path: "/configuracoes" },
] as const;

export function AdminShell({
  children,
  tenant,
  theme,
}: {
  children: React.ReactNode;
  tenant: TenantContext;
  theme: TenantTheme;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  function isActive(path: string) {
    const href = `/app/${tenant.slug}${path}`;
    return path === "" ? pathname === href : pathname.startsWith(href);
  }

  const navigationLinks = (
    <nav className="mt-7 grid gap-1.5" aria-label="Navegação principal">
      {navigation.map(({ icon: Icon, label, path }) => {
        const active = isActive(path);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition ${
              active
                ? "tenant-nav-active shadow-sm"
                : "text-white/65 hover:bg-white/8 hover:text-white"
            }`}
            href={`/app/${tenant.slug}${path}`}
            key={label}
            onClick={() => setMobileOpen(false)}
          >
            <Icon aria-hidden="true" className={active ? "text-[var(--tenant-accent)]" : "text-white/45 group-hover:text-white/80"} size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const themeStyle = {
    "--tenant-primary": theme.primary,
    "--tenant-accent": theme.accent,
    "--tenant-background": theme.background,
    "--tenant-surface": theme.surface,
    "--tenant-text": theme.text,
  } as CSSProperties;
  const sidebarStyle = {
    backgroundColor: theme.primary,
    "--tenant-primary": theme.primary,
    "--tenant-accent": theme.accent,
    "--tenant-surface": theme.surface,
    "--primary": theme.surface,
    "--primary-foreground": theme.primary,
  } as CSSProperties;

  return (
    <div className="admin-workspace min-h-dvh bg-[var(--background)] text-zinc-950" style={themeStyle}>
      <aside className="tenant-sidebar fixed inset-y-0 left-0 z-30 hidden w-72 flex-col p-5 text-white lg:flex" style={sidebarStyle}>
        <div className="px-2 py-3 text-white">
          <Brand />
        </div>
        <button className="mt-6 flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:border-white/15 hover:bg-white/10" type="button">
          <span className="tenant-avatar grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold">
            {tenant.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{tenant.name}</span>
            <span className="mt-0.5 block text-xs capitalize text-white/50">{tenant.role}</span>
          </span>
          <ChevronDown aria-hidden="true" className="text-white/35" size={16} />
        </button>
        {navigationLinks}
        <form action={logoutAction} className="mt-auto">
          <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold text-white/55 hover:bg-white/8 hover:text-white">
            <LogOut aria-hidden="true" size={18} />
            Sair
          </button>
        </form>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-[#06110e]/55 backdrop-blur-sm lg:hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) setMobileOpen(false); }}>
          <aside aria-label="Menu" aria-modal="true" className="tenant-sidebar flex h-dvh w-[min(21rem,88vw)] flex-col p-5 text-white shadow-2xl" role="dialog" style={sidebarStyle}>
            <div className="flex items-center justify-between px-2 py-2">
              <Brand />
              <button aria-label="Fechar menu" className="grid size-10 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setMobileOpen(false)} type="button">
                <X aria-hidden="true" size={20} />
              </button>
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <span className="tenant-avatar grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold">{tenant.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0"><p className="truncate text-sm font-bold">{tenant.name}</p><p className="mt-0.5 text-xs capitalize text-white/50">{tenant.role}</p></div>
            </div>
            {navigationLinks}
            <form action={logoutAction} className="mt-auto">
              <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold text-white/55 hover:bg-white/8 hover:text-white"><LogOut aria-hidden="true" size={18} />Sair</button>
            </form>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex min-h-[4.5rem] items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_84%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:px-10">
          <button className="grid size-11 place-items-center rounded-xl hover:bg-white lg:hidden" aria-label="Abrir menu" onClick={() => setMobileOpen(true)} type="button">
            <Menu aria-hidden="true" size={21} />
          </button>
          <div className="flex min-w-0 items-center gap-3 lg:hidden">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--primary)] text-sm font-bold text-[var(--primary-foreground)]">
              {tenant.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-bold">{tenant.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-zinc-600 sm:inline-flex">
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/12%)]" /> Operação online
            </span>
            <ThemeToggle compact />
            <button className="grid size-10 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-100" aria-label="Conta" type="button">
              <CircleUserRound aria-hidden="true" size={21} />
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
