import Link from "next/link";
import { ArrowRight, Building2, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Brand } from "@/components/brand";
import type { AuthenticatedUser } from "@/lib/auth/session";
import type { TenantSummary } from "@/types/domain";

export function TenantPicker({
  memberships,
  user,
}: {
  memberships: TenantSummary[];
  user: AuthenticatedUser;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center justify-between gap-5">
        <Brand />
        <form action={logoutAction}>
          <button className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-zinc-600 hover:bg-white hover:text-zinc-950">
            <LogOut aria-hidden="true" size={17} />
            Sair
          </button>
        </form>
      </header>
      <section className="my-auto py-16">
        <p className="mb-3 text-sm font-semibold text-zinc-500">{user.email}</p>
        <h1 className="max-w-xl text-4xl font-bold tracking-[-0.04em] text-zinc-950 sm:text-5xl">
          Onde você quer trabalhar hoje?
        </h1>
        <p className="mt-4 max-w-lg text-base leading-7 text-zinc-600">
          Escolha um estabelecimento. Cada ambiente mantém dados e permissões separados.
        </p>

        <div className="mt-10 grid gap-3">
          {memberships.length ? (
            memberships.map((membership) => (
              <Link
                className="group flex min-h-20 items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md"
                href={`/app/${membership.slug}`}
                key={membership.id}
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-zinc-100 text-zinc-700">
                  <Building2 aria-hidden="true" size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-zinc-950">{membership.name}</span>
                  <span className="mt-1 block text-sm capitalize text-zinc-500">{membership.role}</span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="text-zinc-400 transition group-hover:translate-x-1 group-hover:text-zinc-950"
                  size={20}
                />
              </Link>
            ))
          ) : (
            <div className="surface p-6">
              <h2 className="font-bold">Nenhum estabelecimento associado</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Peça acesso a um proprietário ou inicie o onboarding para criar o primeiro ambiente.
              </p>
              <Link
                className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white"
                href="/onboarding"
              >
                Criar estabelecimento
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
