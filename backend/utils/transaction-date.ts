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
