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

test("preferência de tema persiste no dispositivo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Ativar tema escuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Ativar tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 245, 241)");
});
