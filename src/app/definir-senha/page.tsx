import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Definir nova senha",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  await requireUser();
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12" id="main-content" tabIndex={-1}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between"><Brand /><ThemeToggle compact /></div>
        <section className="surface mt-10 p-6 sm:p-9">
          <p className="page-eyebrow">Recuperação de acesso</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.05em]">Crie uma nova senha</h1>
          <p className="mb-7 mt-3 text-sm leading-6 text-zinc-600">Use uma senha exclusiva. Sessões anteriores serão protegidas pela rotação do Supabase Auth.</p>
          <UpdatePasswordForm />
        </section>
      </div>
    </main>
  );
}
