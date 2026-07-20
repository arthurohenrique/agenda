import { ImageResponse } from "next/og";
import { getPublicTenant } from "@/features/booking/public-queries";
import { isSupabaseConfigured } from "@/lib/env";

export const alt = "Página de agendamento online";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = isSupabaseConfigured() ? await getPublicTenant(slug) : null;
  const name = tenant?.name ?? "Agenda";
  const description = tenant?.description ?? "Agende seu horário online.";
  const primary = tenant?.theme.primary ?? "#171717";
  const background = tenant?.theme.background ?? "#F6F7F8";
  const text = tenant?.theme.text ?? "#171717";

  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background,
        color: text,
        display: "flex",
        height: "100%",
        padding: 56,
        width: "100%",
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,.08)",
          borderRadius: 40,
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 60,
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 20 }}>
          <div
            style={{
              alignItems: "center",
              background: primary,
              borderRadius: 22,
              color: "#FFFFFF",
              display: "flex",
              fontSize: 38,
              fontWeight: 800,
              height: 80,
              justifyContent: "center",
              width: 80,
            }}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>Agendamento online</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
          <div style={{ display: "flex", fontSize: 70, fontWeight: 800, letterSpacing: "-3px", lineHeight: 1.05 }}>
            {name}
          </div>
          <div style={{ color: "#5F6368", display: "flex", fontSize: 28, lineHeight: 1.4, marginTop: 24 }}>
            {description}
          </div>
        </div>
        <div style={{ alignItems: "center", display: "flex", fontSize: 24, fontWeight: 700, justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>Escolha serviço, data e horário.</div>
          <div style={{ background: primary, borderRadius: 999, color: "#FFFFFF", display: "flex", padding: "16px 26px" }}>
            Agendar agora
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}
