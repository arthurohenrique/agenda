import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GroqIntentLlm,
  resetGroqCooldown,
} from "@/features/whatsapp/infrastructure/llm/groq-intent-llm";

const input = {
  text: "corte e barba com raul hj",
  today: "2026-08-31",
  timezone: "America/Sao_Paulo",
  services: ["Corte", "Corte e barba"],
  staff: ["Rafael", "Diego"],
};

function completion(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

describe("cliente Groq de extração", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetGroqCooldown();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client() {
    return new GroqIntentLlm({ apiKey: "k".repeat(20), model: "llama-3.3-70b-versatile", timeoutMs: 1000 });
  }

  it("extrai o JSON validado e nunca envia mais que nomes e a mensagem", async () => {
    fetchMock.mockResolvedValue(completion(JSON.stringify({
      intent: "book",
      service_name: "Corte e barba",
      requested_staff_name: "Raul",
      date: "2026-08-31",
    })));

    const result = await client().extract(input);

    expect(result).toMatchObject({ intent: "book", service_name: "Corte e barba", requested_staff_name: "Raul" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(body)).not.toContain("p1");
    expect(init?.redirect).toBe("error");
  });

  it("nunca lança: JSON inválido, erro HTTP e timeout viram null", async () => {
    fetchMock.mockResolvedValueOnce(completion("não é json"));
    expect(await client().extract(input)).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response);
    expect(await client().extract(input)).toBeNull();

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    expect(await client().extract(input)).toBeNull();
  });

  it("respeita o cooldown depois de um 429", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) } as Response);
    expect(await client().extract(input)).toBeNull();

    // A chamada seguinte nem vai à rede: a cota é por minuto.
    expect(await client().extract(input)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
