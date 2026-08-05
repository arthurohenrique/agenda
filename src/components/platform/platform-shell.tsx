"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, LogOut, Menu, MessageCircleMore, ShieldCheck, X } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PlatformOwnerContext } from "@/features/platform/access";
import { useModalFocus } from "@/hooks/use-modal-focus";

const navigation = [
  { href: "/app/platform/whatsapp", label: "WhatsApp", icon: MessageCircleMore },
  { href: "/app/platform/whatsapp/simulator", label: "Simulador", icon: FlaskConical },
] as const;

export function PlatformShell({
  children,
  owner,
}: {
  children: React.ReactNode;
  owner: PlatformOwnerContext;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dialogRef, triggerRef } = useModalFocus<HTMLButtonElement, HTMLElement>({
    onClose: () => setMobileOpen(false),
    open: mobileOpen,
  });

  const navigationLinks = (
    <nav className="mt-7 grid gap-1.5" aria-label="Navegação da plataforma">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href.endsWith("/whatsapp") ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-semibold ${active ? "bg-[#eef7f3] text-[#133d35]" : "text-white hover:bg-black/15"}`}
            href={href as Route}
            key={href}
            onClick={() => setMobileOpen(false)}
          >
            <Icon aria-hidden="true" size={18} />{label}
          </Link>
        );
      })}
    </nav>
  );

  const ownerCard = (
    <div className="mt-6 flex min-h-16 items-center gap-3 rounded-2xl border border-white/30 bg-black/10 p-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eef7f3] text-[#133d35]"><ShieldCheck aria-hidden="true" size={19} /></span>
      <div className="min-w-0"><p className="truncate text-sm font-bold">Operação da plataforma</p><p className="mt-0.5 truncate text-xs text-white/75">{owner.email ?? "platform_owner"}</p></div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-[#102b24] p-5 text-white [--primary:#eef7f3] [--primary-foreground:#133d35] [--surface:#102b24] lg:flex">
        <div className="px-2 py-3"><Brand /></div>
        {ownerCard}
        {navigationLinks}
        <form action={logoutAction} className="mt-auto"><button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold hover:bg-black/15"><LogOut aria-hidden="true" size={18} />Sair</button></form>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 bg-[#06110e]/55 backdrop-blur-sm lg:hidden" onMouseDown={(event) => { if (event.currentTarget === event.target) setMobileOpen(false); }}>
          <aside
            aria-labelledby="platform-mobile-navigation-title"
            aria-modal="true"
            className="flex h-dvh w-[min(21rem,88vw)] flex-col overflow-y-auto overscroll-contain bg-[#102b24] p-5 text-white shadow-2xl [--primary:#eef7f3] [--primary-foreground:#133d35] [--surface:#102b24]"
            id="platform-mobile-navigation"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <h2 className="sr-only" id="platform-mobile-navigation-title">Menu da plataforma</h2>
            <div className="flex items-center justify-between px-2 py-2"><Brand /><button aria-label="Fechar menu" className="grid size-11 place-items-center rounded-xl hover:bg-black/15" data-modal-initial-focus onClick={() => setMobileOpen(false)} type="button"><X aria-hidden="true" size={20} /></button></div>
            {ownerCard}
            {navigationLinks}
            <form action={logoutAction} className="mt-auto"><button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3.5 text-sm font-semibold hover:bg-black/15"><LogOut aria-hidden="true" size={18} />Sair</button></form>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex min-h-[4.5rem] items-center justify-between border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_84%,transparent)] px-4 backdrop-blur-xl sm:px-6 lg:px-10">
          <button aria-controls={mobileOpen ? "platform-mobile-navigation" : undefined} aria-expanded={mobileOpen} aria-haspopup="dialog" aria-label="Abrir menu" className="grid size-11 place-items-center rounded-xl hover:bg-[var(--surface-soft)] lg:hidden" onClick={() => setMobileOpen(true)} ref={triggerRef} type="button"><Menu aria-hidden="true" size={21} /></button>
          <div className="ml-auto flex items-center gap-2"><span className="hidden rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)] sm:inline-flex">Ambiente de plataforma</span><ThemeToggle compact /></div>
        </header>
        {children}
      </div>
    </div>
  );
}
