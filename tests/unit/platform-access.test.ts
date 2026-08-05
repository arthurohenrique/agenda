import { describe, expect, it } from "vitest";
import { hasPlatformOwnerClaim } from "@/features/platform/access";

describe("acesso global da plataforma", () => {
  it.each([true, "true"])("aceita platform_owner válido: %s", (platformOwner) => {
    expect(hasPlatformOwnerClaim({
      sub: "00000000-0000-4000-8000-000000000001",
      app_metadata: { platform_owner: platformOwner },
    })).toBe(true);
  });

  it.each([
    null,
    {},
    { sub: "user", platform_owner: true },
    { sub: "user", app_metadata: { platform_owner: false } },
    { sub: "user", app_metadata: { platform_owner: "false" } },
  ])("rejeita claim ausente ou fora de app_metadata", (claims) => {
    expect(hasPlatformOwnerClaim(claims)).toBe(false);
  });
});
