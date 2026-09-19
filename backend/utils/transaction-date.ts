/** Convierte YYYY-MM-DD (o ISO) a ISO con mediodía UTC. */
export function normalizeTransactionDateToIso(
  value: unknown,
  fallback: Date = new Date()
): string {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`).toISOString();
  }
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return fallback.toISOString();
}

function toSafeIsoDate(value: Date): Date {
  return Number.isNaN(value.getTime()) ? new Date() : value;
}

/** Conserva hora y minuto cuando vienen en el ISO (p. ej. movimientos de caja). */
export function normalizeTransactionDateTimeToIso(
  value: unknown,
  fallback: Date = new Date()
): string {
  const safeFallback = toSafeIsoDate(fallback);
  const raw = String(value ?? '').trim();
  if (!raw || raw === '[object Object]') return safeFallback.toISOString();

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  const dateOnly = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return new Date(`${dateOnly}T12:00:00`).toISOString();
  }

  return safeFallback.toISOString();
}
