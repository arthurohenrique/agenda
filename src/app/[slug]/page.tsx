import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { MapPin, Phone } from "lucide-react";
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
    "--booking-primary": tenant.theme.primary,
    "--booking-accent": tenant.theme.accent,
    "--booking-background": tenant.theme.background,
    "--booking-surface": tenant.theme.surface,
    "--booking-text": tenant.theme.text,
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
    <main className="min-h-dvh" style={themeStyle}>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        type="application/ld+json"
      />
      <header className="border-b border-black/5 bg-[var(--booking-surface)]">
        <div
          className={`mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 sm:px-8 sm:py-12 ${
            tenant.theme.headerAlignment === "center" ? "items-center text-center" : "items-start"
          }`}
        >
          <div className="grid size-16 place-items-center rounded-2xl bg-[var(--booking-primary)] text-2xl font-bold text-white shadow-sm">
            {tenant.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--booking-accent)]">Agendamento online</p>
            <h1 className="mt-2 text-4xl font-bold tracking-[-0.045em] sm:text-5xl">{tenant.name}</h1>
            {tenant.description ? (
              <p className="mt-4 max-w-2xl text-base leading-7 opacity-65">{tenant.description}</p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm opacity-65">
              <span className="inline-flex items-center gap-2">
                <MapPin aria-hidden="true" size={16} />
                {tenant.location.district ? `${tenant.location.district}, ` : ""}
                {tenant.location.city}
              </span>
              {tenant.phone ? (
                <span className="inline-flex items-center gap-2">
                  <Phone aria-hidden="true" size={16} /> {tenant.phone}
                </span>
              ) : null}
            </div>
          </div>
        </div>
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
