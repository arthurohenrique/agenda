import { expect, test } from "@playwright/test";

test("login administrativo é acessível por teclado", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entre na sua agenda" })).toBeVisible();

  const skipLink = page.getByRole("link", { name: "Pular para o conteúdo" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("E-mail")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Senha")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeFocused();
});

test("login mantém reflow em 320 px e alvo de tema tocável", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  const themeToggle = page.getByRole("button", { name: /Ativar tema (claro|escuro)/ });
  const target = await themeToggle.boundingBox();
  expect(target).not.toBeNull();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
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
