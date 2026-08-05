import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TenantWhatsAppPanel } from "@/components/whatsapp/tenant-whatsapp-panel";
import { WhatsAppDiagnostics } from "@/components/whatsapp/whatsapp-diagnostics";
import type {
  PlatformWhatsAppOverview,
  TenantWhatsAppPresentation,
} from "@/features/whatsapp/presentation/queries";

afterEach(cleanup);

describe("painéis WhatsApp", () => {
  it("identifica mock e não apresenta conexão Meta como ativa", () => {
    const overview: PlatformWhatsAppOverview = {
      readiness: {
        provider: "mock",
        channelStatus: "disabled",
        simulatorStatus: "ready",
        realStatus: "disabled",
        missingConfiguration: ["WHATSAPP_APP_SECRET"],
      },
      businessAccounts: [],
      phoneNumbers: [],
      counts: {
        inboxPending: 0,
        outboxPending: 0,
        deadLetter: 0,
        failedMessages: 0,
        outboundMessages: 0,
      },
      diagnostics: {
        webhookUrl: "http://localhost:3000/api/integrations/whatsapp/webhook",
        lastWebhookAt: null,
        failureRate: 0,
        templatesTotal: 0,
        templatesApproved: 0,
        templatesLastSyncedAt: null,
      },
      handoffs: [{
        id: "00000000-0000-4000-8000-000000000020",
        conversationReference: "…00000020",
        contactLabel: "Contato oculto",
        requestedBy: "automation",
        reason: "routing_unresolved",
        status: "accepted",
        requestedAt: "2026-07-31T12:00:00.000Z",
      }],
      warnings: [],
    };

    render(<WhatsAppDiagnostics overview={overview} />);

    expect(screen.getByRole("heading", { name: /conexão com a Meta pendente/i })).toBeVisible();
    expect(screen.getAllByText("Provedor mock").length).toBeGreaterThan(0);
    expect(screen.getByText("WHATSAPP_APP_SECRET")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Fila sem estabelecimento" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeVisible();
    expect(screen.queryByText(/Meta ativa/i)).not.toBeInTheDocument();
  });

  it("mostra estado vazio do tenant e mantém configuração persistente disponível", () => {
    const presentation: TenantWhatsAppPresentation = {
      settings: {
        enabled: false,
        bookingEnabled: false,
        remindersEnabled: false,
        cancellationsEnabled: false,
        reschedulingEnabled: false,
        humanHandoffEnabled: false,
      humanHandoffPhone: null,
      humanHandoffEmail: null,
      welcomeMessage: null,
      unknownMessageResponse: null,
        reminder24Hours: true,
        reminder2Hours: true,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        administrativeNotice: null,
        emergencyNotice: null,
      },
      availableServices: [],
      availableLocations: [],
      selectedServiceIds: [],
      selectedLocationIds: [],
      handoffs: [],
      phoneNumber: null,
      routingMode: null,
      routingCode: null,
    bookingLink: null,
    bookingMessage: null,
    recentRoutingLinks: [],
      counts: { conversations: 0, failedMessages: 0 },
      warnings: ["Configuração WhatsApp ainda não está completa para este estabelecimento."],
    };

    render(<TenantWhatsAppPanel presentation={presentation} slug="barbearia-demo" />);

    expect(screen.getByText("Canal desabilitado")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Link ainda indisponível" })).toBeVisible();
    expect(screen.getByRole("button", { name: /salvar configuração/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /solicite teste ao operador/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /solicitar número exclusivo/i })).toBeDisabled();
  });

  it("mostra somente a fila para papel operacional e exige assunção antes da conclusão", () => {
    const presentation: TenantWhatsAppPresentation = {
      settings: {
        enabled: false,
        bookingEnabled: false,
        remindersEnabled: false,
        cancellationsEnabled: false,
        reschedulingEnabled: false,
        humanHandoffEnabled: true,
        humanHandoffPhone: null,
        humanHandoffEmail: null,
        welcomeMessage: null,
        unknownMessageResponse: null,
        reminder24Hours: true,
        reminder2Hours: true,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        administrativeNotice: null,
        emergencyNotice: null,
      },
      availableServices: [],
      availableLocations: [],
      selectedServiceIds: [],
      selectedLocationIds: [],
      handoffs: [{
        id: "00000000-0000-4000-8000-000000000010",
        conversationReference: "…00000010",
        contactLabel: "A•• · •••• 1234",
        requestedBy: "customer",
        reason: "customer_request",
        status: "requested",
        requestedAt: "2026-07-31T12:00:00.000Z",
      }],
      phoneNumber: null,
      routingMode: null,
      routingCode: null,
      bookingLink: null,
      bookingMessage: null,
      recentRoutingLinks: [],
      counts: { conversations: null, failedMessages: null },
      warnings: [],
    };

    render(
      <TenantWhatsAppPanel
        canManageSettings={false}
        presentation={presentation}
        slug="barbearia-demo"
      />,
    );

    expect(screen.getByRole("heading", { name: "Fila pendente" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Assumir atendimento" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /salvar configuração/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Concluir" })).not.toBeInTheDocument();
  });
});
