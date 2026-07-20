import Link from "next/link";
import { CheckCircle2, CircleDashed, ExternalLink, Globe2 } from "lucide-react";
import { changePublicationAction } from "@/app/actions/settings";
import { requireTenantAccess } from "@/features/tenants/access";
import { getPublicationChecklist } from "@/features/tenants/settings-queries";

interface SettingsPageProps { params: Promise<{ slug: string }> }

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const checklist = await getPublicationChecklist(tenant.id);
  const items = [
    ["Unidade ativa", checklist.location],
    ["Serviço público", checklist.services],
    ["Profissional público", checklist.staff],
    ["Profissional associado a serviço", checklist.staffServices],
    ["Horários configurados", checklist.workingHours],
    ["Contraste WCAG AA", checklist.contrast],
  ] as const;
  const ready = items.every(([, complete]) => complete);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold text-zinc-500">Configurações</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Página pública</h1>
        <p className="mt-2 text-sm text-zinc-500">Revise requisitos e controle publicação.</p>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4"><span className="grid size-12 place-items-center rounded-xl bg-zinc-100"><Globe2 aria-hidden="true" size={22} /></span><div><p className="text-sm font-semibold text-zinc-500">agenda.exemplo.com/{tenant.slug}</p><h2 className="mt-1 text-xl font-bold">{tenant.state === "published" ? "Página publicada" : "Página em rascunho"}</h2></div></div>
            <div className="mt-6 grid gap-3">{items.map(([label, complete]) => <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3" key={label}>{complete ? <CheckCircle2 className="text-green-700" aria-hidden="true" size={19} /> : <CircleDashed className="text-amber-700" aria-hidden="true" size={19} />}<span className="text-sm font-semibold">{label}</span><span className="ml-auto text-xs text-zinc-500">{complete ? "Pronto" : "Pendente"}</span></div>)}</div>
          </div>

          <aside className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold">Visibilidade</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Somente páginas publicadas aparecem para clientes.</p>
            {tenant.state === "published" ? <Link className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-sm font-bold hover:bg-zinc-50" href={`/${tenant.slug}`} target="_blank">Abrir página <ExternalLink aria-hidden="true" size={16} /></Link> : null}
            <form action={changePublicationAction} className="mt-3">
              <input name="slug" type="hidden" value={slug} />
              <input name="intent" type="hidden" value={tenant.state === "published" ? "unpublish" : "publish"} />
              <button className={`min-h-11 w-full rounded-xl px-4 text-sm font-bold ${tenant.state === "published" ? "border border-red-200 text-red-700 hover:bg-red-50" : "bg-zinc-950 text-white disabled:bg-zinc-300"}`} disabled={tenant.state !== "published" && !ready}>
                {tenant.state === "published" ? "Voltar para rascunho" : "Publicar página"}
              </button>
            </form>
            {!ready && tenant.state !== "published" ? <p className="mt-3 text-xs leading-5 text-amber-700">Conclua itens pendentes para publicar.</p> : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
