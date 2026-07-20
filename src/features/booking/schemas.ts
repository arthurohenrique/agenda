import { z } from "zod";

export const availabilityRequestSchema = z.object({
  slug: z.string().min(3).max(80),
  locationId: z.guid(),
  serviceIds: z.array(z.guid()).min(1).max(5),
  staffId: z.guid().nullable(),
  dateFrom: z.iso.datetime({ offset: true }),
  dateTo: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(64),
});

export const bookingCustomerSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  phone: z.string().trim().min(8, "Informe um telefone válido.").max(30),
  email: z.union([z.email("Informe um e-mail válido."), z.literal("")]).optional(),
});

export const publicBookingSchema = z.object({
  slug: z.string().min(3).max(80),
  locationId: z.guid(),
  serviceIds: z.array(z.guid()).min(1).max(5),
  staffId: z.guid().nullable(),
  startsAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(64),
  customer: bookingCustomerSchema,
  notes: z.string().trim().max(800).optional().default(""),
  idempotencyKey: z.guid(),
  website: z.string().max(0).optional().default(""),
});

export type BookingCustomerInput = z.infer<typeof bookingCustomerSchema>;
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
