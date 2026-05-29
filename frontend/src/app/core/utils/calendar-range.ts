export interface CalendarMonthRange {
  start: Date;
  end: Date;
  month: number;
  year: number;
  /** Etiqueta legible, p. ej. «mayo de 2026». */
  label: string;
}

/** Primer instante del mes y último instante del mismo mes (hora local). */
export function getCalendarMonthRange(reference = new Date()): CalendarMonthRange {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const label = start.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return { start, end, month, year, label };
}

export function parseIsoToLocalDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isIsoDateInRange(
  iso: string | undefined,
  start: Date,
  end: Date
): boolean {
  const date = parseIsoToLocalDate(iso);
  if (!date) return false;
  return date >= start && date <= end;
}

/** mes: 1–12, anio: año calendario. */
export function parseMonthYearQueryParams(
  mes: string | null,
  anio: string | null
): CalendarMonthRange | null {
  const month = Number(mes);
  const year = Number(anio);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  return getCalendarMonthRange(new Date(year, month - 1, 1));
}

export function formatMonthYearLabel(label: string): string {
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function monthYearQueryParams(range: CalendarMonthRange): {
  mes: number;
  anio: number;
} {
  return { mes: range.month + 1, anio: range.year };
}
