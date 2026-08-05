import type { TenantRole } from "@/types/domain";

export function canManageTenantWhatsAppSettings(role: TenantRole): boolean {
  return role === "owner" || role === "admin";
}

export function canOperateTenantWhatsAppHandoffs(
  role: TenantRole,
  permissions: Record<string, boolean>,
): boolean {
  return canManageTenantWhatsAppSettings(role)
    || role === "receptionist"
    || permissions.whatsapp_handoff === true;
}
