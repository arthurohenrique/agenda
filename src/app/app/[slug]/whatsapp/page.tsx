import { notFound } from "next/navigation";
import { TenantWhatsAppPanel } from "@/components/whatsapp/tenant-whatsapp-panel";
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

interface TenantWhatsAppPageProps { params: Promise<{ slug: string }> }

export default async function TenantWhatsAppPage({ params }: TenantWhatsAppPageProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const canManageSettings = canManageTenantWhatsAppSettings(tenant.role);
  const canManageHandoffs = canOperateTenantWhatsAppHandoffs(
    tenant.role,
    tenant.permissions,
  );
  if (!canManageHandoffs) notFound();
  const [presentation, platformOwner] = await Promise.all([
    canManageSettings
      ? getTenantWhatsAppPresentation(tenant.id, tenant.name)
      : getTenantWhatsAppHandoffPresentation(tenant.id),
    canManageSettings ? getPlatformOwnerAccess() : Promise.resolve(null),
  ]);

  return (
    <main className="page-shell" id="main-content" tabIndex={-1}>
      <div className="page-container max-w-6xl">
        <p className="page-eyebrow">Canal de agendamento</p>
        <h1 className="page-title">WhatsApp</h1>
        <p className="page-description">
          {canManageSettings
            ? "Consulte número, políticas e link exclusivo deste estabelecimento."
            : "Assuma e conclua conversas encaminhadas para atendimento humano."}
        </p>
        <div className="mt-10">
          <TenantWhatsAppPanel
            canManageSettings={canManageSettings}
            canUsePlatformSimulator={Boolean(platformOwner)}
            presentation={presentation}
            slug={slug}
            timezone={tenant.timezone}
          />
        </div>
      </div>
    </main>
  );
}
