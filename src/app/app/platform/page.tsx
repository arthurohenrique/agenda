import type { Route } from "next";
import { redirect } from "next/navigation";

export default function PlatformPage() {
  redirect("/app/platform/whatsapp" as Route);
}
