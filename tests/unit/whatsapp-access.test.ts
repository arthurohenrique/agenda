import { describe, expect, it } from "vitest";
import {
  canManageTenantWhatsAppSettings,
  canOperateTenantWhatsAppHandoffs,
} from "@/features/whatsapp/presentation/access";

describe("acesso ao painel WhatsApp do tenant", () => {
  it.each(["owner", "admin"] as const)("permite configuração para %s", (role) => {
    expect(canManageTenantWhatsAppSettings(role)).toBe(true);
  });

  it.each(["receptionist", "viewer", "professional"] as const)(
    "não permite configuração para %s",
    (role) => {
      expect(canManageTenantWhatsAppSettings(role)).toBe(false);
    },
  );

  it("permite a fila para recepção sem liberar configurações", () => {
    expect(canOperateTenantWhatsAppHandoffs("receptionist", {})).toBe(true);
    expect(canManageTenantWhatsAppSettings("receptionist")).toBe(false);
  });

  it("permite profissional explicitamente autorizado e bloqueia viewer comum", () => {
    expect(canOperateTenantWhatsAppHandoffs("professional", {
      whatsapp_handoff: true,
    })).toBe(true);
    expect(canOperateTenantWhatsAppHandoffs("viewer", {})).toBe(false);
  });
});
