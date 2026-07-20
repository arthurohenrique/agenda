import { formatInTimeZone } from "date-fns-tz";
import { CalendarClock, Phone, Search, UserRound } from "lucide-react";
import { getCustomers } from "@/features/customers/queries";
import { requireTenantAccess } from "@/features/tenants/access";

interface CustomersPageProps { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }

export default async function CustomersPage({ params, searchParams }: CustomersPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const tenant = await requireTenantAccess(slug);
  const customers = await getCustomers(tenant.id);
  const normalizedQuery = query.q?.trim().toLocaleLowerCase("pt-BR") ?? "";
  const filtered = normalizedQuery
    ? customers.filter((customer) => {
        const name = customer.display_name ?? customer.customers.full_name;
        return name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) || customer.customers.phone_e164.includes(normalizedQuery);
      })
    : customers;

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-semibold text-zinc-500">Relacionamento</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Clientes</h1><p className="mt-2 text-sm text-zinc-500">Dados operacionais privados deste estabelecimento.</p></div>
          <form className="relative"><label className="sr-only" htmlFor="customer-search">Buscar cliente</label><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" size={17} /><input className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-sm sm:w-72" defaultValue={query.q} id="customer-search" name="q" placeholder="Nome ou telefone" type="search" /></form>
        </div>

        <section className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {filtered.length ? <div className="divide-y divide-zinc-100">{filtered.map((customer) => {
            const name = customer.display_name ?? customer.customers.full_name;
            return <article className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:p-5" key={customer.id}>
              <div className="flex min-w-0 items-center gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500"><UserRound aria-hidden="true" size={19} /></span><div className="min-w-0"><h2 className="truncate font-bold">{name}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500"><Phone aria-hidden="true" size={14} />{customer.customers.phone_e164}</p></div></div>
              <div className="text-sm"><p className="text-zinc-500">Visitas</p><p className="mt-1 font-bold">{customer.appointments_count}</p></div>
              <div className="min-w-40 text-sm"><p className="text-zinc-500">Próximo horário</p><p className="mt-1 font-bold">{customer.next_appointment_at ? formatInTimeZone(customer.next_appointment_at, tenant.timezone, "dd/MM/yyyy 'às' HH:mm") : "Nenhum"}</p></div>
            </article>;
          })}</div> : <div className="p-12 text-center"><CalendarClock className="mx-auto text-zinc-400" aria-hidden="true" /><h2 className="mt-4 font-bold">Nenhum cliente encontrado</h2><p className="mt-2 text-sm text-zinc-500">Clientes aparecem após cadastro ou agendamento.</p></div>}
        </section>
      </div>
    </main>
  );
}
