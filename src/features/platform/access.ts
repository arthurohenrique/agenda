import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const claimsSchema = z.object({
  sub: z.string().min(1),
  app_metadata: z
    .object({
      platform_owner: z.union([z.literal(true), z.literal("true")]).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export interface PlatformOwnerContext {
  id: string;
  email: string | null;
}

export function hasPlatformOwnerClaim(value: unknown): boolean {
  const parsed = claimsSchema.safeParse(value);
  return parsed.success && (
    parsed.data.app_metadata?.platform_owner === true
    || parsed.data.app_metadata?.platform_owner === "true"
  );
}

export const getPlatformOwnerAccess = cache(
  async (): Promise<PlatformOwnerContext | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims || !hasPlatformOwnerClaim(data.claims)) return null;

    const claims = claimsSchema.safeParse(data.claims);
    if (!claims.success || claims.data.sub !== user.id) return null;

    return user;
  },
);

export async function requirePlatformOwner(): Promise<PlatformOwnerContext> {
  const owner = await getPlatformOwnerAccess();
  if (!owner) notFound();
  return owner;
}
