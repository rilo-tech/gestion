export type CashPeriodAccumulator = {
  saldoInicial: number;
  ingresoEnPeriodo: number;
  egresoEnPeriodo: number;
};

export function createCashPeriodAccumulator(): CashPeriodAccumulator {
  return { saldoInicial: 0, ingresoEnPeriodo: 0, egresoEnPeriodo: 0 };
}

export function createCashPeriodAccumulatorMap(
  keys: string[]
): Record<string, CashPeriodAccumulator> {
  const map: Record<string, CashPeriodAccumulator> = {};
  for (const key of keys) {
    map[key] = createCashPeriodAccumulator();
  }
  return map;
}

export function parseMovementLocalDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function getCalendarMonthBounds(
  month: number,
  year: number
): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

export function resolveSummaryPeriodMonthYear(
  mes: unknown,
  anio: unknown,
  reference = new Date()
): { month: number; year: number } {
  const month = Number(mes);
  const year = Number(anio);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    const resolvedYear =
      Number.isFinite(year) && year >= 2000 && year <= 2100
        ? Math.trunc(year)
        : reference.getFullYear();
    return { month: Math.trunc(month), year: resolvedYear };
  }
  return { month: reference.getMonth() + 1, year: reference.getFullYear() };
}

export type MovementPeriodBucket = 'before' | 'in' | 'after';

export function classifyMovementPeriod(
  date: Date | null,
  periodStart: Date,
  periodEnd: Date
): MovementPeriodBucket {
  if (!date) return 'after';
  if (date < periodStart) return 'before';
  if (date <= periodEnd) return 'in';
  return 'after';
}

export function applyCashMovementToPeriod(
  acc: CashPeriodAccumulator,
  tipo: 'ingreso' | 'egreso',
  monto: number,
  bucket: MovementPeriodBucket
) {
  if (bucket === 'after' || monto <= 0) return;
  if (bucket === 'before') {
    if (tipo === 'ingreso') acc.saldoInicial += monto;
    else acc.saldoInicial -= monto;
    return;
  }
  if (tipo === 'ingreso') acc.ingresoEnPeriodo += monto;
  else acc.egresoEnPeriodo += monto;
}

export function toCashPeriodDisplay(acc: CashPeriodAccumulator) {
  return {
    ingreso: acc.saldoInicial + acc.ingresoEnPeriodo,
    egreso: acc.egresoEnPeriodo,
  };
}
