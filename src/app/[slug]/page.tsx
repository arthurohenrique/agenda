import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking/booking-flow";
import {
  getPublicServices,
  getPublicStaff,
  getPublicTenant,
} from "@/features/booking/public-queries";
import { isSupabaseConfigured } from "@/lib/env";
import { isAllowedPublicSlug } from "@/lib/slugs";

interface PublicPageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PublicPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isSupabaseConfigured() || !isAllowedPublicSlug(slug)) return {};
  const tenant = await getPublicTenant(slug);
  if (!tenant) return {};

  const description =
    tenant.description ?? `Agende seu horário online em ${tenant.name}, de forma rápida e segura.`;

  return {
    title: `Agendar em ${tenant.name}`,
    description,
    alternates: { canonical: `/${tenant.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      title: `Agendar em ${tenant.name}`,
      description,
      url: `/${tenant.slug}`,
      siteName: tenant.name,
    },
  };
}

export default async function PublicBookingPage({ params }: PublicPageProps) {
  const { slug } = await params;
  if (!isSupabaseConfigured() || !isAllowedPublicSlug(slug)) notFound();

  const tenant = await getPublicTenant(slug);
  if (!tenant?.location) notFound();

  const [services, staff] = await Promise.all([
    getPublicServices(tenant.id),
    getPublicStaff(tenant.id),
  ]);
  const initialDate = formatInTimeZone(new Date(), tenant.timezone, "yyyy-MM-dd");
  const themeStyle = {
    "--booking-primary-brand": tenant.theme.primary,
    "--booking-accent-brand": tenant.theme.accent,
    "--booking-primary": tenant.theme.primary,
    "--booking-accent": tenant.theme.accent,
    "--booking-background": tenant.theme.background,
    "--booking-surface": tenant.theme.surface,
    "--booking-text": tenant.theme.text,
    "--booking-border": "rgb(0 0 0 / 10%)",
    "--booking-border-strong": "rgb(0 0 0 / 30%)",
    "--booking-hover": "rgb(0 0 0 / 5%)",
    "--booking-skeleton": "rgb(0 0 0 / 10%)",
    background: tenant.theme.background,
    color: tenant.theme.text,
  } as CSSProperties;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: tenant.name,
    description: tenant.description,
    telephone: tenant.phone,
    email: tenant.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: tenant.location.addressLine1,
      addressLocality: tenant.location.city,
      addressRegion: tenant.location.region,
      postalCode: tenant.location.postalCode,
      addressCountry: "BR",
    },
  };

  return (
    <main className="booking-theme min-h-dvh" style={themeStyle}>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        type="application/ld+json"
      />
      <header className="overflow-hidden bg-[var(--booking-surface)]">
        <div
          className={`mx-auto flex max-w-4xl flex-col px-5 pb-12 pt-16 sm:px-8 sm:pb-16 sm:pt-24 ${
            tenant.theme.headerAlignment === "center" ? "items-center text-center" : "items-start"
          }`}
        >
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant media URLs are runtime-configured.
              <img alt={`Logo ${tenant.name}`} className="size-10 rounded-xl border border-[var(--booking-border)] bg-white object-cover" src={tenant.logoUrl} />
            ) : (
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--booking-primary)] text-sm font-bold text-white">
                {tenant.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <p className="text-sm font-medium opacity-60">Agendamento online</p>
          </div>

          <div className="mt-12 max-w-3xl sm:mt-16">
            <p className="text-sm font-semibold text-[var(--booking-accent)]">Reserve seu horário</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[0.98] tracking-[-0.06em] sm:text-7xl lg:text-8xl">{tenant.name}</h1>
            {tenant.description ? <p className="mt-6 max-w-2xl text-lg leading-8 opacity-65">{tenant.description}</p> : null}
          </div>

          <p className="mt-10 inline-flex items-center gap-2 text-sm opacity-60">
            <MapPin aria-hidden="true" size={16} />
            {tenant.location.district ? `${tenant.location.district}, ` : ""}
            {tenant.location.city}
          </p>
        </div>
        {tenant.coverUrl ? (
          <div className="mx-auto max-w-6xl px-5 pb-6 sm:px-8 sm:pb-8">
            <div className="overflow-hidden rounded-[2rem] bg-[var(--booking-hover)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- tenant media URLs are runtime-configured. */}
              <img alt="" className="h-56 w-full object-cover sm:h-80" src={tenant.coverUrl} />
            </div>
          </div>
        ) : (
          <div aria-hidden="true" className="mx-auto h-px max-w-6xl bg-[var(--booking-border)]" />
        )}
      </header>

      {services.length ? (
        <BookingFlow initialDate={initialDate} services={services} staff={staff} tenant={tenant} />
      ) : (
        <section className="mx-auto max-w-xl px-5 py-20 text-center">
          <h2 className="text-2xl font-bold">Agenda em preparação</h2>
          <p className="mt-3 leading-7 opacity-65">
            Este estabelecimento ainda não publicou serviços para agendamento online.
          </p>
        </section>
      )}
    </main>
  );
}
