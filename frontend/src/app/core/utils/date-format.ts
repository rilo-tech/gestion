/** Etiqueta de mes/año en español (ej. «junio 2026»). */
export function formatMonthYearLabel(mes: string): string {
  const [year, month] = mes.split('-');
  if (!year || !month) return mes;
  const date = new Date(Number(year), Number(month) - 1, 1);
  const raw = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const normalized = raw.replace(/\s+de\s+/gi, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
