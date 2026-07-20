import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/auth/login-form";
import { TenantPicker } from "@/components/auth/tenant-picker";
import { getCurrentUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { getTenantMemberships } from "@/features/tenants/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const memberships = await getTenantMemberships();
    if (memberships.length === 1 && memberships[0]) {
      redirect(`/app/${memberships[0].slug}`);
    }
    return <TenantPicker memberships={memberships} user={user} />;
  }

  const configured = isSupabaseConfigured();

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(430px,0.85fr)]">
      <section className="flex min-h-[46vh] flex-col justify-between bg-zinc-950 p-7 text-white sm:p-12 lg:min-h-dvh lg:p-16">
        <Brand />
        <div className="max-w-2xl py-16 lg:py-0">
          <p className="mb-5 text-sm font-semibold tracking-wide text-zinc-400">OPERAÇÃO EM UM SÓ LUGAR</p>
          <h1 className="text-5xl font-bold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Sua agenda,
            <br /> sem ruído.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-zinc-300">
            Atendimentos, clientes e equipe organizados para o dia fluir melhor.
          </p>
        </div>
        <p className="hidden text-sm text-zinc-500 lg:block">Agenda · Ambiente administrativo seguro</p>
      </section>

      <section className="flex items-center justify-center bg-[#f6f7f8] px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-9">
            <p className="text-sm font-semibold text-zinc-500">Bem-vindo de volta</p>
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-zinc-950 sm:text-4xl">
              Entre na sua agenda
            </h2>
          </div>
          <div className="surface p-6 sm:p-8">
            {!configured ? (
              <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
                Ambiente local ainda sem Supabase. Configure as variáveis do arquivo de ambiente para autenticar.
              </p>
            ) : null}
            <LoginForm />
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-zinc-500">
            Acesso restrito à equipe. Dados separados por estabelecimento.
          </p>
        </div>
      </section>
    </main>
  );
}
