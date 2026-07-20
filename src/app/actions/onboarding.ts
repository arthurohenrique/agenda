"use server";

import { redirect } from "next/navigation";
import { onboardingSchema } from "@/features/tenants/schemas";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface OnboardingState {
  status: "idle" | "error";
  message?: string;
  fields?: Record<string, string[]>;
}

export async function completeOnboardingAction(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  await requireUser();
  const parsed = onboardingSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    segment: formData.get("segment"),
    locationName: formData.get("locationName"),
    address: formData.get("address"),
    district: formData.get("district"),
    city: formData.get("city"),
    region: formData.get("region"),
    postalCode: formData.get("postalCode"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    staffName: formData.get("staffName"),
    primaryColor: formData.get("primaryColor"),
    accentColor: formData.get("accentColor"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos indicados.",
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_tenant_onboarding", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_segment: parsed.data.segment,
    p_location_name: parsed.data.locationName,
    p_address: parsed.data.address,
    p_district: parsed.data.district || null,
    p_city: parsed.data.city,
    p_region: parsed.data.region.toUpperCase(),
    p_postal_code: parsed.data.postalCode || null,
    p_opens_at: parsed.data.opensAt,
    p_closes_at: parsed.data.closesAt,
    p_staff_name: parsed.data.staffName,
    p_primary_color: parsed.data.primaryColor,
    p_accent_color: parsed.data.accentColor,
  });

  if (error) {
    const slugTaken = error.code === "23505";
    const contrast = error.message.includes("theme_contrast_below_wcag_aa");
    return {
      status: "error",
      message: slugTaken
        ? "Este endereço já está em uso. Escolha outro."
        : contrast
          ? "As cores não atingem contraste WCAG AA. Escolha uma cor principal mais escura."
          : "Não foi possível criar o estabelecimento. Tente novamente.",
    };
  }

  redirect(`/app/${parsed.data.slug}`);
}
