import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/auth/login-form";
import { TenantPicker } from "@/components/auth/tenant-picker";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <main className="grid min-h-dvh bg-[var(--background)] lg:grid-cols-[minmax(0,1.12fr)_minmax(430px,0.88fr)]">
      <section className="relative flex min-h-[48vh] flex-col justify-between overflow-hidden bg-[#102b24] p-7 text-white [--primary:#eef7f3] [--primary-foreground:#133d35] [--surface:#102b24] sm:p-12 lg:min-h-dvh lg:p-16 xl:p-20">
        <div aria-hidden="true" className="absolute -right-28 -top-24 size-96 rounded-full border border-white/10" />
        <div aria-hidden="true" className="absolute -right-2 top-32 size-44 rounded-full bg-emerald-300/8 blur-2xl" />
        <div className="relative"><Brand /></div>
        <div className="relative max-w-2xl py-16 lg:py-0">
          <p className="mb-7 text-xs font-semibold tracking-[0.18em] text-emerald-200/70">OPERAÇÃO EM UM SÓ LUGAR</p>
          <h1 className="text-5xl font-semibold leading-[0.94] tracking-[-0.065em] sm:text-6xl lg:text-7xl xl:text-[5.25rem]">
            Sua agenda,
            <br /> sem ruído.
          </h1>
          <p className="mt-8 max-w-lg text-lg leading-8 text-white/60">
            Atendimentos, clientes e equipe organizados para o dia fluir melhor.
          </p>
        </div>
        <p className="relative hidden text-xs font-medium tracking-wide text-white/35 lg:block">Agenda · Ambiente administrativo seguro</p>
      </section>

      <section className="relative flex items-center justify-center px-5 py-14 sm:px-10 lg:px-14">
        <div className="w-full max-w-[27rem]">
          <div className="mb-10">
            <p className="page-eyebrow">Bem-vindo de volta</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.05em] text-zinc-950 sm:text-[2.75rem]">
              Entre na sua agenda
            </h2>
          </div>
          <div className="surface p-6 sm:p-9">
            {!configured ? (
              <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="status">
                Ambiente local ainda sem Supabase. Configure as variáveis do arquivo de ambiente para autenticar.
              </p>
            ) : null}
            <LoginForm />
          </div>
          <p className="mt-7 text-center text-xs leading-5 text-zinc-500">
            Acesso restrito à equipe. Dados separados por estabelecimento.
          </p>
        </div>
        <ThemeToggle className="absolute right-5 top-5 sm:right-8 sm:top-8" />
      </section>
    </main>
  );
}
