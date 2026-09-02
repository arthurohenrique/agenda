import { expect, test, type Page } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

// Conversas semeadas no MESMO número compartilhado: a primeira é da Barbearia
// Central, a segunda é do Salão da Ana.
const OWN_CONVERSATION = "95000000-0000-4000-8000-000000000001";
const OTHER_TENANT_CONVERSATION = "95000000-0000-4000-8000-000000000002";

// Endereça a conversa pelo id em vez de clicar na lista: os cenários do
// simulador rodam em paralelo nos três projetos e criam conversas novas na
// barbearia, que empurrariam a semeada para fora das trinta mais recentes.
function conversationUrl(id: string) {
  return `/app/barbearia-central/whatsapp?aba=conversas&conversa=${id}`;
}

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
    await expect(page.getByRole("region", { name: "Conversas" })).toBeVisible();
    await expect(page.getByText("Escolha uma conversa para acompanhar as mensagens.")).toBeVisible();

    await page.goto(conversationUrl(OWN_CONVERSATION));
    const transcript = page.getByRole("log");
    await expect(transcript.getByText("Olá, código BARB01").first()).toBeVisible();
    await expect(transcript.getByText("Qual serviço você deseja?").first()).toBeVisible();

    // O estado fica no cabeçalho da transcrição; a lista repete o mesmo rótulo
    // no cartão da conversa, então a asserção precisa ser escopada.
    const header = page.getByRole("region", { name: "João Cliente" });
    await expect(header.getByText("Aguardando cliente")).toBeVisible();
  });

  test("conversa de outro estabelecimento no mesmo número não é alcançável", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");

    const response = await page.goto(conversationUrl(OTHER_TENANT_CONVERSATION));
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Vou chamar um atendente.")).toHaveCount(0);
  });

  test("aba do canal continua acessível", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");

    await page.goto("/app/barbearia-central/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Conversas" })).toBeVisible();
  });
});
