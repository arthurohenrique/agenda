import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertConfigured: vi.fn(),
  createAdminClient: vi.fn(),
  deliverNotification: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/observability/logger", () => ({ logger: mocks.logger }));
vi.mock("@/features/notifications/provider", () => ({
  assertNotificationProviderConfigured: mocks.assertConfigured,
  deliverNotification: mocks.deliverNotification,
}));

import { processOutbox } from "@/features/notifications/worker";

const event = {
  id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  aggregate_id: "00000000-0000-4000-8000-000000000003",
  event_type: "appointment.created",
  attempts: 1,
};

function query(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data, error });
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

function setupWorker({
  attempts = 1,
  completeData = true,
  completeError = null,
  deferData = true,
  deferError = null,
  servicesError = null,
  whatsappResult = { status: "skipped", reason: "channel_disabled" },
}: {
  attempts?: number;
  completeData?: boolean | null;
  completeError?: unknown;
  deferData?: boolean | null;
  deferError?: unknown;
  servicesError?: unknown;
  whatsappResult?: { status: "queued" | "blocked" | "skipped"; reason?: string };
} = {}) {
  const claimedEvent = { ...event, attempts };
  const processAdmin = {
    rpc: vi.fn(async (name: string) => {
      if (name === "claim_outbox_events") return { data: [claimedEvent], error: null };
      if (name === "complete_outbox_event") {
        return { data: completeData, error: completeError };
      }
      if (name === "defer_outbox_event") return { data: deferData, error: deferError };
      if (name === "enqueue_whatsapp_appointment_notification") {
        return { data: whatsappResult, error: null };
      }
      throw new Error("unexpected_rpc");
    }),
  };
  const queries = {
    appointments: query({
      id: event.aggregate_id,
      tenant_id: event.tenant_id,
      customer_tenant_id: "00000000-0000-4000-8000-000000000004",
      starts_at: "2026-07-29T12:00:00.000Z",
      status: "confirmed",
    }),
    customer_tenants: query({
      customer_id: "00000000-0000-4000-8000-000000000005",
    }),
    tenants: query({ id: event.tenant_id, name: "Tenant" }),
    appointment_services: query([{ name_snapshot: "Service" }], servicesError),
    customers: query({ full_name: "Customer", email: null, phone_e164: null }),
  };
  const loadAdmin = {
    from: vi.fn((table: keyof typeof queries) => queries[table]),
  };

  mocks.createAdminClient
    .mockReturnValueOnce(processAdmin)
    .mockReturnValueOnce(loadAdmin);

  return processAdmin;
}

describe("notification worker logging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.deliverNotification.mockResolvedValue({
      provider: "dry-run",
      providerMessageId: "message-id",
    });
  });

  it("validates provider configuration before claiming events", async () => {
    mocks.assertConfigured.mockImplementationOnce(() => {
      throw new Error("notification_dry_run_forbidden");
    });

    await expect(processOutbox()).rejects.toThrow("notification_dry_run_forbidden");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("treats a false completion result as a critical persistence failure", async () => {
    setupWorker({ completeData: false });

    await expect(processOutbox()).resolves.toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(mocks.logger.error).toHaveBeenCalledOnce();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "notification_completion_deferred",
      expect.objectContaining({ errorCode: "outbox_complete_failed", attempt: 1 }),
    );
  });

  it("fails the batch when deferring the retry is not applied", async () => {
    setupWorker({ deferData: false });
    mocks.deliverNotification.mockRejectedValueOnce(
      new Error("notification_provider_unavailable"),
    );

    await expect(processOutbox()).rejects.toMatchObject({
      message: "outbox_defer_failed",
      eventId: event.id,
      attempt: 1,
    });
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it("does not deliver an incomplete notification when services fail to load", async () => {
    setupWorker({ servicesError: new Error("database details") });

    await expect(processOutbox()).resolves.toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(mocks.deliverNotification).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "notification_delivery_rejected",
      expect.objectContaining({ errorCode: "notification_context_not_found" }),
    );
  });

  it("drops a reminder invalidated after claim without loading or delivering it", async () => {
    const processAdmin = setupWorker({
      whatsappResult: { status: "skipped", reason: "reminder_not_applicable" },
    });

    await expect(processOutbox()).resolves.toEqual({
      claimed: 1,
      processed: 1,
      failed: 0,
    });
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.deliverNotification).not.toHaveBeenCalled();
    expect(processAdmin.rpc).not.toHaveBeenCalledWith(
      "complete_outbox_event",
      expect.anything(),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "notification_event_skipped",
      expect.objectContaining({ errorCode: "reminder_not_applicable" }),
    );
  });

  it("surfaces permanent provider rejection once without warning spam", async () => {
    setupWorker({ attempts: 1 });
    mocks.deliverNotification.mockRejectedValueOnce(
      new Error("notification_provider_http_401"),
    );
    await processOutbox();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "notification_delivery_rejected",
      expect.objectContaining({ errorCode: "notification_provider_http_401" }),
    );

    vi.resetAllMocks();
    mocks.deliverNotification.mockRejectedValueOnce(
      new Error("notification_provider_http_401"),
    );
    setupWorker({ attempts: 3 });
    await processOutbox();
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it("suppresses repetitive retries and logs the terminal attempt", async () => {
    setupWorker({ attempts: 2 });
    mocks.deliverNotification.mockRejectedValueOnce(
      new Error("notification_provider_unavailable"),
    );

    await processOutbox();
    expect(mocks.logger.warn).not.toHaveBeenCalled();

    vi.resetAllMocks();
    mocks.deliverNotification.mockRejectedValueOnce(
      new Error("notification_provider_unavailable"),
    );
    setupWorker({ attempts: 8 });

    await processOutbox();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "notification_delivery_abandoned",
      expect.objectContaining({ attempt: 8 }),
    );
  });

  it("logs completion failures only at milestones and marks the last as terminal", async () => {
    setupWorker({ attempts: 2, completeData: false });
    await processOutbox();
    expect(mocks.logger.error).not.toHaveBeenCalled();

    vi.resetAllMocks();
    mocks.deliverNotification.mockResolvedValue({
      provider: "dry-run",
      providerMessageId: "message-id",
    });
    setupWorker({ attempts: 8, completeData: false });
    await processOutbox();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "notification_completion_abandoned",
      expect.objectContaining({ attempt: 8, errorCode: "outbox_complete_failed" }),
    );
  });
});
