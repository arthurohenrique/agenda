import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedMutationRequest } from "@/lib/security/origin";

function request(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as Pick<Request, "headers">;
}

describe("isTrustedMutationRequest", () => {
  const appUrl = "https://agenda.example.com";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the configured origin", () => {
    expect(isTrustedMutationRequest(request({ origin: appUrl }), appUrl)).toBe(true);
  });

  it("rejects another origin", () => {
    expect(
      isTrustedMutationRequest(request({ origin: "https://evil.example" }), appUrl),
    ).toBe(false);
  });

  it("accepts equivalent loopback origins during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      isTrustedMutationRequest(
        request({ origin: "http://127.0.0.1:3000" }),
        "http://localhost:3000",
      ),
    ).toBe(true);
  });

  it("rejects loopback origins using another port", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      isTrustedMutationRequest(
        request({ origin: "http://127.0.0.1:3001" }),
        "http://localhost:3000",
      ),
    ).toBe(false);
  });

  it("rejects requests marked cross-site", () => {
    expect(
      isTrustedMutationRequest(request({ "sec-fetch-site": "cross-site" }), appUrl),
    ).toBe(false);
  });

  it("allows clients without browser origin metadata", () => {
    expect(isTrustedMutationRequest(request(), appUrl)).toBe(true);
  });
});
