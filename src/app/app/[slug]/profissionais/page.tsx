import { Plus, UserRound } from "lucide-react";
import { createStaffAction, toggleStaffAction } from "@/app/actions/catalog";
import { getAdminServices, getAdminStaff } from "@/features/catalog/admin-queries";
import { requireTenantAccess } from "@/features/tenants/access";

interface StaffPageProps { params: Promise<{ slug: string }> }

export default async function StaffPage({ params }: StaffPageProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const [staff, services] = await Promise.all([getAdminStaff(tenant.id), getAdminServices(tenant.id)]);
  const canManage = tenant.role === "owner" || tenant.role === "admin";

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-zinc-500">Equipe</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Profissionais</h1>
        <p className="mt-2 text-sm text-zinc-500">Serviços, visibilidade e acesso à agenda.</p>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid content-start gap-3">
            {staff.map((person) => (
              <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm" key={person.id}>
                <div className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: person.color }}><UserRound aria-hidden="true" size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{person.name}</h2><span className={`rounded-full px-2 py-1 text-xs font-semibold ${person.is_active ? "bg-green-50 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>{person.is_active ? "Ativo" : "Inativo"}</span></div>
                    {person.title ? <p className="mt-1 text-sm text-zinc-500">{person.title}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2">{person.staff_services.map(({ services: service }) => <span className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600" key={service.id}>{service.name}</span>)}</div>
                  </div>
                  {canManage ? <form action={toggleStaffAction}><input name="slug" type="hidden" value={slug} /><input name="id" type="hidden" value={person.id} /><input name="active" type="hidden" value={String(!person.is_active)} /><button className="min-h-10 rounded-xl border border-zinc-200 px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-50">{person.is_active ? "Desativar" : "Ativar"}</button></form> : null}
                </div>
              </article>
            ))}
          </section>

          {canManage ? (
            <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:self-start">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-zinc-100"><Plus aria-hidden="true" size={19} /></span><div><p className="text-xs font-semibold text-zinc-500">CADASTRO RÁPIDO</p><h2 className="font-bold">Novo profissional</h2></div></div>
              <form action={createStaffAction} className="mt-5 grid gap-4">
                <input name="slug" type="hidden" value={slug} />
                <label className="grid gap-2 text-sm font-semibold">Nome<input className="min-h-11 rounded-xl border border-zinc-200 px-3" name="name" required /></label>
                <label className="grid gap-2 text-sm font-semibold">Cargo ou especialidade<input className="min-h-11 rounded-xl border border-zinc-200 px-3" name="title" /></label>
                <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">Serviços</legend>{services.filter((service) => service.is_active).map((service) => <label className="flex min-h-10 items-center gap-3 rounded-xl border border-zinc-200 px-3 text-sm" key={service.id}><input className="size-4" name="serviceIds" type="checkbox" value={service.id} />{service.name}</label>)}</fieldset>
                <button className="min-h-11 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white">Criar profissional</button>
              </form>
            </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
