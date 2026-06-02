import {
  CalendarMonthRange,
  getCalendarMonthRange,
  isIsoDateInRange,
  parseIsoToLocalDate,
} from './calendar-range';
import { CashMovement } from '../services/cash.service';

export type CashPeriodKpis = {
  ingreso: number;
  egreso: number;
};

export function computeCashPeriodKpisFromMovements(
  movements: CashMovement[],
  range: CalendarMonthRange,
  filterAmbito?: (movement: CashMovement) => boolean
): CashPeriodKpis {
  let saldoInicial = 0;
  let ingresoEnPeriodo = 0;
  let egresoEnPeriodo = 0;

  for (const movement of movements) {
    if (filterAmbito && !filterAmbito(movement)) continue;
    const monto = Number(movement.monto) || 0;
    if (monto <= 0) continue;

    const date = parseIsoToLocalDate(movement.fecha);
    if (!date) continue;

    if (date < range.start) {
      if (movement.tipo === 'ingreso') saldoInicial += monto;
      else saldoInicial -= monto;
      continue;
    }

    if (!isIsoDateInRange(movement.fecha, range.start, range.end)) continue;

    if (movement.tipo === 'ingreso') ingresoEnPeriodo += monto;
    else egresoEnPeriodo += monto;
  }

  return {
    ingreso: saldoInicial + ingresoEnPeriodo,
    egreso: egresoEnPeriodo,
  };
}

export function resolveCashSummaryPeriodRange(
  monthFilter: CalendarMonthRange | null
): CalendarMonthRange {
  return monthFilter ?? getCalendarMonthRange();
}
