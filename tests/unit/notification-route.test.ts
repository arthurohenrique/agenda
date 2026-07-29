import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  getServerEnv: vi.fn(),
  hasValidBearerToken: vi.fn(),
  loggerError: vi.fn(),
  processOutbox: vi.fn(),
}));

vi.mock("@/features/notifications/policy", () => ({
  notificationErrorContext: mocks.classify,
}));
vi.mock("@/features/notifications/worker", () => ({
  processOutbox: mocks.processOutbox,
}));
vi.mock("@/lib/env", () => ({ getServerEnv: mocks.getServerEnv }));
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: mocks.loggerError },
}));
vi.mock("@/lib/security/bearer", () => ({
  hasValidBearerToken: mocks.hasValidBearerToken,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/notifications/route";

describe("notification worker route logging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getServerEnv.mockReturnValue({ NOTIFICATION_WORKER_SECRET: "secret" });
    mocks.hasValidBearerToken.mockReturnValue(true);
    mocks.classify.mockReturnValue({ errorCode: "outbox_claim_failed" });
  });

  it("logs one safe event when the batch fails", async () => {
    mocks.processOutbox.mockRejectedValueOnce(new Error("database details"));
    const request = new NextRequest("http://localhost/api/internal/notifications", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledOnce();
    expect(mocks.loggerError).toHaveBeenCalledWith("notification_worker_unavailable", {
      errorCode: "outbox_claim_failed",
    });
  });

  it("does not log rejected authentication attempts", async () => {
    mocks.hasValidBearerToken.mockReturnValue(false);
    const request = new NextRequest("http://localhost/api/internal/notifications", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.processOutbox).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it("reports a missing worker secret as unavailable instead of unauthorized", async () => {
    mocks.getServerEnv.mockReturnValueOnce({});
    mocks.classify.mockReturnValueOnce({ errorCode: "notification_worker_not_configured" });
    const request = new NextRequest("http://localhost/api/internal/notifications", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledWith("notification_worker_unavailable", {
      errorCode: "notification_worker_not_configured",
    });
  });

  it("converts invalid environment configuration into one safe 503 log", async () => {
    mocks.getServerEnv.mockImplementationOnce(() => {
      throw new Error("raw environment details");
    });
    mocks.classify.mockReturnValueOnce({ errorCode: "unknown_notification_error" });
    const request = new NextRequest("http://localhost/api/internal/notifications", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.loggerError).toHaveBeenCalledOnce();
    expect(mocks.loggerError).toHaveBeenCalledWith("notification_worker_unavailable", {
      errorCode: "unknown_notification_error",
    });
  });
});
