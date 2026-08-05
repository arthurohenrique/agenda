import "server-only";

import { getWhatsAppConfig, type WhatsAppConfig } from "../../config";
import type { WhatsAppProvider } from "../../domain/provider";
import { getWhatsAppReadiness, type WhatsAppRequiredField } from "../../readiness";
import {
  MetaCloudWhatsAppProvider,
  type MetaCloudWhatsAppProviderOptions,
} from "./meta-cloud-provider";
import {
  MockWhatsAppProvider,
  type MockWhatsAppProviderOptions,
} from "./mock-provider";

export class WhatsAppProviderResolutionError extends Error {
  readonly missing: WhatsAppRequiredField[];

  constructor(code: "whatsapp_channel_disabled" | "whatsapp_provider_not_ready" | "whatsapp_simulator_disabled", missing: WhatsAppRequiredField[] = []) {
    super(code);
    this.name = "WhatsAppProviderResolutionError";
    this.missing = missing;
  }
}

export interface WhatsAppProviderResolverOptions {
  config?: WhatsAppConfig;
  mock?: MockWhatsAppProviderOptions;
  meta?: Pick<
    MetaCloudWhatsAppProviderOptions,
    "capabilities" | "fetchImplementation" | "now" | "timeoutMs"
  >;
}

export function resolveWhatsAppProvider(
  options: WhatsAppProviderResolverOptions = {},
): WhatsAppProvider {
  const config = options.config ?? getWhatsAppConfig();
  const readiness = getWhatsAppReadiness(config);
  if (readiness.channel.status === "disabled") {
    throw new WhatsAppProviderResolutionError("whatsapp_channel_disabled");
  }
  if (readiness.channel.status !== "ready") {
    throw new WhatsAppProviderResolutionError(
      "whatsapp_provider_not_ready",
      readiness.channel.missing,
    );
  }

  if (config.provider === "mock") {
    return new MockWhatsAppProvider(options.mock);
  }

  const graphApiVersion = config.graphApiVersion;
  const accessToken = config.platformAccessToken;
  const appSecret = config.appSecret;
  if (!graphApiVersion || !accessToken || !appSecret) {
    throw new WhatsAppProviderResolutionError(
      "whatsapp_provider_not_ready",
      readiness.real.missing,
    );
  }
  return new MetaCloudWhatsAppProvider({
    graphApiVersion,
    accessToken,
    appSecret,
    ...options.meta,
  });
}

export function resolveWhatsAppSimulatorProvider(
  options: WhatsAppProviderResolverOptions = {},
): MockWhatsAppProvider {
  const config = options.config ?? getWhatsAppConfig();
  const readiness = getWhatsAppReadiness(config);
  if (readiness.simulator.status !== "ready") {
    throw new WhatsAppProviderResolutionError("whatsapp_simulator_disabled");
  }
  return new MockWhatsAppProvider(options.mock);
}
