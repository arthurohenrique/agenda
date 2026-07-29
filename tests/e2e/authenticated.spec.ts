import { expect, test } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.E2E_PASSWORD ?? "AgendaLocal123!");
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function expectFocusInside(dialog: import("@playwright/test").Locator) {
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
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

  test("menu móvel e novo agendamento gerenciam foco em 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await login(page, "dono.barbearia@agenda.local");
    await expect(page).toHaveURL(/\/app\/barbearia-central/);

    const menuTrigger = page.getByRole("button", { name: "Abrir menu" });
    await expect(menuTrigger).not.toHaveAttribute("aria-controls");
    await menuTrigger.click();

    const menuDialog = page.getByRole("dialog", { name: "Menu" });
    const closeMenu = menuDialog.getByRole("button", { name: "Fechar menu" });
    await expect(closeMenu).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expectFocusInside(menuDialog);
    await page.keyboard.press("Tab");
    await expect(closeMenu).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuDialog).toBeHidden();
    await expect(menuTrigger).toBeFocused();
    await expect(menuTrigger).not.toHaveAttribute("aria-controls");

    const blockTrigger = page.getByRole("button", { name: "Disponibilidade" });
    await blockTrigger.click();

    const blockDialog = page.getByRole("dialog", { name: "Folga e fechamento" });
    const closeBlock = blockDialog.getByRole("button", { name: "Fechar disponibilidade" });
    await expect(closeBlock).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expectFocusInside(blockDialog);
    await page.keyboard.press("Escape");
    await expect(blockDialog).toBeHidden();
    await expect(blockTrigger).toBeFocused();

    const bookingTrigger = page.getByRole("button", { name: "Novo agendamento", exact: true });
    await expect(bookingTrigger).not.toHaveAttribute("aria-controls");
    await bookingTrigger.click();

    const bookingDialog = page.getByRole("dialog", { name: "Novo agendamento" });
    const closeBooking = bookingDialog.getByRole("button", { name: "Fechar" });
    await expect(closeBooking).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expectFocusInside(bookingDialog);
    await page.keyboard.press("Tab");
    await expect(closeBooking).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bookingDialog).toBeHidden();
    await expect(bookingTrigger).toBeFocused();
  });
});
