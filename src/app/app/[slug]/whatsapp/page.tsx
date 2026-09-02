import { notFound } from "next/navigation";
import { TenantWhatsAppPanel } from "@/components/whatsapp/tenant-whatsapp-panel";
import { WhatsAppConversationsTab } from "@/components/whatsapp/whatsapp-conversations-tab";
import { WhatsAppPanelTabs, type WhatsAppPanelTab } from "@/components/whatsapp/whatsapp-panel-tabs";
import { getPlatformOwnerAccess } from "@/features/platform/access";
import { requireTenantAccess } from "@/features/tenants/access";
import {
  canManageTenantWhatsAppSettings,
  canOperateTenantWhatsAppHandoffs,
} from "@/features/whatsapp/presentation/access";
import {
  getTenantWhatsAppHandoffPresentation,
  getTenantWhatsAppPresentation,
} from "@/features/whatsapp/presentation/queries";

interface TenantWhatsAppPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ aba?: string; conversa?: string; antes?: string }>;
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result ? result : undefined;
}

export default async function TenantWhatsAppPage({ params, searchParams }: TenantWhatsAppPageProps) {
  const { slug } = await params;
  const { aba, conversa, antes } = await searchParams;
  const tenant = await requireTenantAccess(slug);
  const canManageSettings = canManageTenantWhatsAppSettings(tenant.role);
  const canManageHandoffs = canOperateTenantWhatsAppHandoffs(
    tenant.role,
    tenant.permissions,
  );
  if (!canManageHandoffs) notFound();

  const tab: WhatsAppPanelTab = aba === "conversas" ? "conversas" : "painel";
  // Quem só tem a permissão `whatsapp_handoff` enxerga, pela RLS, apenas as
  // conversas em atendimento humano. A lista dele é a fila, e é o servidor que
  // decide isso — nunca um parâmetro vindo do navegador.
  const handoffOnly = !canManageSettings && tenant.role !== "receptionist";

  const conversationId = trimmed(conversa);
  const before = trimmed(antes);

  // A aba de conversas não precisa de settings, readiness nem fila de handoff:
  // carregá-los aqui seria uma ida ao banco por aba trocada.
  const [presentation, platformOwner] = tab === "painel"
    ? await Promise.all([
      canManageSettings
        ? getTenantWhatsAppPresentation(tenant.id, tenant.name)
        : getTenantWhatsAppHandoffPresentation(tenant.id),
      canManageSettings ? getPlatformOwnerAccess() : Promise.resolve(null),
    ])
    : [null, null];

  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="page-container max-w-6xl">
        <p className="page-eyebrow">Canal de agendamento</p>
        <h1 className="page-title">WhatsApp</h1>
        <p className="page-description">
          {tab === "conversas"
            ? "Acompanhe ao vivo o cliente escrevendo e o bot respondendo."
            : canManageSettings
              ? "Consulte número, políticas e link exclusivo deste estabelecimento."
              : "Assuma e conclua conversas encaminhadas para atendimento humano."}
        </p>
        <div className="mt-8">
          <WhatsAppPanelTabs active={tab} slug={slug} />
        </div>
        <div className="mt-8">
          {tab === "conversas" ? (
            <WhatsAppConversationsTab
              handoffOnly={handoffOnly}
              slug={slug}
              tenantId={tenant.id}
              timezone={tenant.timezone}
              {...(conversationId ? { conversationId } : {})}
              {...(before ? { before } : {})}
            />
          ) : presentation ? (
            <TenantWhatsAppPanel
              canManageSettings={canManageSettings}
              canUsePlatformSimulator={Boolean(platformOwner)}
              presentation={presentation}
              slug={slug}
              timezone={tenant.timezone}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
