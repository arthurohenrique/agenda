import type { Metadata } from "next";
import { PlatformShell } from "@/components/platform/platform-shell";
import { requirePlatformOwner } from "@/features/platform/access";

export const metadata: Metadata = {
  title: "Operação da plataforma",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const owner = await requirePlatformOwner();
  return <PlatformShell owner={owner}>{children}</PlatformShell>;
}
