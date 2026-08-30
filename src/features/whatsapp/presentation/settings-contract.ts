import { z } from "zod";
import {
  DEFAULT_WHATSAPP_INTERACTION_MODE,
  parseWhatsAppInteractionMode,
  whatsappInteractionModeSchema,
  type WhatsAppInteractionMode,
} from "../domain/interaction-mode";

const checkboxSchema = z
  .enum(["on"])
  .optional()
  .transform((value) => value === "on");

const nullableText = (maximum: number) => z.preprocess(
  (value) => typeof value === "string" ? value : "",
  z.string()
    .trim()
    .max(maximum)
    .transform((value) => value || null),
);

export const quietHourSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export {
  DEFAULT_WHATSAPP_INTERACTION_MODE,
  parseWhatsAppInteractionMode,
  whatsappInteractionModeSchema,
  type WhatsAppInteractionMode,
} from "../domain/interaction-mode";

export const tenantWhatsAppSettingsFormSchema = z.object({
  slug: z.string().trim().min(3).max(80),
  enabled: checkboxSchema,
  bookingEnabled: checkboxSchema,
  remindersEnabled: checkboxSchema,
  cancellationsEnabled: checkboxSchema,
  reschedulingEnabled: checkboxSchema,
  humanHandoffEnabled: checkboxSchema,
  interactionMode: whatsappInteractionModeSchema.default(DEFAULT_WHATSAPP_INTERACTION_MODE),
  reminder24Hours: checkboxSchema,
  reminder2Hours: checkboxSchema,
  quietHoursEnabled: checkboxSchema,
  quietHoursStart: quietHourSchema,
  quietHoursEnd: quietHourSchema,
  serviceIds: z.array(z.guid()).max(200),
  locationIds: z.array(z.guid()).max(100),
  humanHandoffPhone: z.string().trim().max(50),
  humanHandoffEmail: z.string().trim().max(254).refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "E-mail inválido.",
  ),
  welcomeMessage: nullableText(2000),
  unknownMessageResponse: nullableText(2000),
  administrativeNotice: nullableText(2000),
  emergencyNotice: nullableText(2000),
}).superRefine((value, context) => {
  if (value.quietHoursEnabled && value.quietHoursStart === value.quietHoursEnd) {
    context.addIssue({
      code: "custom",
      message: "O início e o fim do horário silencioso devem ser diferentes.",
      path: ["quietHoursEnd"],
    });
  }
});

export type TenantWhatsAppSettingsInput = z.infer<typeof tenantWhatsAppSettingsFormSchema>;

const metadataObjectSchema = z.record(z.string(), z.unknown());
const uuidListSchema = z.array(z.guid()).max(200);
const reminderOffsetsSchema = z.array(z.number().int()).max(20);
const quietHoursSchema = z.object({
  start: quietHourSchema,
  end: quietHourSchema,
});

export interface TenantWhatsAppMetadataPreferences {
  allowedServiceIds: string[] | null;
  allowedLocationIds: string[] | null;
  reminder24Hours: boolean;
  reminder2Hours: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  administrativeNotice: string | null;
  emergencyNotice: string | null;
  interactionMode: WhatsAppInteractionMode;
}

function optionalNotice(value: unknown): string | null {
  const parsed = z.string().trim().max(2000).safeParse(value);
  return parsed.success && parsed.data ? parsed.data : null;
}

export function asMetadataObject(value: unknown): Record<string, unknown> {
  const parsed = metadataObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function parseTenantWhatsAppMetadata(value: unknown): TenantWhatsAppMetadataPreferences {
  const metadata = asMetadataObject(value);
  const services = uuidListSchema.safeParse(metadata.allowed_service_ids);
  const locations = uuidListSchema.safeParse(metadata.allowed_location_ids);
  const offsets = reminderOffsetsSchema.safeParse(metadata.reminder_minutes_before);
  const quietHours = quietHoursSchema.safeParse(metadata.quiet_hours);
  const reminderOffsets = offsets.success ? offsets.data : [1440, 120];

  return {
    allowedServiceIds: services.success
      ? services.data
      : metadata.allowed_service_ids === undefined ? null : [],
    allowedLocationIds: locations.success
      ? locations.data
      : metadata.allowed_location_ids === undefined ? null : [],
    reminder24Hours: reminderOffsets.includes(1440),
    reminder2Hours: reminderOffsets.includes(120),
    quietHoursEnabled: quietHours.success && quietHours.data.start !== quietHours.data.end,
    quietHoursStart: quietHours.success ? quietHours.data.start : "22:00",
    quietHoursEnd: quietHours.success ? quietHours.data.end : "08:00",
    administrativeNotice: optionalNotice(metadata.administrative_notice),
    emergencyNotice: optionalNotice(metadata.emergency_notice),
    interactionMode: parseWhatsAppInteractionMode(metadata.interaction_mode),
  };
}

export function mergeTenantWhatsAppMetadata(
  current: unknown,
  input: TenantWhatsAppSettingsInput,
): Record<string, unknown> {
  const metadata = asMetadataObject(current);
  metadata.allowed_service_ids = input.serviceIds;
  metadata.allowed_location_ids = input.locationIds;
  metadata.reminder_minutes_before = [
    ...(input.reminder24Hours ? [1440] : []),
    ...(input.reminder2Hours ? [120] : []),
  ];
  metadata.administrative_notice = input.administrativeNotice;
  metadata.emergency_notice = input.emergencyNotice;
  metadata.interaction_mode = input.interactionMode;

  if (input.quietHoursEnabled) {
    metadata.quiet_hours = { start: input.quietHoursStart, end: input.quietHoursEnd };
  } else {
    delete metadata.quiet_hours;
  }

  return metadata;
}

export function settingsInputFromFormData(formData: FormData): unknown {
  return {
    slug: formData.get("slug"),
    enabled: formData.get("enabled") ?? undefined,
    bookingEnabled: formData.get("bookingEnabled") ?? undefined,
    remindersEnabled: formData.get("remindersEnabled") ?? undefined,
    cancellationsEnabled: formData.get("cancellationsEnabled") ?? undefined,
    reschedulingEnabled: formData.get("reschedulingEnabled") ?? undefined,
    humanHandoffEnabled: formData.get("humanHandoffEnabled") ?? undefined,
    interactionMode: formData.get("interactionMode") ?? undefined,
    reminder24Hours: formData.get("reminder24Hours") ?? undefined,
    reminder2Hours: formData.get("reminder2Hours") ?? undefined,
    quietHoursEnabled: formData.get("quietHoursEnabled") ?? undefined,
    quietHoursStart: formData.get("quietHoursStart"),
    quietHoursEnd: formData.get("quietHoursEnd"),
    serviceIds: formData.getAll("serviceIds"),
    locationIds: formData.getAll("locationIds"),
    humanHandoffPhone: formData.get("humanHandoffPhone"),
    humanHandoffEmail: formData.get("humanHandoffEmail"),
    welcomeMessage: formData.get("welcomeMessage"),
    unknownMessageResponse: formData.get("unknownMessageResponse"),
    administrativeNotice: formData.get("administrativeNotice"),
    emergencyNotice: formData.get("emergencyNotice"),
  };
}
