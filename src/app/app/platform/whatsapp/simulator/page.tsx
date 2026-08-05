import { WhatsAppSimulator } from "@/components/whatsapp/whatsapp-simulator";
import { getPlatformWhatsAppOverview } from "@/features/whatsapp/presentation/queries";

function modeLabel(mode: "shared_platform" | "exclusive_platform" | "tenant_owned") {
  if (mode === "shared_platform") return "compartilhado";
  if (mode === "exclusive_platform") return "exclusivo";
  return "próprio";
}

export default async function WhatsAppSimulatorPage() {
  const overview = await getPlatformWhatsAppOverview();
  const phoneNumbers = overview.phoneNumbers
    .filter((phone) => phone.provider === "mock")
    .map((phone) => ({
      id: phone.externalPhoneNumberId,
      label:
        phone.displayPhoneNumber ??
        phone.normalizedPhoneNumber ??
        phone.externalPhoneNumberId,
      connectionMode: modeLabel(phone.connectionMode),
    }));

  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="page-container">
        <p className="page-eyebrow">WhatsApp · ambiente mock</p>
        <h1 className="page-title">Simulador de conversa</h1>
        <p className="page-description">Injete eventos fictícios, acompanhe roteamento e teste falhas sem acessar a Cloud API.</p>
        <div className="mt-10"><WhatsAppSimulator enabled={overview.readiness.simulatorStatus === "ready"} phoneNumbers={phoneNumbers} /></div>
      </div>
    </main>
  );
}
