import { describe, expect, it } from "vitest";
import { isTrustedMutationRequest } from "@/lib/security/origin";

function request(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as Pick<Request, "headers">;
}

describe("isTrustedMutationRequest", () => {
  const appUrl = "https://agenda.example.com";

  it("accepts the configured origin", () => {
    expect(isTrustedMutationRequest(request({ origin: appUrl }), appUrl)).toBe(true);
  });

  it("rejects another origin", () => {
    expect(
      isTrustedMutationRequest(request({ origin: "https://evil.example" }), appUrl),
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
