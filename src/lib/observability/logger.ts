import "server-only";

const contextKeys = [
  "appointmentId",
  "attempt",
  "correlationId",
  "errorCode",
  "eventId",
  "stage",
  "tenantId",
] as const;

type ContextKey = (typeof contextKeys)[number];
type ContextValue = string | number | boolean | null | undefined;
type LogContext = Partial<Record<ContextKey, ContextValue>>;

function safeContext(context: unknown): LogContext {
  if (!context || typeof context !== "object") return {};

  const input = context as Record<string, unknown>;
  const entries: Array<[ContextKey, Exclude<ContextValue, undefined>]> = [];
  for (const key of contextKeys) {
    const value = input[key];
    if (typeof value === "string") entries.push([key, value.slice(0, 120)]);
    else if (typeof value === "number" && Number.isFinite(value)) entries.push([key, value]);
    else if (typeof value === "boolean" || value === null) entries.push([key, value]);
  }
  return Object.fromEntries(entries) as LogContext;
}

function safeEvent(event: unknown): string {
  return typeof event === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(event)
    ? event
    : "invalid_log_event";
}

function write(level: "info" | "warn" | "error", event: string, context: LogContext) {
  const entry = JSON.stringify({
    ...safeContext(context),
    timestamp: new Date().toISOString(),
    level,
    event: safeEvent(event),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  info: (event: string, context: LogContext = {}) => write("info", event, context),
  warn: (event: string, context: LogContext = {}) => write("warn", event, context),
  error: (event: string, context: LogContext = {}) => write("error", event, context),
};
