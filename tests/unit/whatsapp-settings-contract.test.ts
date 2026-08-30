import { describe, expect, it } from "vitest";
import {
  mergeTenantWhatsAppMetadata,
  parseTenantWhatsAppMetadata,
  parseWhatsAppInteractionMode,
  tenantWhatsAppSettingsFormSchema,
} from "@/features/whatsapp/presentation/settings-contract";

const baseForm = {
  slug: "barbearia-demo",
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  serviceIds: [],
  locationIds: [],
  humanHandoffPhone: "",
  humanHandoffEmail: "",
};

describe("modo de interação do WhatsApp", () => {
  it("cai em botões quando o metadata não tem a chave ou tem valor inválido", () => {
    expect(parseWhatsAppInteractionMode(undefined)).toBe("buttons");
    expect(parseWhatsAppInteractionMode("voice")).toBe("buttons");
    expect(parseWhatsAppInteractionMode("text")).toBe("text");
    expect(parseTenantWhatsAppMetadata({}).interactionMode).toBe("buttons");
    expect(parseTenantWhatsAppMetadata({ interaction_mode: "text" }).interactionMode).toBe("text");
    expect(parseTenantWhatsAppMetadata({ interaction_mode: 42 }).interactionMode).toBe("buttons");
  });

  it("assume botões quando o formulário não envia o campo", () => {
    const parsed = tenantWhatsAppSettingsFormSchema.parse(baseForm);
    expect(parsed.interactionMode).toBe("buttons");
  });

  it("recusa modo desconhecido vindo do formulário", () => {
    expect(
      tenantWhatsAppSettingsFormSchema.safeParse({ ...baseForm, interactionMode: "voice" }).success,
    ).toBe(false);
  });

  it("grava e lê o modo no metadata sem apagar outras chaves", () => {
    const input = tenantWhatsAppSettingsFormSchema.parse({ ...baseForm, interactionMode: "text" });
    const merged = mergeTenantWhatsAppMetadata({ mode: "mock", quiet_hours: { start: "21:00", end: "07:00" } }, input);

    expect(merged.interaction_mode).toBe("text");
    expect(merged.mode).toBe("mock");
    expect(parseTenantWhatsAppMetadata(merged).interactionMode).toBe("text");

    const back = tenantWhatsAppSettingsFormSchema.parse({ ...baseForm, interactionMode: "buttons" });
    expect(parseTenantWhatsAppMetadata(mergeTenantWhatsAppMetadata(merged, back)).interactionMode).toBe("buttons");
  });
});
