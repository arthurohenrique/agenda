import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Criar estabelecimento",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireUser();
  return (
    <main className="min-h-dvh bg-[var(--background)] px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <Brand />
          <Link className="rounded-xl px-3 py-2 text-sm font-bold text-zinc-600 hover:bg-white hover:text-zinc-950" href="/">Sair do onboarding</Link>
        </header>
        <div className="mb-10 mt-14 max-w-3xl">
          <p className="text-sm font-semibold text-blue-700">Configuração inicial</p>
          <h1 className="mt-2 text-4xl font-bold tracking-[-0.045em] sm:text-5xl">Sua agenda pronta em poucos passos.</h1>
          <p className="mt-5 text-base leading-7 text-zinc-600">Criaremos unidade, horários, serviços editáveis, primeiro profissional e identidade visual.</p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
