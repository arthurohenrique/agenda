import { addDays, format } from "date-fns";
import { expect, test } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

test.describe("agendamento público", () => {
  test.skip(!databaseEnabled, "Requer Supabase local com seed.");

  test("cliente conclui fluxo sem senha", async ({ page }, testInfo) => {
    await page.goto("/barbearia-central");
    await expect(page.getByRole("heading", { name: "Barbearia Central" })).toBeVisible();
    await page.getByRole("button", { name: /Corte personalizado/ }).click();
    const nextBusinessDay = addDays(new Date(), new Date().getDay() === 6 ? 2 : 1);
    await page.getByLabel("Data").fill(format(nextBusinessDay, "yyyy-MM-dd"));
    const slot = page.locator('button[aria-label*="com"]').first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByLabel("Nome completo").fill(`Cliente E2E ${testInfo.project.name}`);
    await page.getByLabel("Telefone com DDD").fill(
      testInfo.project.name === "mobile" ? "(11) 98888-1002" : "(11) 98888-1001",
    );
    await page.getByRole("button", { name: "Revisar e confirmar" }).click();
    await expect(page.getByRole("heading", { name: /Tudo certo|Aguarde a confirmação/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gerenciar agendamento" })).toBeVisible();
  });
});
