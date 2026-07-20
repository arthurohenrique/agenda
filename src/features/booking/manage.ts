import "server-only";

import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { appointmentStatuses } from "@/types/domain";

const managedBookingSchema = z.object({
  appointmentId: z.guid(),
  tenantSlug: z.string(),
  tenantName: z.string(),
  status: z.enum(appointmentStatuses),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  staffName: z.string().nullable(),
  serviceNames: z.array(z.string()),
  locationName: z.string(),
  address: z.string(),
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
});

export type ManagedBooking = z.infer<typeof managedBookingSchema>;

export async function getManagedBooking(token: string): Promise<ManagedBooking | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_booking_by_token", {
    p_token: token,
  });
  if (error || !data) return null;
  return managedBookingSchema.parse(data);
}
