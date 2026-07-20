import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";
import { isRuntimeReady } from "@/lib/env";

export function GET() {
  const configured = isRuntimeReady();
  return NextResponse.json(
    {
      status: configured ? "ok" : "degraded",
      version: packageJson.version,
    },
    {
      status: configured ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
