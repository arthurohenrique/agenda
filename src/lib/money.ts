export function formatMoney(cents: number, currency = "BRL", locale = "pt-BR") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function parseBrlToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
