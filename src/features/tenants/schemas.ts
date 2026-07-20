import { z } from "zod";
import { hasAaContrast } from "@/lib/colors";
import { isAllowedPublicSlug } from "@/lib/slugs";

export const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(3).max(80).refine(isAllowedPublicSlug, "Escolha outro endereço."),
  segment: z.enum(["generic", "barbershop", "salon", "nails", "clinic"]),
  locationName: z.string().trim().min(2).max(100),
  address: z.string().trim().min(3).max(200),
  district: z.string().trim().max(100),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().length(2),
  postalCode: z.string().trim().max(12),
  opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  staffName: z.string().trim().min(2).max(120),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).refine((data) => data.closesAt > data.opensAt, {
  path: ["closesAt"],
  message: "O fechamento deve ser depois da abertura.",
}).refine((data) => hasAaContrast(data.primaryColor, "#FFFFFF"), {
  path: ["primaryColor"],
  message: "Escolha uma cor mais escura para manter o texto legível.",
}).refine((data) => hasAaContrast(data.accentColor, "#F6F7F8"), {
  path: ["accentColor"],
  message: "Escolha um destaque mais escuro para manter o texto legível.",
});
