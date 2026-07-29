import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

function loggingConfig() {
  const logging = nextConfig.logging;
  if (!logging) throw new Error("logging_config_missing");
  return logging;
}

function isIgnored(url: string): boolean {
  const incomingRequests = loggingConfig().incomingRequests;
  if (!incomingRequests || typeof incomingRequests === "boolean") return false;
  return incomingRequests.ignore?.some((pattern) => pattern.test(url)) ?? false;
}

describe("Next.js logging", () => {
  const token = "a".repeat(64);

  it("does not log request URLs containing booking management tokens", () => {
    expect(isIgnored("/auth/callback?code=temporary-oauth-code")).toBe(true);
    expect(isIgnored(`/clinica/reserva/${token}`)).toBe(true);
    expect(isIgnored(`/Cl%C3%ADnica%20X/reserva/${token}`)).toBe(true);
    expect(isIgnored(`/clinica/reserva/${token}?from=email`)).toBe(true);
    expect(isIgnored(`/api/bookings/${token}`)).toBe(true);
    expect(isIgnored(`/api/bookings/${token}/availability?startsAt=x`)).toBe(true);
    expect(isIgnored(`/api/bookings/${token}/reschedule`)).toBe(true);
    expect(isIgnored(`/api/bookings/${token}/future-route`)).toBe(true);
    expect(isIgnored(`/api/bookings/${"a".repeat(63)}`)).toBe(false);
    expect(isIgnored(`/api/bookings/${token}0`)).toBe(false);
    expect(isIgnored("/api/bookings/confirmed")).toBe(false);
    expect(isIgnored("/auth/callback-status")).toBe(false);
  });

  it("filters noisy development endpoints without hiding normal routes", () => {
    expect(isIgnored("/api/public/availability?tenantId=id")).toBe(true);
    expect(isIgnored("/api/app/clinica/availability?date=2026-07-29")).toBe(true);
    expect(isIgnored("/api/health")).toBe(true);
    expect(isIgnored("/api/health/?probe=readiness")).toBe(true);
    expect(isIgnored("/api/healthcheck")).toBe(false);
    expect(isIgnored("/api/public/availability-extra")).toBe(false);
    expect(isIgnored("/app/clinica")).toBe(false);
  });

  it("keeps browser errors and disables automatic Server Function argument logs", () => {
    expect(loggingConfig().browserToTerminal).toBe("error");
    expect(loggingConfig().serverFunctions).toBe(false);
  });
});
