import {
  normalizeCajaAmbitos,
  normalizeMovementAmbito,
  parseCashAmbitoOrNull,
  getCashAmbitoLabelFromCaja,
} from '../../utils/caja-ambitos.ts';
import { parseMovementLocalDate } from '../../utils/cash-period-summary.ts';
import type { CashMovementRecord, CashRepository } from './cash-repository.ts';
import { createFirestoreCashRepository } from './cash-firestore.ts';

export type CashMonthlyIncomeRow = {
  period: string;
  label: string;
  year: number;
  month: number;
  ingreso: number;
  egreso: number;
  neto: number;
};

export type CashMonthlyIncomeSummary = {
  monthsRequested: number;
  monthsWithIncome: number;
  totalIngresos: number;
  totalEgresos: number;
  promedioMensualIngresos: number;
  months: CashMonthlyIncomeRow[];
  cashAccountId?: string;
  cashAccountName?: string;
};

const MONTH_LABELS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS_ES[month - 1] ?? String(month)} ${year}`;
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Últimos N meses calendario inclusive (más viejo → más nuevo), anclado en `reference`. */
export function listTrailingCalendarMonths(
  monthsRequested: number,
  reference = new Date()
): Array<{ year: number; month: number }> {
  const n = Math.min(24, Math.max(1, Math.trunc(monthsRequested) || 6));
  const out: Array<{ year: number; month: number }> = [];
  let y = reference.getFullYear();
  let m = reference.getMonth() + 1;
  for (let i = 0; i < n; i += 1) {
    out.unshift({ year: y, month: m });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function summarizeCashMonthlyIncome(
  movements: Array<Pick<CashMovementRecord, 'tipo' | 'monto' | 'ambito' | 'fecha'>>,
  caja: Record<string, unknown>,
  options: {
    months?: number;
    ambitoId?: string;
    reference?: Date;
  } = {}
): CashMonthlyIncomeSummary {
  const monthsList = listTrailingCalendarMonths(options.months ?? 6, options.reference ?? new Date());
  const scoped = options.ambitoId ? parseCashAmbitoOrNull(options.ambitoId, caja) : null;
  const buckets = new Map<string, { ingreso: number; egreso: number }>();
  for (const row of monthsList) {
    buckets.set(periodKey(row.year, row.month), { ingreso: 0, egreso: 0 });
  }

  for (const data of movements) {
    const monto = Number(data.monto) || 0;
    if (monto <= 0) continue;
    if (scoped && normalizeMovementAmbito(data.ambito, caja) !== scoped) continue;
    const date = parseMovementLocalDate(String(data.fecha ?? ''));
    if (!date) continue;
    const key = periodKey(date.getFullYear(), date.getMonth() + 1);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (data.tipo === 'egreso') bucket.egreso += monto;
    else bucket.ingreso += monto;
  }

  const months: CashMonthlyIncomeRow[] = monthsList.map((row) => {
    const key = periodKey(row.year, row.month);
    const bucket = buckets.get(key) ?? { ingreso: 0, egreso: 0 };
    return {
      period: key,
      label: monthLabel(row.year, row.month),
      year: row.year,
      month: row.month,
      ingreso: bucket.ingreso,
      egreso: bucket.egreso,
      neto: bucket.ingreso - bucket.egreso,
    };
  });

  const totalIngresos = months.reduce((sum, row) => sum + row.ingreso, 0);
  const totalEgresos = months.reduce((sum, row) => sum + row.egreso, 0);
  const monthsWithIncome = months.filter((row) => row.ingreso > 0).length;
  const promedioMensualIngresos = monthsWithIncome
    ? totalIngresos / monthsWithIncome
    : 0;

  const ambitos = normalizeCajaAmbitos(caja);
  const account =
    scoped != null
      ? {
          cashAccountId: scoped,
          cashAccountName:
            ambitos.find((row) => row.id === scoped)?.label ??
            getCashAmbitoLabelFromCaja(scoped, caja),
        }
      : {};

  return {
    monthsRequested: months.length,
    monthsWithIncome,
    totalIngresos,
    totalEgresos,
    promedioMensualIngresos,
    months,
    ...account,
  };
}

export type CashMonthlyIncomeQuery = {
  months?: number;
  ambitoId?: string;
  reference?: Date;
};

export type CashMonthlyIncomeDeps = {
  repo?: CashRepository;
};

function defaultRepo(): CashRepository {
  return createFirestoreCashRepository();
}

export async function getCashMonthlyIncomeSummary(
  businessId: string,
  query: CashMonthlyIncomeQuery = {},
  deps: CashMonthlyIncomeDeps = {}
): Promise<CashMonthlyIncomeSummary> {
  const repo = deps.repo ?? defaultRepo();
  const caja = await repo.loadCajaConfig(businessId);
  const movements = await repo.listAllMovements(businessId);
  return summarizeCashMonthlyIncome(movements, caja, query);
}
