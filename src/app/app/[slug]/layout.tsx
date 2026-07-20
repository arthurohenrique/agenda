import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireTenantAccess } from "@/features/tenants/access";

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
  return <AdminShell tenant={tenant}>{children}</AdminShell>;
}
