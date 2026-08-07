import { formatInTimeZone } from "date-fns-tz";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const databaseEnabled = process.env.RUN_E2E_DB === "1";

interface SimulatorResult {
  conversation?: {
    id: string;
    currentState?: string;
  } | null;
  tenant?: {
    name: string;
    slug?: string;
  } | null;
  appointment?: {
    id: string;
    startsAt?: string;
  } | null;
  responses?: unknown[];
  delivery?: {
    providerFailureInjected: boolean;
    attempts: 1 | 2;
    firstAttempt: { claimed: number; sent: number; failed: number };
    retryAttempt: { claimed: number; sent: number; failed: number } | null;
    recovered: boolean;
  } | null;
}

const projectDigit: Record<string, string> = {
  desktop: "1",
  safari: "2",
  mobile: "3",
};

function simulatedPhone(testInfo: TestInfo, scenario: string) {
  return `+55119${scenario}${projectDigit[testInfo.project.name] ?? "8"}000000`;
}

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(process.env.E2E_PASSWORD ?? "AgendaLocal123!");
  await page.getByRole("button", { name: "Entrar" }).click();
}

function stateValue(page: Page) {
  return page
    .getByRole("region", { name: "Estado da simulação" })
    .locator("article")
    .first()
    .locator("p")
    .last();
}

function stateFrom(result: SimulatorResult) {
  const state = result.conversation?.currentState;
  if (!state) throw new Error("simulator_state_missing");
  return state;
}

async function openSimulator(page: Page, phone: string, receiver = "mock-phone-central") {
  await login(page, "operador@agenda.local");
  await expect(page).toHaveURL(/\/app\/platform\/whatsapp/);
  await page.goto("/app/platform/whatsapp/simulator");
  await expect(page.getByRole("heading", { name: "Simulador de conversa" })).toBeVisible();
  await page.getByLabel("Número receptor").selectOption(receiver);
  await page.getByLabel("Telefone fictício do cliente").fill(phone);
}

async function sendSimulatorMessage(
  page: Page,
  input: {
    message: string;
    expectedState?: string;
    routingCode?: string;
    duplicate?: boolean;
    providerFailure?: boolean;
    outOfOrder?: boolean;
  },
) {
  await page.getByLabel("Mensagem", { exact: true }).fill(input.message);
  await page.getByLabel("Código do estabelecimento").fill(input.routingCode ?? "");
  await page.getByLabel("Webhook duplicado").setChecked(input.duplicate ?? false);
  await page.getByLabel("Falha transitória do provedor").setChecked(
    input.providerFailure ?? false,
  );
  await page.getByLabel("Evento fora de ordem").setChecked(input.outOfOrder ?? false);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/app/platform/whatsapp/simulator") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Enviar evento" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("simulator_payload_invalid");
  const result = payload as SimulatorResult;
  if (input.expectedState) {
    expect(stateFrom(result)).toBe(input.expectedState);
    await expect(stateValue(page)).toHaveText(input.expectedState);
  }
  return result;
}

async function chooseAvailableDate(page: Page, testInfo: TestInfo, shift = 0) {
  const preferred = Number(projectDigit[testInfo.project.name] ?? "1") + 1 + shift;
  const choices = Array.from({ length: 7 }, (_, index) =>
    String(((preferred - 1 + index) % 7) + 1),
  );
  for (const choice of choices) {
    const result = await sendSimulatorMessage(page, { message: choice });
    const state = stateFrom(result);
    if (state === "SLOT_SELECTION") {
      await expect(stateValue(page)).toHaveText("SLOT_SELECTION");
      return result;
    }
    expect(state).toBe("DATE_SELECTION");
  }
  throw new Error("simulator_slot_not_found");
}

function findSlotToken(value: unknown): string | null {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T[^|]+\|\d{4}-\d{2}-\d{2}T[^|]+\|[0-9a-f-]{36}\|.+$/i.test(value)
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findSlotToken(item);
      if (token) return token;
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const token = findSlotToken(item);
      if (token) return token;
    }
  }
  return null;
}

async function completeBooking(
  page: Page,
  testInfo: TestInfo,
  customerName: string,
  duplicateConfirmation = false,
) {
  await sendSimulatorMessage(page, { message: "1", expectedState: "STAFF_PREFERENCE" });
  await sendSimulatorMessage(page, { message: "1", expectedState: "DATE_SELECTION" });
  await chooseAvailableDate(page, testInfo);
  await sendSimulatorMessage(page, { message: "1", expectedState: "CUSTOMER_IDENTIFICATION" });
  await sendSimulatorMessage(page, {
    message: customerName,
    expectedState: "BOOKING_CONFIRMATION",
  });
  return sendSimulatorMessage(page, {
    message: "1",
    expectedState: "BOOKING_COMPLETED",
    duplicate: duplicateConfirmation,
  });
}

test.describe("simulador WhatsApp com banco local", () => {
  test.skip(!databaseEnabled, "Requer Supabase local com seed.");
  // Cada cenário encadeia cerca de oito idas ao servidor, e cada uma percorre webhook,
  // worker de inbox e worker de outbox antes de a interface reabilitar o formulário. O
  // orçamento padrão de 30s do Playwright não cobre isso no runner da CI, ainda mais com
  // o servidor em modo dev, que compila as rotas sob demanda. O sintoma era um
  // `locator.fill` estourando enquanto esperava o fieldset sair de `submitting`.
  test.describe.configure({ timeout: 120_000 });

  test("recupera a falha transitória com a mesma instância do provider", async ({ page }, testInfo) => {
    await openSimulator(page, simulatedPhone(testInfo, "7"));

    const result = await sendSimulatorMessage(page, {
      message: "Quero agendar",
      routingCode: "BARB01",
      providerFailure: true,
      expectedState: "SERVICE_SELECTION",
    });

    expect(result.delivery).toEqual({
      providerFailureInjected: true,
      attempts: 2,
      firstAttempt: { claimed: 1, sent: 0, failed: 1 },
      retryAttempt: { claimed: 1, sent: 1, failed: 0 },
      recovered: true,
    });
    expect(result.responses?.length).toBeGreaterThan(0);
  });

  test("primeiro contato cria uma única reserva e ela aparece na agenda", async ({ page }, testInfo) => {
    const customerName = `Cliente WhatsApp ${testInfo.project.name}`;
    await openSimulator(page, simulatedPhone(testInfo, "1"));
    await sendSimulatorMessage(page, {
      message: "Olá, quero agendar.",
      routingCode: "SALA01",
      expectedState: "SERVICE_SELECTION",
    });

    const completed = await completeBooking(page, testInfo, customerName, true);
    expect(completed.tenant?.name).toBe("Salão da Ana");
    expect(completed.appointment?.id).toBeTruthy();
    expect(completed.appointment?.startsAt).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Agendamento criado" })).toBeVisible();

    const date = formatInTimeZone(
      completed.appointment!.startsAt!,
      "America/Sao_Paulo",
      "yyyy-MM-dd",
    );
    await page.context().clearCookies();
    await login(page, "dona.salao@agenda.local");
    await page.goto(`/app/salao-da-ana?date=${date}`);
    await expect(page.getByText(customerName, { exact: true })).toHaveCount(1);
  });

  test("histórico, opção 9 e busca acrescentam um terceiro tenant", async ({ page }, testInfo) => {
    await openSimulator(page, simulatedPhone(testInfo, "2"));

    await sendSimulatorMessage(page, {
      message: "Quero agendar",
      routingCode: "BARB01",
      expectedState: "SERVICE_SELECTION",
    });
    await sendSimulatorMessage(page, { message: "Cancelar", expectedState: "CANCELLED" });
    await page.getByRole("button", { name: "Nova conversa" }).click();

    await sendSimulatorMessage(page, {
      message: "Quero agendar",
      routingCode: "SALA01",
      expectedState: "SERVICE_SELECTION",
    });
    await sendSimulatorMessage(page, { message: "Cancelar", expectedState: "CANCELLED" });
    await page.getByRole("button", { name: "Nova conversa" }).click();

    const twoTenants = await sendSimulatorMessage(page, {
      message: "Olá",
      expectedState: "TENANT_SELECTION",
    });
    expect(JSON.stringify(twoTenants.responses)).toContain("Barbearia Central");
    expect(JSON.stringify(twoTenants.responses)).toContain("Salão da Ana");
    await sendSimulatorMessage(page, { message: "9", expectedState: "TENANT_SEARCH" });
    await sendSimulatorMessage(page, {
      message: "Clínica Vida",
      expectedState: "TENANT_SELECTION",
    });
    await sendSimulatorMessage(page, { message: "1", expectedState: "SERVICE_SELECTION" });
    expect((await completeBooking(page, testInfo, `Cliente Três ${testInfo.project.name}`)).tenant?.name)
      .toBe("Clínica Vida");

    await page.getByRole("button", { name: "Nova conversa" }).click();
    const threeTenants = await sendSimulatorMessage(page, {
      message: "Olá",
      expectedState: "TENANT_SELECTION",
    });
    const options = JSON.stringify(threeTenants.responses);
    expect(options).toContain("Barbearia Central");
    expect(options).toContain("Salão da Ana");
    expect(options).toContain("Clínica Vida");
  });

  test("retorno com um único tenant pede confirmação antes de continuar", async ({ page }, testInfo) => {
    await openSimulator(page, simulatedPhone(testInfo, "4"));
    await sendSimulatorMessage(page, {
      message: "Quero agendar",
      routingCode: "BARB01",
      expectedState: "SERVICE_SELECTION",
    });
    await sendSimulatorMessage(page, { message: "Cancelar", expectedState: "CANCELLED" });
    await page.getByRole("button", { name: "Nova conversa" }).click();

    const confirmation = await sendSimulatorMessage(page, {
      message: "Olá",
      expectedState: "TENANT_CONFIRMATION",
    });
    expect(JSON.stringify(confirmation.responses)).toContain("Barbearia Central");
    await sendSimulatorMessage(page, { message: "1", expectedState: "SERVICE_SELECTION" });
  });

  test("reserva feita pelo site vence o mesmo horário e o WhatsApp oferece alternativas", async ({ page }, testInfo) => {
    await openSimulator(page, simulatedPhone(testInfo, "5"));
    await sendSimulatorMessage(page, {
      message: "Quero agendar",
      routingCode: "BARB01",
      expectedState: "SERVICE_SELECTION",
    });
    await sendSimulatorMessage(page, { message: "1", expectedState: "STAFF_PREFERENCE" });
    await sendSimulatorMessage(page, { message: "2", expectedState: "STAFF_SELECTION" });
    await sendSimulatorMessage(page, { message: "2", expectedState: "DATE_SELECTION" });
    const slotList = await chooseAvailableDate(page, testInfo, 3);
    const slotToken = findSlotToken(slotList.responses);
    if (!slotToken) throw new Error("simulator_slot_token_missing");
    const [startsAt, , , staffName] = slotToken.split("|");
    if (!startsAt || !staffName) throw new Error("simulator_slot_token_invalid");

    await page.context().setExtraHTTPHeaders({
      "x-real-ip": `198.18.1.${Number(projectDigit[testInfo.project.name] ?? "8")}`,
    });
    const publicPage = await page.context().newPage();
    await publicPage.goto("/barbearia-central");
    await publicPage.getByRole("button", { name: /Corte 45 min/ }).click();
    const localDate = formatInTimeZone(startsAt, "America/Sao_Paulo", "yyyy-MM-dd");
    const localTime = formatInTimeZone(startsAt, "America/Sao_Paulo", "HH:mm");
    await publicPage.getByLabel("Escolher outra data").fill(localDate);
    await publicPage.getByRole("button", { name: `${localTime} com ${staffName}` }).click();
    await publicPage.getByLabel("Nome completo").fill(`Concorrente Site ${testInfo.project.name}`);
    await publicPage.getByLabel("Telefone com DDD").fill(
      simulatedPhone(testInfo, "6").replace("+55", ""),
    );
    await publicPage.getByRole("button", { name: "Confirmar agendamento" }).click();
    await expect(
      publicPage.getByRole("heading", {
        name: /Já estamos cuidando disso|Seu horário está reservado/,
      }),
    ).toBeVisible();
    await publicPage.close();

    await sendSimulatorMessage(page, { message: "1", expectedState: "CUSTOMER_IDENTIFICATION" });
    await sendSimulatorMessage(page, {
      message: `Cliente Conflito ${testInfo.project.name}`,
      expectedState: "BOOKING_CONFIRMATION",
    });
    await sendSimulatorMessage(page, { message: "1", expectedState: "BOOKING_CONFLICT" });
    await expect(page.getByText("Esse horário acabou de ser reservado por outra pessoa.")).toBeVisible();
  });

  test("número direto resolve tenant, handoff suspende bot e outro tenant não acessa", async ({ page }, testInfo) => {
    await openSimulator(
      page,
      simulatedPhone(testInfo, "3"),
      "mock-phone-exclusive-clinic",
    );
    const resolved = await sendSimulatorMessage(page, {
      message: "Olá",
      expectedState: "SERVICE_SELECTION",
    });
    expect(resolved.tenant?.name).toBe("Clínica Vida");

    await sendSimulatorMessage(page, {
      message: "Quero falar com atendente",
      expectedState: "HUMAN_HANDOFF",
    });
    await sendSimulatorMessage(page, {
      message: "Menu",
      expectedState: "HUMAN_HANDOFF",
    });

    await page.context().clearCookies();
    await login(page, "dono.barbearia@agenda.local");
    await page.goto("/app/clinica-vida/whatsapp");
    await expect(page.getByRole("heading", { name: "Agenda não encontrada" })).toBeVisible();
  });
});
