import { describe, expect, it } from "vitest";
import { projectWhatsAppConversationContext } from "@/features/whatsapp/presentation/data-export";

describe("WhatsApp data export", () => {
  it("includes an abandoned customer draft without leaking routing internals", () => {
    const projected = projectWhatsAppConversationContext({
      schemaVersion: 1,
      locale: "pt-BR",
      booking: {
        operation: "create",
        customerName: "Cliente Teste",
        customerEmail: "cliente@example.com",
        notes: "Prefere atendimento silencioso",
        serviceId: "11111111-1111-4111-8111-111111111111",
        serviceName: "Corte",
      },
      routing: {
        source: "history",
        code: "SECRET-CONTEXT",
        searchQuery: "salão centro",
      },
      options: [{
        key: "tenant:private-id",
        label: "Outro tenant",
        value: "22222222-2222-4222-8222-222222222222",
        kind: "tenant",
      }],
      customerId: "33333333-3333-4333-8333-333333333333",
      customerTenantId: "44444444-4444-4444-8444-444444444444",
    });

    expect(projected).toMatchObject({
      bookingDraft: {
        customerName: "Cliente Teste",
        customerEmail: "cliente@example.com",
        notes: "Prefere atendimento silencioso",
        serviceName: "Corte",
      },
      searchQuery: "salão centro",
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("SECRET-CONTEXT");
    expect(serialized).not.toContain("private-id");
    expect(serialized).not.toContain("33333333-3333-4333-8333-333333333333");
  });
});
