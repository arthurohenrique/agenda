"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function AgendaRealtime({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`agenda:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          setMessage("Agenda atualizada por outra sessão.");
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_blocks",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          setMessage("Bloqueios da agenda foram atualizados.");
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, tenantId]);

  return message ? (
    <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800" role="status">
      <Radio aria-hidden="true" size={14} /> {message}
    </p>
  ) : null;
}
