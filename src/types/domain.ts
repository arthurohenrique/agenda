export const tenantRoles = [
  "owner",
  "admin",
  "receptionist",
  "professional",
  "viewer",
] as const;

export type TenantRole = (typeof tenantRoles)[number];

export const appointmentStatuses = [
  "pending",
  "awaiting_approval",
  "confirmed",
  "checked_in",
  "in_service",
  "completed",
  "cancelled_by_customer",
  "cancelled_by_business",
  "no_show",
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  state: "draft" | "published" | "suspended" | "archived";
  role: TenantRole;
}

export interface PublicTenant {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  location: PublicLocation | null;
  theme: ThemeTokens;
}

export interface PublicLocation {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  district: string | null;
  city: string;
  region: string;
  postalCode: string | null;
}

export interface ThemeTokens {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  headerAlignment: "left" | "center";
  summaryPosition: "right" | "bottom";
  serviceView: "list" | "cards";
  density: "comfortable" | "compact";
  coverStyle: "none" | "small" | "wide";
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  promotionalPriceCents: number | null;
  categoryName: string | null;
  imageUrl: string | null;
  allowStaffSelection: boolean;
}

export interface PublicStaff {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  serviceIds: string[];
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
  staffId: string;
  staffName: string;
}

export interface AgendaAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  customerName: string;
  staffName: string | null;
  serviceName: string;
  totalCents: number;
}
