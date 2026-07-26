import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireTenantAccess } from "@/features/tenants/access";
import { getTenantTheme } from "@/features/tenants/settings-queries";

interface AdminLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  title: "Agenda administrativa",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children, params }: AdminLayoutProps) {
  const { slug } = await params;
  const tenant = await requireTenantAccess(slug);
  const theme = await getTenantTheme(tenant.id);
  return <AdminShell tenant={tenant} theme={theme}>{children}</AdminShell>;
}
