import { describe, expect, it } from "vitest";
import { publicBookingSchema } from "@/features/booking/schemas";

const validBooking = {
  slug: "barbearia-central",
  locationId: "30000000-0000-0000-0000-000000000001",
  serviceIds: ["41000000-0000-0000-0000-000000000001"],
  staffId: null,
  startsAt: "2026-07-21T10:00:00-03:00",
  timezone: "America/Sao_Paulo",
  customer: { name: "João Teste", phone: "(11) 99999-0001", email: "" },
  notes: "",
  website: "",
  idempotencyKey: "90000000-0000-4000-8000-000000000001",
};

describe("entrada de agendamento público", () => {
  it("aceita payload mínimo válido", () => {
    expect(publicBookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it("rejeita lista vazia de serviços", () => {
    expect(
      publicBookingSchema.safeParse({ ...validBooking, serviceIds: [] }).success,
    ).toBe(false);
  });

  it("rejeita honeypot preenchido", () => {
    expect(
      publicBookingSchema.safeParse({ ...validBooking, website: "spam.example" }).success,
    ).toBe(false);
  });
});
