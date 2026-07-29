import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { logger } from "@/lib/observability/logger";

describe("structured logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps reserved metadata and drops unknown context fields", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.error(
      "trusted_event",
      {
        errorCode: "safe_code",
        event: "overridden",
        recipientEmail: "secret@example.com",
      } as never,
    );

    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(entry.event).toBe("trusted_event");
    expect(entry.level).toBe("error");
    expect(entry.errorCode).toBe("safe_code");
    expect(entry.recipientEmail).toBeUndefined();
  });

  it("drops non-scalar values and replaces unsafe event names", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.error(
      "secret@example.com",
      {
        attempt: Number.POSITIVE_INFINITY,
        errorCode: circular,
        eventId: ["customer@example.com"],
      } as never,
    );

    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<
      string,
      unknown
    >;
    expect(entry.event).toBe("invalid_log_event");
    expect(entry.attempt).toBeUndefined();
    expect(entry.errorCode).toBeUndefined();
    expect(entry.eventId).toBeUndefined();
  });
});
