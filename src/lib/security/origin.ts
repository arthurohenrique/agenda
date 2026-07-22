import { getPublicEnv } from "@/lib/env";

type RequestWithHeaders = Pick<Request, "headers">;

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function isTrustedMutationRequest(
  request: RequestWithHeaders,
  appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL,
): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const requestOrigin = new URL(origin);
    const configuredOrigin = new URL(appUrl);

    if (requestOrigin.origin === configuredOrigin.origin) return true;

    return process.env.NODE_ENV === "development"
      && requestOrigin.protocol === configuredOrigin.protocol
      && requestOrigin.port === configuredOrigin.port
      && isLoopbackHost(requestOrigin.hostname)
      && isLoopbackHost(configuredOrigin.hostname);
  } catch {
    return false;
  }
}
