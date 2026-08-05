import { WhatsAppDiagnostics } from "@/components/whatsapp/whatsapp-diagnostics";
import { getPlatformWhatsAppOverview } from "@/features/whatsapp/presentation/queries";

export default async function PlatformWhatsAppPage() {
  const overview = await getPlatformWhatsAppOverview();

  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="page-container">
        <p className="page-eyebrow">Plataforma</p>
        <h1 className="page-title">WhatsApp</h1>
        <p className="page-description">Diagnóstico do canal oficial, ativos conectados e operação simulada.</p>
        <div className="mt-10"><WhatsAppDiagnostics overview={overview} /></div>
      </div>
    </main>
  );
}
