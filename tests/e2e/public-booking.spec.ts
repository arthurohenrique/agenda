import { addBusinessDays, format } from "date-fns";
import { expect, test } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";
const projectDateOffset: Record<string, number> = {
  desktop: 0,
  safari: 1,
  mobile: 2,
};

test.describe("agendamento público", () => {
  test.skip(!databaseEnabled, "Requer Supabase local com seed.");

  test("cliente conclui fluxo sem senha", async ({ page }, testInfo) => {
    const projectOffset = projectDateOffset[testInfo.project.name] ?? 0;
    // O servidor de teste confia neste header, configurado no script
    // E2E. Cada navegador/retry recebe um IP próprio e exercita o rate limit
    // sem disputar a mesma cota de reserva pública.
    await page.setExtraHTTPHeaders({
      "x-real-ip": `198.18.0.${10 + projectOffset + testInfo.retry}`,
    });
    await page.goto("/barbearia-central");
    await expect(page.getByRole("heading", { name: "Barbearia Central" })).toBeVisible();
    await page.getByRole("button", { name: /Corte 45 min/ }).click();
    // Cada navegador reserva uma data diferente. Assim, a execução paralela do
    // CI não disputa o mesmo horário nem falha ao repetir um teste.
    const nextBusinessDay = addBusinessDays(
      new Date(),
      1 + projectOffset + testInfo.retry,
    );
    await page.getByLabel("Escolher outra data").fill(format(nextBusinessDay, "yyyy-MM-dd"));
    const slot = page.locator('button[aria-label*="com"]').first();
    await expect(slot).toBeVisible();
    await slot.click();
    await page.getByLabel("Nome completo").fill(`Cliente E2E ${testInfo.project.name}`);
    await page.getByLabel("Telefone com DDD").fill(
      testInfo.project.name === "mobile" ? "(11) 98888-1002" : "(11) 98888-1001",
    );
    await page.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(page.getByRole("heading", { name: /Já estamos cuidando disso|Seu horário está reservado/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gerenciar agendamento" })).toBeVisible();
  });
});
