"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

// Payload de INSERT publicado por 0028_whatsapp_conversation_realtime.sql. Só
// estas colunas entram na publicação; qualquer outra coisa que apareça aqui é
// descartada em vez de renderizada.
const streamedMessageSchema = z.object({
  id: z.guid(),
  conversation_id: z.guid(),
  tenant_id: z.guid(),
  direction: z.enum(["inbound", "outbound"]),
  message_type: z.string(),
  status: z.string(),
  error_code: z.string().nullable().optional(),
  content: z.unknown(),
  created_at: z.string(),
});

export type StreamedWhatsAppMessage = z.infer<typeof streamedMessageSchema>;

export type WhatsAppStreamStatus = "connecting" | "live" | "degraded";

export function useWhatsAppMessageStream(input: {
  tenantId: string;
  onMessage: (message: StreamedWhatsAppMessage) => void;
  onReconnect: () => void;
}): WhatsAppStreamStatus {
  const [status, setStatus] = useState<WhatsAppStreamStatus>("connecting");
  const onMessageRef = useRef(input.onMessage);
  const onReconnectRef = useRef(input.onReconnect);

  useEffect(() => {
    onMessageRef.current = input.onMessage;
    onReconnectRef.current = input.onReconnect;
  });

  const { tenantId } = input;

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let subscribedOnce = false;

    // O access token expira em cerca de uma hora e o socket para de entregar
    // em silêncio. A agenda é tela de relance; esta fica aberta o dia inteiro.
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void supabase.realtime.setAuth(session.access_token);
    });

    async function subscribe() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        setStatus("degraded");
        return;
      }

      await supabase.realtime.setAuth(session.access_token);
      if (!active) return;

      // Um canal por tenant, não por conversa: `postgres_changes` aceita um
      // único filtro `coluna=op.valor`, e `tenant_id` é justamente a fronteira
      // de isolamento. `eq` nunca casa com NULL, então as mensagens ainda sem
      // estabelecimento resolvido não chegam aqui.
      channel = supabase
        .channel(`whatsapp:${tenantId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "whatsapp_messages",
            filter: `tenant_id=eq.${tenantId}`,
          },
          (payload) => {
            const parsed = streamedMessageSchema.safeParse(payload.new);
            if (!parsed.success || parsed.data.tenant_id !== tenantId) return;
            onMessageRef.current(parsed.data);
          },
        )
        .subscribe((channelStatus) => {
          if (!active) return;
          if (channelStatus === "SUBSCRIBED") {
            setStatus("live");
            // Realtime é at-most-once e não tem replay: o que chegou enquanto
            // o socket esteve fora só volta por uma releitura do servidor.
            if (subscribedOnce) onReconnectRef.current();
            subscribedOnce = true;
            return;
          }
          if (
            channelStatus === "CHANNEL_ERROR"
            || channelStatus === "TIMED_OUT"
            || channelStatus === "CLOSED"
          ) {
            setStatus("degraded");
          }
        });
    }

    void subscribe();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return status;
}
