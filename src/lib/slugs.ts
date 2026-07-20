export const reservedSlugs = new Set([
  "app",
  "api",
  "auth",
  "login",
  "logout",
  "admin",
  "configuracoes",
  "definir-senha",
  "onboarding",
  "suporte",
  "status",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "_next",
]);

export function normalizeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isAllowedPublicSlug(value: string) {
  const normalized = normalizeSlug(value);
  return normalized === value && normalized.length >= 3 && !reservedSlugs.has(normalized);
}
