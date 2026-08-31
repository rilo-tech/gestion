import {
  getCashAmbitoLabelFromCaja,
  normalizeCajaAmbitos,
  normalizeMovementAmbito,
  parseCashAmbitoOrNull,
} from '../../utils/caja-ambitos.ts';
import {
  applyCashMovementToPeriod,
  classifyMovementPeriod,
  createCashPeriodAccumulator,
  createCashPeriodAccumulatorMap,
  getCalendarMonthBounds,
  parseMovementLocalDate,
  resolveSummaryPeriodMonthYear,
  toCashPeriodDisplay,
} from '../../utils/cash-period-summary.ts';
import { sortCashMovementsByRecency } from '../../../shared/cash-movement-sort.ts';
import { createFirestoreCashRepository } from './cash-firestore.ts';
import type { CashMovementRecord, CashRepository } from './cash-repository.ts';
import type {
  CashBalance,
  CashDayTotals,
  CashMovementListItem,
  CashMovementListPage,
  CashSummary,
} from './cash-types.ts';

export type CashQueryDeps = {
  repo?: CashRepository;
};

export type CashSummaryQuery = {
  month?: unknown;
  year?: unknown;
  reference?: Date;
};

export type CashBalanceQuery = {
  ambitoId?: string;
};

export type CashDayQuery = {
  day: string;
  ambitoId?: string;
};

export type CashMovementsQuery = {
  limit?: number;
  ambitoId?: string;
  cursor?: string;
  month?: unknown;
  year?: unknown;
  paged?: boolean;
};

function defaultRepo(): CashRepository {
  return createFirestoreCashRepository();
}

function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Misma agregación que GET /api/cash/:businessId/summary.
 * Deuda: los movimientos de caja no alimentan el reporte de ganancia.
 */
export function summarizeCashMovements(
  movements: Array<Pick<CashMovementRecord, 'tipo' | 'monto' | 'ambito' | 'fecha'>>,
  caja: Record<string, unknown>,
  period: { month: number; year: number }
): CashSummary {
  const ambitos = normalizeCajaAmbitos(caja);
  const ambitoTotals: Record<string, { ingreso: number; egreso: number }> = {};
  const ambitoIds = ambitos.map((ambito) => ambito.id);
  for (const ambito of ambitos) {
    ambitoTotals[ambito.id] = { ingreso: 0, egreso: 0 };
  }

  const { start: periodStart, end: periodEnd } = getCalendarMonthBounds(period.month, period.year);
  const periodGlobal = createCashPeriodAccumulator();
  const periodByAmbito = createCashPeriodAccumulatorMap(ambitoIds);

  let ingreso = 0;
  let egreso = 0;
  for (const data of movements) {
    const monto = Number(data.monto) || 0;
    if (monto <= 0) continue;
    const tipo = data.tipo === 'egreso' ? 'egreso' : 'ingreso';
    const ambito = normalizeMovementAmbito(data.ambito, caja);
    const bucket = classifyMovementPeriod(
      parseMovementLocalDate(String(data.fecha ?? '')),
      periodStart,
      periodEnd
    );

    applyCashMovementToPeriod(periodGlobal, tipo, monto, bucket);
    if (periodByAmbito[ambito]) {
      applyCashMovementToPeriod(periodByAmbito[ambito], tipo, monto, bucket);
    }

    if (tipo === 'egreso') {
      egreso += monto;
      if (ambitoTotals[ambito]) ambitoTotals[ambito].egreso += monto;
    } else {
      ingreso += monto;
      if (ambitoTotals[ambito]) ambitoTotals[ambito].ingreso += monto;
    }
  }

  const periodoDisplay = toCashPeriodDisplay(periodGlobal);
  const ambitosSummary: CashSummary['ambitos'] = {};
  for (const [ambitoId, totals] of Object.entries(ambitoTotals)) {
    const ambitoPeriodo = toCashPeriodDisplay(
      periodByAmbito[ambitoId] ?? createCashPeriodAccumulator()
    );
    ambitosSummary[ambitoId] = {
      ingreso: totals.ingreso,
      egreso: totals.egreso,
      saldo: totals.ingreso - totals.egreso,
      periodo: {
        mes: period.month,
        anio: period.year,
        ingreso: ambitoPeriodo.ingreso,
        egreso: ambitoPeriodo.egreso,
      },
    };
  }

  return {
    ingreso,
    egreso,
    saldo: ingreso - egreso,
    periodo: {
      mes: period.month,
      anio: period.year,
      ingreso: periodoDisplay.ingreso,
      egreso: periodoDisplay.egreso,
    },
    ambitos: ambitosSummary,
  };
}

export function balanceFromSummary(
  summary: CashSummary,
  caja: Record<string, unknown>,
  ambitoId?: string,
  empty = false
): CashBalance {
  const ambitos = normalizeCajaAmbitos(caja);
  const byAmbito = ambitos.map((ambito) => ({
    id: ambito.id,
    label: ambito.label,
    saldo: summary.ambitos[ambito.id]?.saldo ?? 0,
  }));
  for (const [id, row] of Object.entries(summary.ambitos)) {
    if (ambitos.some((ambito) => ambito.id === id)) continue;
    if (!row.saldo) continue;
    byAmbito.push({ id, label: getCashAmbitoLabelFromCaja(id, caja), saldo: row.saldo });
  }

  const scoped = ambitoId ? parseCashAmbitoOrNull(ambitoId, caja) : null;
  if (scoped) {
    const match = byAmbito.find((row) => row.id === scoped);
    return {
      saldo: match?.saldo ?? 0,
      scope: scoped,
      byAmbito,
      empty,
    };
  }

  return { saldo: summary.saldo, byAmbito, empty };
}

export function dayTotalsFromMovements(
  movements: Array<Pick<CashMovementRecord, 'tipo' | 'monto' | 'ambito' | 'fecha'>>,
  caja: Record<string, unknown>,
  day: string,
  ambitoId?: string
): CashDayTotals {
  const scoped = ambitoId ? parseCashAmbitoOrNull(ambitoId, caja) : null;
  let ingresos = 0;
  let egresos = 0;
  let count = 0;
  for (const data of movements) {
    const fecha = parseMovementLocalDate(String(data.fecha ?? ''));
    if (!fecha || localDayKey(fecha) !== day) continue;
    if (scoped && normalizeMovementAmbito(data.ambito, caja) !== scoped) continue;
    const monto = Number(data.monto) || 0;
    if (data.tipo === 'egreso') egresos += monto;
    else ingresos += monto;
    count += 1;
  }
  return { ingresos, egresos, neto: ingresos - egresos, count };
}

export async function getCashSummary(
  businessId: string,
  query: CashSummaryQuery = {},
  deps: CashQueryDeps = {}
): Promise<CashSummary> {
  const repo = deps.repo ?? defaultRepo();
  const caja = await repo.loadCajaConfig(businessId);
  const { month, year } = resolveSummaryPeriodMonthYear(
    query.month,
    query.year,
    query.reference ?? new Date()
  );
  const movements = await repo.listAllMovements(businessId);
  return summarizeCashMovements(movements, caja, { month, year });
}

export async function getCashBalance(
  businessId: string,
  query: CashBalanceQuery = {},
  deps: CashQueryDeps = {}
): Promise<CashBalance> {
  const repo = deps.repo ?? defaultRepo();
  const caja = await repo.loadCajaConfig(businessId);
  const movements = await repo.listAllMovements(businessId);
  const { month, year } = resolveSummaryPeriodMonthYear(undefined, undefined);
  const summary = summarizeCashMovements(movements, caja, { month, year });
  return balanceFromSummary(summary, caja, query.ambitoId, movements.length === 0);
}

export async function getCashDayTotals(
  businessId: string,
  query: CashDayQuery,
  deps: CashQueryDeps = {}
): Promise<CashDayTotals> {
  const repo = deps.repo ?? defaultRepo();
  const caja = await repo.loadCajaConfig(businessId);
  const movements = await repo.listAllMovements(businessId);
  return dayTotalsFromMovements(movements, caja, query.day, query.ambitoId);
}

export async function getCashMovements(
  businessId: string,
  query: CashMovementsQuery = {},
  deps: CashQueryDeps = {}
): Promise<CashMovementListItem[] | CashMovementListPage> {
  const repo = deps.repo ?? defaultRepo();
  const caja = await repo.loadCajaConfig(businessId);
  const scoped = query.ambitoId ? parseCashAmbitoOrNull(query.ambitoId, caja) : null;

  if (query.paged) {
    const requestedLimit = Number(query.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
      : 120;
    const monthNum = Number(query.month);
    const yearNum = Number(query.year);
    let startIso: string | undefined;
    let endIso: string | undefined;
    if (
      Number.isFinite(monthNum) &&
      monthNum >= 1 &&
      monthNum <= 12 &&
      Number.isFinite(yearNum) &&
      yearNum >= 2000 &&
      yearNum <= 2100
    ) {
      const { start, end } = getCalendarMonthBounds(Math.trunc(monthNum), Math.trunc(yearNum));
      startIso = start.toISOString();
      endIso = end.toISOString();
    }
    const page = await repo.listMovementsPaged(businessId, {
      limit,
      cursor: query.cursor,
      startIso,
      endIso,
    });
    const items = scoped
      ? page.items.filter((row) => normalizeMovementAmbito(row.ambito, caja) === scoped)
      : page.items;
    return {
      items: items as CashMovementListItem[],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  const all = await repo.listAllMovements(businessId);
  const filtered = scoped
    ? all.filter((row) => normalizeMovementAmbito(row.ambito, caja) === scoped)
    : all;
  const sorted = sortCashMovementsByRecency(filtered);
  const limit = Number(query.limit);
  const items = Number.isFinite(limit) && limit > 0 ? sorted.slice(0, Math.trunc(limit)) : sorted;
  return items as CashMovementListItem[];
}
