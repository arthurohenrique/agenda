import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWhatsAppBookingLink,
  maskWhatsAppContact,
  maskWhatsAppConversation,
} from "@/features/whatsapp/presentation/queries";
import {
  mergeTenantWhatsAppMetadata,
  parseTenantWhatsAppMetadata,
  tenantWhatsAppSettingsFormSchema,
} from "@/features/whatsapp/presentation/settings-contract";
import {
  bookingStartResponses,
  listResponse,
  presentOptions,
  replyButtonsResponse,
  repromptResponse,
  WHATSAPP_BUTTON_TITLE_MAX_LENGTH,
  WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH,
  WHATSAPP_LIST_ROW_TITLE_MAX_LENGTH,
} from "@/features/whatsapp/presentation/conversation-responses";
import {
  whatsappSimulatorInputSchema,
  whatsappSimulatorResponseSchema,
} from "@/features/whatsapp/presentation/simulator-contract";

describe("apresentação do WhatsApp", () => {
  it("gera link legível e codificado sem tratar código como credencial", () => {
    const result = buildWhatsAppBookingLink({
      normalizedPhoneNumber: "+5511999990001",
      displayPhoneNumber: null,
      tenantName: "Salão da Ana",
      routingCode: "ABC123",
    });

    expect(result?.message).toBe("Olá! Quero agendar na Salão da Ana. Código: ABC123");
    expect(result?.link).toBe(
      `https://wa.me/5511999990001?text=${encodeURIComponent("Olá! Quero agendar na Salão da Ana. Código: ABC123")}`,
    );
  });

  it("não gera link sem número ou código válido", () => {
    expect(buildWhatsAppBookingLink({
      normalizedPhoneNumber: "123",
      displayPhoneNumber: null,
      tenantName: "Tenant",
      routingCode: "ABC123",
    })).toBeNull();
    expect(buildWhatsAppBookingLink({
      normalizedPhoneNumber: "+5511999990001",
      displayPhoneNumber: null,
      tenantName: "Tenant",
      routingCode: null,
    })).toBeNull();
  });

  it("interpreta lembretes e horário silencioso pelo contrato consumido no banco", () => {
    expect(parseTenantWhatsAppMetadata({})).toMatchObject({
      reminder24Hours: true,
      reminder2Hours: true,
      quietHoursEnabled: false,
    });
    expect(parseTenantWhatsAppMetadata({
      reminder_minutes_before: [120],
      quiet_hours: { start: "21:30", end: "07:15" },
      administrative_notice: "Feriado",
    })).toMatchObject({
      reminder24Hours: false,
      reminder2Hours: true,
      quietHoursEnabled: true,
      quietHoursStart: "21:30",
      quietHoursEnd: "07:15",
      administrativeNotice: "Feriado",
    });
    expect(parseTenantWhatsAppMetadata({ allowed_service_ids: "inválido" }).allowedServiceIds).toEqual([]);
  });

  it("mescla preferências sem apagar metadata de outros processos", () => {
    const input = tenantWhatsAppSettingsFormSchema.parse({
      slug: "barbearia-demo",
      enabled: "on",
      bookingEnabled: "on",
      remindersEnabled: "on",
      cancellationsEnabled: undefined,
      reschedulingEnabled: undefined,
      humanHandoffEnabled: "on",
      reminder24Hours: undefined,
      reminder2Hours: "on",
      quietHoursEnabled: "on",
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      serviceIds: ["00000000-0000-4000-8000-000000000001"],
      locationIds: ["00000000-0000-4000-8000-000000000002"],
      humanHandoffPhone: "+5511999990001",
      humanHandoffEmail: "equipe@example.com",
      welcomeMessage: "Olá",
      administrativeNotice: "Aviso",
      emergencyNotice: "Emergência",
    });
    const merged = mergeTenantWhatsAppMetadata({ retained: { safe: true } }, input);

    expect(merged).toMatchObject({
      retained: { safe: true },
      reminder_minutes_before: [120],
      quiet_hours: { start: "22:00", end: "08:00" },
      allowed_service_ids: ["00000000-0000-4000-8000-000000000001"],
      allowed_location_ids: ["00000000-0000-4000-8000-000000000002"],
    });
  });

  it("mascara conversa e contato antes de montar o painel", () => {
    expect(maskWhatsAppConversation("00000000-0000-4000-8000-123456789abc")).toBe("…56789abc");
    expect(maskWhatsAppContact({
      profileName: "Ana",
      normalizedPhone: "+5511999990001",
    })).toBe("A•• · •••• 0001");
  });

  it("aceita somente evento fictício com telefone E.164 e opções fechadas", () => {
    const input = {
      receiverPhoneNumberId: "mock-phone",
      customerPhone: "+5511999990001",
      message: "Olá",
      interactionType: "text",
      simulation: { duplicate: true, providerFailure: false, outOfOrder: false, delayMs: 500 },
    };
    expect(whatsappSimulatorInputSchema.safeParse(input).success).toBe(true);
    expect(whatsappSimulatorInputSchema.safeParse({ ...input, customerPhone: "11999990001" }).success).toBe(false);
    expect(whatsappSimulatorInputSchema.safeParse({ ...input, simulation: { ...input.simulation, delayMs: 999 } }).success).toBe(false);
    expect(whatsappSimulatorInputSchema.safeParse({ ...input, interactionType: "button" }).success).toBe(false);
  });

  it("normaliza resposta mínima sem exigir detalhes do provedor", () => {
    const parsed = whatsappSimulatorResponseSchema.parse({
      conversation: null,
      tenant: null,
      responses: [{ kind: "text", body: "Escolha um estabelecimento." }],
      delivery: {
        providerFailureInjected: true,
        attempts: 2,
        firstAttempt: { claimed: 1, sent: 0, failed: 1 },
        retryAttempt: { claimed: 1, sent: 1, failed: 0 },
        recovered: true,
      },
    });
    expect(parsed.messages).toEqual([]);
    expect(parsed.responses[0]?.kind).toBe("text");
    expect(parsed.delivery?.recovered).toBe(true);
  });

  it("limita corpos de listas e botões sem alterar o limite do provedor", () => {
    const oversizedBody = "A".repeat(2000);
    const options = [{
      key: "1",
      label: "Corte",
      value: "00000000-0000-4000-8000-000000000001",
      kind: "service" as const,
    }];
    const responses = [
      listResponse(oversizedBody, "Escolher", options),
      replyButtonsResponse(oversizedBody, options, 3),
    ];

    for (const response of responses) {
      expect(response.kind === "list" || response.kind === "reply_buttons").toBe(true);
      if (response.kind !== "list" && response.kind !== "reply_buttons") continue;
      expect(response.body).toHaveLength(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
      expect(response.body.endsWith("…")).toBe(true);
    }
  });

  it("sinaliza o corte de rótulo dinâmico em vez de cortar no meio da palavra", () => {
    // `slice` cru entregava "Qualquer profissiona" ao cliente, sem indicar corte.
    const options = [{
      key: "1",
      label: "Corte masculino com barba completa",
      value: "00000000-0000-4000-8000-000000000001",
      kind: "service" as const,
    }];

    const asButtons = replyButtonsResponse("Escolha", options, 3);
    const asList = listResponse("Escolha", "Ver", options);

    expect(asButtons.kind).toBe("reply_buttons");
    if (asButtons.kind === "reply_buttons") {
      const [button] = asButtons.buttons;
      expect(button?.title).toHaveLength(WHATSAPP_BUTTON_TITLE_MAX_LENGTH);
      expect(button?.title.endsWith("…")).toBe(true);
    }

    const [row] = asList.sections[0]?.rows ?? [];
    expect(row?.title).toHaveLength(WHATSAPP_LIST_ROW_TITLE_MAX_LENGTH);
    expect(row?.title.endsWith("…")).toBe(true);
  });

  it("mantém todo rótulo estático de botão dentro do limite do WhatsApp", async () => {
    // Rótulo estático truncado é defeito de redação, não de conteúdo: o cliente
    // via "Confirmar agendament" e "Escolher outro horár".
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/features/whatsapp/application/transition-conversation.ts",
      ),
      "utf8",
    );
    const labels = [...source.matchAll(/label: "([^"]+)"/g)]
      .map(([, label]) => label)
      .filter((label): label is string => Boolean(label));

    expect(labels.length).toBeGreaterThan(10);
    // O menu principal passa de três opções e vira texto numerado, sem limite de
    // botão; "Trocar estabelecimento" é o único rótulo que depende disso.
    const buttonLabels = labels.filter((label) => label !== "Trocar estabelecimento");
    const tooLong = buttonLabels.filter(
      (label) => label.length > WHATSAPP_BUTTON_TITLE_MAX_LENGTH,
    );

    expect(tooLong).toEqual([]);
  });

  it("reapresenta as opções ao responder entrada inválida", () => {
    // Só texto deixava o cliente sem nada para tocar: o fluxo é por botão.
    const twoOptions = [
      { key: "1", label: "Sem preferência", value: "any", kind: "action" as const },
      { key: "2", label: "Quero escolher", value: "choose", kind: "action" as const },
    ];
    const manyOptions = Array.from({ length: 6 }, (_, index) => ({
      key: String(index + 1),
      label: `Serviço ${index + 1}`,
      value: `service-${index + 1}`,
      kind: "service" as const,
    }));

    const asButtons = repromptResponse("Toque em uma das opções abaixo.", twoOptions, 3);
    const asList = repromptResponse("Escolha um serviço da lista.", manyOptions, 3);
    const withoutOptions = repromptResponse("Informe um nome.", [], 3);

    expect(asButtons.kind).toBe("reply_buttons");
    expect(asList.kind).toBe("list");
    // CUSTOMER_IDENTIFICATION espera texto livre e não tem opção a reapresentar.
    expect(withoutOptions.kind).toBe("text");
  });

  it("no modo texto nunca emite botão nem lista", () => {
    const options = Array.from({ length: 6 }, (_, index) => ({
      key: String(index + 1),
      label: `Serviço ${index + 1}`,
      value: `service-${index + 1}`,
      kind: "service" as const,
    }));
    const page = { key: "more", label: "Ver mais", value: "services:6", kind: "page" as const };

    const asText = presentOptions({
      mode: "text",
      body: "Qual serviço?",
      options: [...options, page],
      maxReplyButtons: 3,
      listButtonText: "Escolher",
      hint: "Responda com o número do serviço.",
    });
    expect(asText.kind).toBe("text");
    if (asText.kind !== "text") return;
    expect(asText.body).toContain("1 — Serviço 1");
    // A chave da paginação é "more", mas o cliente escreve "mais".
    expect(asText.body).toContain("mais — Ver mais");
    expect(asText.body.endsWith("Responda com o número do serviço.")).toBe(true);

    expect(repromptResponse("Não entendi.", options.slice(0, 2), 3, "text").kind).toBe("text");
    expect(repromptResponse("Não entendi.", options, 3, "text").kind).toBe("text");

    const [start] = bookingStartResponses({
      emergencyNotice: "Emergência",
      administrativeNotice: null,
      welcomeMessage: "Olá",
      prompt: "Qual serviço deseja agendar?",
      buttonText: "Escolher",
      options,
      mode: "text",
    });
    expect(start?.kind).toBe("text");
    if (start?.kind !== "text") return;
    expect(start.body.startsWith("Emergência\n\nOlá\n\nQual serviço deseja agendar?")).toBe(true);
    expect(start.body).toContain("6 — Serviço 6");

    // Em botões o mesmo chamado continua interativo.
    expect(presentOptions({
      mode: "buttons", body: "Qual serviço?", options, maxReplyButtons: 3, listButtonText: "Escolher",
    }).kind).toBe("list");
    expect(presentOptions({
      mode: "buttons", body: "Prefere?", options: options.slice(0, 2), maxReplyButtons: 3,
    }).kind).toBe("reply_buttons");
  });

  it("no modo texto o corpo pode passar do limite interativo sem estourar o de texto", () => {
    const options = Array.from({ length: 30 }, (_, index) => ({
      key: String(index + 1),
      label: `Serviço com nome bem comprido número ${index + 1}`,
      value: `service-${index + 1}`,
      kind: "service" as const,
    }));
    const [start] = bookingStartResponses({
      emergencyNotice: "E".repeat(2000),
      administrativeNotice: "A".repeat(2000),
      welcomeMessage: "W".repeat(2000),
      prompt: "Qual serviço deseja agendar?",
      buttonText: "Escolher",
      options,
      mode: "text",
    });
    expect(start?.kind).toBe("text");
    if (start?.kind !== "text") return;
    expect(start.body.length).toBeGreaterThan(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
    expect(start.body.length).toBeLessThanOrEqual(4096);
    expect(start.body).toContain("30 — Serviço com nome bem comprido número 30");
  });

  it("preserva um prompt no limite mesmo quando avisos precisam ser omitidos", () => {
    const prompt = "P".repeat(WHATSAPP_INTERACTIVE_BODY_MAX_LENGTH);
    const [response] = bookingStartResponses({
      emergencyNotice: "Emergência",
      administrativeNotice: "Aviso",
      welcomeMessage: "Olá",
      prompt,
      buttonText: "Escolher",
      options: [{ key: "1", label: "Corte", value: "service", kind: "service" }],
    });

    expect(response?.kind).toBe("list");
    if (response?.kind !== "list") return;
    expect(response.body).toBe(prompt);
  });
});
