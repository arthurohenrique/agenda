import { createClient } from "@supabase/supabase-js";
import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";

const shouldRun = process.env.RUN_DB_TESTS === "1";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

describe.skipIf(!shouldRun)("concorrência de reserva", () => {
  it("confirma somente uma de duas reservas simultâneas", async () => {
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceId = "41000000-0000-0000-0000-000000000001";
    const locationId = "30000000-0000-0000-0000-000000000001";
    const rangeStart = new Date();
    const rangeEnd = addDays(rangeStart, 7);

    const { data: slots, error: slotError } = await client.rpc("get_available_slots", {
      p_tenant_slug: "barbearia-central",
      p_location_id: locationId,
      p_service_ids: [serviceId],
      p_staff_id: null,
      p_range_start: rangeStart.toISOString(),
      p_range_end: rangeEnd.toISOString(),
      p_timezone: "America/Sao_Paulo",
      p_limit: 1,
    });
    expect(slotError).toBeNull();
    expect(slots).toHaveLength(1);
    const slot = slots?.[0] as { starts_at: string; staff_id: string };

    const common = {
      p_tenant_slug: "barbearia-central",
      p_location_id: locationId,
      p_service_ids: [serviceId],
      p_staff_id: slot.staff_id,
      p_starts_at: slot.starts_at,
      p_timezone: "America/Sao_Paulo",
      p_customer_email: null,
      p_customer_notes: null,
      p_rate_limit_key: `concurrency-${crypto.randomUUID().replaceAll("-", "")}`,
    };

    const [first, second] = await Promise.all([
      client.rpc("create_public_booking", {
        ...common,
        p_customer_name: "Concorrência A",
        p_customer_phone: "+5511988800011",
        p_idempotency_key: crypto.randomUUID(),
      }),
      client.rpc("create_public_booking", {
        ...common,
        p_customer_name: "Concorrência B",
        p_customer_phone: "+5511988800012",
        p_idempotency_key: crypto.randomUUID(),
      }),
    ]);

    const successes = [first, second].filter((result) => result.error === null);
    const conflicts = [first, second].filter(
      (result) => result.error?.code === "23P01",
    );
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
  });
});
