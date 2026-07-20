import { getPublicEnv } from "@/lib/env";

type RequestWithHeaders = Pick<Request, "headers">;

export function isTrustedMutationRequest(
  request: RequestWithHeaders,
  appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL,
): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
