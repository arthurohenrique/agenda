import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { BarChart3, CalendarCheck2, CircleDollarSign, UserRoundCheck } from "lucide-react";
import { getReportSummary } from "@/features/reports/queries";
import { requireTenantAccess } from "@/features/tenants/access";
import { formatMoney } from "@/lib/money";

interface ReportsPageProps { params: Promise<{ slug: string }> }

export default async function ReportsPage({ params }: ReportsPageProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const today = new Date();
  const start = addDays(today, -30);
  const rangeStart = fromZonedTime(`${format(start, "yyyy-MM-dd")}T00:00:00`, tenant.timezone).toISOString();
  const rangeEnd = fromZonedTime(`${format(addDays(today, 1), "yyyy-MM-dd")}T00:00:00`, tenant.timezone).toISOString();
  const report = await getReportSummary(tenant.id, rangeStart, rangeEnd);
  const cards = [
    { label: "Agendamentos", value: String(report.total), icon: CalendarCheck2 },
    { label: "Receita prevista", value: formatMoney(report.projectedRevenueCents, tenant.currency), icon: CircleDollarSign },
    { label: "Receita realizada", value: formatMoney(report.realizedRevenueCents, tenant.currency), icon: BarChart3 },
    { label: "Clientes únicos", value: String(report.uniqueCustomers), icon: UserRoundCheck },
  ];

  return (
    <main className="page-shell"><div className="page-container max-w-6xl">
      <p className="page-eyebrow">Últimos 30 dias</p><h1 className="page-title">Relatórios</h1><p className="page-description">Visão essencial sem tirar agenda do centro da operação.</p>
      <section className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon }) => <article className="premium-card premium-card-interactive p-6 transition" key={label}><span className="grid size-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon aria-hidden="true" size={19} /></span><p className="mt-7 text-sm text-zinc-500">{label}</p><p className="mt-1 text-2xl font-bold tracking-[-0.035em]">{value}</p></article>)}</section>
      <section className="mt-6 grid gap-6 lg:grid-cols-2"><article className="premium-card p-7"><h2 className="text-lg font-bold">Serviços mais agendados</h2><div className="mt-6 grid gap-4">{report.topServices.length ? report.topServices.map((service, index) => <div className="flex items-center gap-3" key={service.name}><span className="grid size-8 place-items-center rounded-lg bg-zinc-100 text-xs font-bold">{index + 1}</span><span className="flex-1 text-sm font-semibold">{service.name}</span><span className="text-sm text-zinc-500">{service.count}</span></div>) : <p className="text-sm text-zinc-500">Sem dados no período.</p>}</div></article><article className="premium-card p-7"><h2 className="text-lg font-bold">Qualidade da agenda</h2><dl className="mt-6 grid gap-4"><div className="flex justify-between border-b border-zinc-100 pb-4"><dt className="text-sm text-zinc-500">Cancelamentos</dt><dd className="font-bold">{report.cancellations}</dd></div><div className="flex justify-between border-b border-zinc-100 pb-4"><dt className="text-sm text-zinc-500">Faltas</dt><dd className="font-bold">{report.noShows}</dd></div><div className="flex justify-between"><dt className="text-sm text-zinc-500">Origens ativas</dt><dd className="font-bold">{report.origins.length}</dd></div></dl></article></section>
    </div></main>
  );
}
