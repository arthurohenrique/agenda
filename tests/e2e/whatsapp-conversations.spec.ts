import { expect, test, type Page } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

// Conversa semeada do Salão da Ana no MESMO número compartilhado da Barbearia.
const OTHER_TENANT_CONVERSATION = "95000000-0000-4000-8000-000000000002";

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.E2E_PASSWORD ?? "AgendaLocal123!");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

test.describe("visualizador de conversas WhatsApp", () => {
  test.skip(!databaseEnabled, "Requer Supabase local com seed.");

  test("gestor abre a aba e lê a transcrição do próprio estabelecimento", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await page.goto("/app/barbearia-central/whatsapp?aba=conversas");

    const list = page.getByRole("region", { name: "Conversas" });
    await expect(list).toBeVisible();
    const conversation = list.getByRole("link", { name: /João Cliente/ });
    await expect(conversation).toBeVisible();
    await expect(page.getByText("Escolha uma conversa para acompanhar as mensagens.")).toBeVisible();

    await conversation.click();
    const transcript = page.getByRole("log");
    await expect(transcript.getByText("Olá, código BARB01")).toBeVisible();
    await expect(transcript.getByText("Qual serviço você deseja?")).toBeVisible();
    await expect(page.getByText("Aguardando cliente")).toBeVisible();
  });

  test("conversa de outro estabelecimento no mesmo número não é alcançável", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await page.goto("/app/barbearia-central/whatsapp?aba=conversas");

    await expect(page.getByRole("region", { name: "Conversas" })).toBeVisible();
    await expect(page.getByText("Luiza Cliente")).toHaveCount(0);

    const response = await page.goto(
      `/app/barbearia-central/whatsapp?aba=conversas&conversa=${OTHER_TENANT_CONVERSATION}`,
    );
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Vou chamar um atendente.")).toHaveCount(0);
  });

  test("aba do canal continua acessível", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await page.goto("/app/barbearia-central/whatsapp");
    await expect(page.getByRole("link", { name: "Conversas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "WhatsApp" })).toBeVisible();
  });
});
