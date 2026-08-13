import { describe, expect, it } from "vitest";

import { config } from "../../proxy";

const webhookPath = "/api/integrations/whatsapp/webhook";

// O matcher do proxy é uma expressão regular literal; compilá-la aqui guarda a
// regra que mantém o webhook da Meta fora de qualquer refresh de sessão.
const matchers = config.matcher.map((pattern) => new RegExp(`^${pattern}$`));

function isProxied(pathname: string): boolean {
  return matchers.some((matcher) => matcher.test(pathname));
}

describe("WhatsApp webhook public reachability", () => {
  it("keeps the Meta webhook outside the session proxy", () => {
    expect(isProxied(webhookPath)).toBe(false);
  });

  it("still proxies authenticated application routes", () => {
    expect(isProxied("/app/barbearia/configuracoes")).toBe(true);
    expect(isProxied("/onboarding")).toBe(true);
  });

  it("does not exempt neighbouring integration routes by accident", () => {
    expect(isProxied("/api/integrations/whatsapp/embedded-signup/start")).toBe(true);
  });
});
