import { expect, test } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.E2E_PASSWORD ?? "AgendaLocal123!");
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("autenticação com banco local", () => {
  test.skip(!databaseEnabled, "Requer Supabase local com seed.");

  test("usuário de um tenant abre diretamente a agenda", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await expect(page).toHaveURL(/\/app\/barbearia-central/);
    await expect(page.getByRole("region", { name: "Agenda" })).toBeVisible();
  });

  test("gestor vê a paleta do estabelecimento", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await expect(page).toHaveURL(/\/app\/barbearia-central/);
    await page.goto("/app/barbearia-central/configuracoes");
    await expect(page.getByRole("heading", { name: "Paleta 60 · 30 · 10" })).toBeVisible();
    await expect(page.locator(".palette-option")).toHaveCount(12);
    await expect(page.locator('[data-palette-preview="graphite"] [data-palette-segment="primary"]')).toHaveCSS("background-color", "rgb(23, 23, 23)");
  });

  test("usuário multi-tenant escolhe estabelecimento", async ({ page }) => {
    await login(page, "multi@agenda.local");
    await expect(page.getByRole("heading", { name: /Onde você quer trabalhar/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Barbearia Central/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Salão da Ana/ })).toBeVisible();
  });

  test("sidebar mantém a cor da marca para recepção", async ({ page }) => {
    await login(page, "multi@agenda.local");
    await page.getByRole("link", { name: /Barbearia Central/ }).click();
    await expect(page).toHaveURL(/\/app\/barbearia-central/);
    await expect(page.locator("aside.tenant-sidebar")).toHaveCSS("background-color", "rgb(17, 24, 39)");
  });

  test("slug não concede acesso a outro tenant", async ({ page }) => {
    await login(page, "dono.barbearia@agenda.local");
    await expect(page).toHaveURL(/\/app\/barbearia-central/);
    await page.goto("/app/salao-da-ana");
    await expect(page.getByRole("heading", { name: "Agenda não encontrada" })).toBeVisible();
  });
});
