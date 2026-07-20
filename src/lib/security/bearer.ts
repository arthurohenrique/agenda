import { timingSafeEqual } from "node:crypto";

export function hasValidBearerToken(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const trusted = Buffer.from(expected, "utf8");
  return provided.length === trusted.length && timingSafeEqual(provided, trusted);
}
