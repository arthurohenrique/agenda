import { notFound } from "next/navigation";
import { WhatsAppLiveConversations } from "@/components/whatsapp/whatsapp-live-conversations";
import { getTenantWhatsAppConversationsView } from "@/features/whatsapp/presentation/conversations";

export async function WhatsAppConversationsTab({
  tenantId,
  slug,
  timezone,
  handoffOnly,
  conversationId,
  before,
}: {
  tenantId: string;
  slug: string;
  timezone: string;
  handoffOnly: boolean;
  conversationId?: string;
  before?: string;
}) {
  const view = await getTenantWhatsAppConversationsView({
    tenantId,
    handoffOnly,
    ...(conversationId ? { conversationId } : {}),
    ...(before ? { before } : {}),
  });

  // Link direto para uma conversa que a RLS não devolve — inclusive a de outro
  // estabelecimento no mesmo número — é 404, não erro.
  if (conversationId && !view.transcript && !view.warnings.length) notFound();

  return (
    <WhatsAppLiveConversations
      slug={slug}
      tenantId={tenantId}
      timezone={timezone}
      view={view}
    />
  );
}
