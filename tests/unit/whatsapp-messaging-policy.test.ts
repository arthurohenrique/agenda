import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import {
  getMessagingPermission,
  isExplicitOptOut,
  recordOptOut,
} from "@/features/whatsapp/application/messaging-policy";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  contact: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
};

interface QueryResult {
  data: unknown;
  error: unknown;
}

function queryChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  return chain;
}

function setupDatabase(input: {
  conversations: QueryResult;
  settings?: QueryResult;
  consent?: QueryResult;
  template?: QueryResult;
  rpc?: QueryResult;
}) {
  const queues = new Map<string, QueryResult[]>([
    ["whatsapp_conversations", [input.conversations]],
    ["tenant_whatsapp_settings", [input.settings ?? { data: null, error: null }]],
    ["whatsapp_opt_ins", [input.consent ?? { data: null, error: null }]],
    ["tenant_whatsapp_templates", [input.template ?? { data: null, error: null }]],
  ]);
  const chains: Array<{ table: string; query: ReturnType<typeof queryChain> }> = [];
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: null, error: null };
    const query = queryChain(result);
    chains.push({ table, query });
    return query;
  });
  const rpc = vi.fn(async () => input.rpc ?? { data: true, error: null });
  mocks.createAdminClient.mockReturnValue({ from, rpc });
  return { from, rpc, chains };
}

function conversation(expiresAt: string | null): QueryResult {
  return {
    data: {
      service_window_expires_at: expiresAt,
      tenant_id: ids.tenant,
      contact_id: ids.contact,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WhatsApp messaging policy", () => {
  it.each([
    "Parar",
    "SAIR!",
    "Cancelar mensagens.",
    "Não quero receber?",
    "Descadastrar",
  ])("recognizes explicit opt-out: %s", (message) => {
    expect(isExplicitOptOut(message)).toBe(true);
  });

  it("does not confuse appointment cancellation or prose with opt-out", () => {
    expect(isExplicitOptOut("Cancelar agendamento")).toBe(false);
    expect(isExplicitOptOut("Quero sair mais tarde")).toBe(false);
  });

  it("allows reactive free-form replies inside the service window without opt-in", async () => {
    setupDatabase({
      conversations: conversation("2026-08-01T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "conversation_reply",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).resolves.toEqual({ allowed: true, mode: "free_form" });
  });

  it("treats the handoff acknowledgement as a reactive reply", async () => {
    const database = setupDatabase({
      conversations: conversation("2026-08-01T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "handoff_acknowledgement",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).resolves.toEqual({ allowed: true, mode: "free_form" });

    expect(database.from).not.toHaveBeenCalledWith("whatsapp_opt_ins");
  });

  it("requires current opt-in before proactive messages", async () => {
    setupDatabase({
      conversations: conversation("2026-08-01T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
      consent: { data: null, error: null },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "appointment_reminder",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).resolves.toEqual({ allowed: false, reason: "opt_in_required" });
  });

  it("does not convert a settings outage into a permanent channel denial", async () => {
    setupDatabase({
      conversations: conversation("2026-08-01T12:00:00.000Z"),
      settings: { data: null, error: { message: "network unavailable" } },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "conversation_reply",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).rejects.toThrow("tenant_settings_query_failed");
  });

  it("blocks proactive messages after category opt-out", async () => {
    setupDatabase({
      conversations: conversation("2026-08-01T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
      consent: { data: { status: "revoked" }, error: null },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "appointment_reminder",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).resolves.toEqual({ allowed: false, reason: "contact_opted_out" });
  });

  it("requires the exact approved Meta template outside the service window", async () => {
    const database = setupDatabase({
      conversations: conversation("2026-07-30T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
      consent: { data: { status: "granted" }, error: null },
      template: {
        data: {
          enabled: true,
          whatsapp_template_definitions: {
            name: "appointment_reminder_v1",
            language: "pt_BR",
            status: "approved",
          },
        },
        error: null,
      },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "appointment_reminder",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "meta_cloud",
    })).resolves.toEqual({
      allowed: true,
      mode: "template",
      templateName: "appointment_reminder_v1",
      language: "pt_BR",
    });
    const templateQuery = database.chains.find(
      ({ table }) => table === "tenant_whatsapp_templates",
    )?.query;
    expect(templateQuery?.in).toHaveBeenCalledWith(
      "whatsapp_template_definitions.status",
      ["approved"],
    );
  });

  it("allows local draft templates only for the mock provider", async () => {
    const database = setupDatabase({
      conversations: conversation("2026-07-30T12:00:00.000Z"),
      settings: { data: { enabled: true }, error: null },
      consent: { data: { status: "granted" }, error: null },
      template: {
        data: {
          enabled: true,
          whatsapp_template_definitions: {
            name: "local_reminder",
            language: "pt_BR",
            status: "local_draft",
          },
        },
        error: null,
      },
    });

    await expect(getMessagingPermission({
      contactId: ids.contact,
      tenantId: ids.tenant,
      conversationId: ids.conversation,
      messagePurpose: "appointment_reminder",
      now: new Date("2026-07-31T12:00:00.000Z"),
      provider: "mock",
    })).resolves.toMatchObject({ allowed: true, templateName: "local_reminder" });
    const templateQuery = database.chains.find(
      ({ table }) => table === "tenant_whatsapp_templates",
    )?.query;
    expect(templateQuery?.in).toHaveBeenCalledWith(
      "whatsapp_template_definitions.status",
      ["approved", "local_draft"],
    );
  });

  it("records opt-out through the transactional RPC", async () => {
    const database = setupDatabase({
      conversations: { data: null, error: null },
    });

    await recordOptOut({
      contactId: ids.contact,
      tenantId: ids.tenant,
      sourceMessageId: "wamid.1",
    });

    expect(database.rpc).toHaveBeenCalledWith("record_whatsapp_opt_out", {
      p_contact_id: ids.contact,
      p_tenant_id: ids.tenant,
      p_source_message_id: "wamid.1",
    });
  });
});
