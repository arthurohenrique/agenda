import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getBookingTokenPepper, getServerEnv } from "@/lib/env";

export function requestFingerprint(request: NextRequest, tenantSlug: string) {
  const trustedHeader = getServerEnv().TRUSTED_CLIENT_IP_HEADER;
  const ip = trustedHeader
    ? request.headers.get(trustedHeader)?.split(",")[0]?.trim() || "unavailable"
    : "unavailable";
  const pepper = getBookingTokenPepper();
  return createHash("sha256").update(`${pepper}:${tenantSlug}:${ip}`).digest("hex");
}
