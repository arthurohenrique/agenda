import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/features/tenants/schemas";

const validOnboarding = {
  name: "Barbearia Central",
  slug: "barbearia-central",
  segment: "barbershop",
  locationName: "Centro",
  address: "Rua Principal, 10",
  district: "Centro",
  city: "São Paulo",
  region: "SP",
  postalCode: "01000-000",
  opensAt: "09:00",
  closesAt: "18:00",
  staffName: "Rafael",
  primaryColor: "#171717",
  accentColor: "#2563EB",
};

describe("onboarding", () => {
  it("aceita configuração inicial válida", () => {
    expect(onboardingSchema.safeParse(validOnboarding).success).toBe(true);
  });

  it("bloqueia slug reservado", () => {
    expect(onboardingSchema.safeParse({ ...validOnboarding, slug: "admin" }).success).toBe(false);
  });

  it("assume botões no WhatsApp quando o modo não é informado", () => {
    const parsed = onboardingSchema.safeParse(validOnboarding);
    expect(parsed.success && parsed.data.whatsappInteractionMode).toBe("buttons");
  });

  it("aceita modo texto e recusa modo desconhecido", () => {
    expect(
      onboardingSchema.safeParse({ ...validOnboarding, whatsappInteractionMode: "text" }).success,
    ).toBe(true);
    expect(
      onboardingSchema.safeParse({ ...validOnboarding, whatsappInteractionMode: "voice" }).success,
    ).toBe(false);
  });

  it("bloqueia cor principal sem contraste", () => {
    expect(
      onboardingSchema.safeParse({ ...validOnboarding, primaryColor: "#EEEEEE" }).success,
    ).toBe(false);
  });
});
