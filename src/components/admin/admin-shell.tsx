import Link from "next/link";
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
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import type { TenantContext } from "@/features/tenants/access";

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
}: {
  children: React.ReactNode;
  tenant: TenantContext;
}) {
  return (
    <div className="min-h-dvh bg-[var(--background)] text-zinc-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-zinc-200 bg-white p-4 lg:flex">
        <div className="px-2 py-3">
          <Brand />
        </div>
        <button className="mt-5 flex min-h-14 items-center gap-3 rounded-2xl border border-zinc-200 p-3 text-left hover:bg-zinc-50" type="button">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-sm font-bold text-white">
            {tenant.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{tenant.name}</span>
            <span className="mt-0.5 block text-xs capitalize text-zinc-500">{tenant.role}</span>
          </span>
          <ChevronDown aria-hidden="true" className="text-zinc-400" size={16} />
        </button>
        <nav className="mt-6 grid gap-1" aria-label="Navegação principal">
          {navigation.map(({ icon: Icon, label, path }, index) => (
            <Link
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
                index === 0 ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
              }`}
              href={`/app/${tenant.slug}${path}`}
              key={label}
            >
              <Icon aria-hidden="true" size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <form action={logoutAction} className="mt-auto">
          <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
            <LogOut aria-hidden="true" size={18} />
            Sair
          </button>
        </form>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button className="grid size-11 place-items-center rounded-xl hover:bg-zinc-100 lg:hidden" aria-label="Abrir menu" type="button">
            <Menu aria-hidden="true" size={21} />
          </button>
          <div className="flex min-w-0 items-center gap-3 lg:hidden">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-sm font-bold text-white">
              {tenant.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-bold">{tenant.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 sm:inline-flex">
              <span className="size-2 rounded-full bg-green-500" /> Operação online
            </span>
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
