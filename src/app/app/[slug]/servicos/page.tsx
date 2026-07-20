import { Clock3, Plus, Sparkles, UsersRound } from "lucide-react";
import { createServiceAction, toggleServiceAction } from "@/app/actions/catalog";
import { getAdminServices } from "@/features/catalog/admin-queries";
import { requireTenantAccess } from "@/features/tenants/access";
import { formatMoney } from "@/lib/money";

interface ServicesPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ServicesPage({ params }: ServicesPageProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const services = await getAdminServices(tenant.id);
  const canManage = tenant.role === "owner" || tenant.role === "admin";

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <div>
          <p className="text-sm font-semibold text-zinc-500">Catálogo</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Serviços</h1>
          <p className="mt-2 text-sm text-zinc-500">Preço, duração, publicação e profissionais habilitados.</p>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="grid content-start gap-3" aria-label="Serviços cadastrados">
            {services.map((service) => (
              <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm" key={service.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold">{service.name}</h2>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${service.is_active ? "bg-green-50 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                        {service.is_active ? "Ativo" : "Inativo"}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                        {service.is_public ? "Público" : "Interno"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500">
                      <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" size={15} />{service.duration_minutes} min</span>
                      <span className="font-semibold text-zinc-900">{formatMoney(service.promotional_price_cents ?? service.price_cents, tenant.currency)}</span>
                      <span className="inline-flex items-center gap-1.5"><UsersRound aria-hidden="true" size={15} />{service.staff_services.length} profissionais</span>
                    </div>
                  </div>
                  {canManage ? (
                    <form action={toggleServiceAction}>
                      <input name="slug" type="hidden" value={slug} />
                      <input name="id" type="hidden" value={service.id} />
                      <input name="active" type="hidden" value={String(!service.is_active)} />
                      <button className="min-h-10 rounded-xl border border-zinc-200 px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50">
                        {service.is_active ? "Desativar" : "Ativar"}
                      </button>
                    </form>
                  ) : null}
                </div>
              </article>
            ))}
            {!services.length ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
                <Sparkles className="mx-auto text-zinc-400" aria-hidden="true" />
                <h2 className="mt-4 font-bold">Nenhum serviço cadastrado</h2>
              </div>
            ) : null}
          </section>

          {canManage ? (
            <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:self-start">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><Plus aria-hidden="true" size={19} /></span><div><p className="text-xs font-semibold text-zinc-500">CADASTRO RÁPIDO</p><h2 className="font-bold">Novo serviço</h2></div></div>
              <form action={createServiceAction} className="mt-5 grid gap-4">
                <input name="slug" type="hidden" value={slug} />
                <label className="grid gap-2 text-sm font-semibold">Nome<input className="min-h-11 rounded-xl border border-zinc-200 px-3" name="name" required maxLength={120} /></label>
                <label className="grid gap-2 text-sm font-semibold">Duração<input className="min-h-11 rounded-xl border border-zinc-200 px-3" name="durationMinutes" required min={5} max={1440} step={5} type="number" defaultValue={60} /></label>
                <label className="grid gap-2 text-sm font-semibold">Preço<input className="min-h-11 rounded-xl border border-zinc-200 px-3" name="price" required inputMode="decimal" placeholder="0,00" /></label>
                <button className="min-h-11 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white">Criar serviço</button>
              </form>
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
