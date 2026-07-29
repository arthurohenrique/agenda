import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerEnv: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));

import { deliverNotification } from "@/features/notifications/provider";
import type { NotificationMessage } from "@/features/notifications/types";

const message: NotificationMessage = {
  eventId: "00000000-0000-4000-8000-000000000001",
  eventType: "appointment.created",
  tenant: {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Tenant",
  },
  appointment: {
    id: "00000000-0000-4000-8000-000000000003",
    startsAt: "2026-07-29T12:00:00.000Z",
    status: "confirmed",
    serviceNames: ["Service"],
  },
  recipient: { name: "Customer", email: null, phone: "+5511999999999" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notification provider", () => {
  it("sends the event id as an idempotency key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getServerEnv.mockReturnValue({
      NOTIFICATION_MODE: "webhook",
      NOTIFICATION_WEBHOOK_URL: "https://notifications.example.com/events",
      NOTIFICATION_WEBHOOK_SECRET: "provider-secret-value",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverNotification(message)).resolves.toEqual({
      provider: "webhook",
      providerMessageId: "provider-message",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://notifications.example.com/events",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": message.eventId }),
        redirect: "error",
      }),
    );
  });

  it("blocks production dry-run before making a request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getServerEnv.mockReturnValue({ NOTIFICATION_MODE: "dry-run" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverNotification(message)).rejects.toThrow(
      "notification_dry_run_forbidden",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
