import { describe, expect, it } from "vitest";
import { hasValidBearerToken } from "@/lib/security/bearer";

describe("hasValidBearerToken", () => {
  const secret = "a".repeat(32);

  it("accepts the exact bearer token", () => {
    expect(hasValidBearerToken(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects missing, malformed and different tokens", () => {
    expect(hasValidBearerToken(null, secret)).toBe(false);
    expect(hasValidBearerToken(secret, secret)).toBe(false);
    expect(hasValidBearerToken(`Bearer ${"b".repeat(32)}`, secret)).toBe(false);
  });
});
