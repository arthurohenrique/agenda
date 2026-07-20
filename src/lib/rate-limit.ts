import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export function requestFingerprint(request: NextRequest, tenantSlug: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded ?? request.headers.get("x-real-ip") ?? "unknown";
  const pepper = process.env.BOOKING_TOKEN_PEPPER ?? "local-development-only";
  return createHash("sha256").update(`${pepper}:${tenantSlug}:${ip}`).digest("hex");
}
