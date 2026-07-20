import { expect, test } from "@playwright/test";

test("login administrativo é acessível por teclado", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entre na sua agenda" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("E-mail")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Senha")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeFocused();
});

test("recuperação não enumera contas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar acesso" })).toBeVisible();
  await expect(page.getByText(/não revela se a conta existe/i)).toBeVisible();
});
