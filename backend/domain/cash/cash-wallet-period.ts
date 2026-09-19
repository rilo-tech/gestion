import {
  buildCashWalletSummary,
  formatCashWalletSummaryMessage,
  type CashWalletMovement,
  type CashWalletSummary,
} from '../../../shared/cash-wallet-summary.ts';
import { getCashMovements } from './cash-query.ts';
import type { CashMovementListItem } from './cash-types.ts';

export type CashWalletPeriodKey =
  | 'today'
  | 'week'
  | 'month'
  | 'previous_month'
  | 'custom';

const DEFAULT_TZ = 'America/Montevideo';

function localParts(date: Date, timeZone = DEFAULT_TZ): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDay(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function addDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function resolveCashWalletPeriodBounds(
  period: CashWalletPeriodKey,
  options: { from?: string; to?: string; referenceDate?: Date; timeZone?: string } = {}
): { from: string; to: string; label: string } {
  const tz = options.timeZone ?? DEFAULT_TZ;
  const now = options.referenceDate ?? new Date();
  const { y, m, d } = localParts(now, tz);
  const today = isoDay(y, m, d);

  if (period === 'custom') {
    const from = String(options.from ?? today).slice(0, 10);
    const to = String(options.to ?? today).slice(0, 10);
    return { from, to, label: from === to ? from : `${from} → ${to}` };
  }
  if (period === 'today') {
    return { from: today, to: today, label: 'Hoy' };
  }
  if (period === 'week') {
    // Semana calendario lun–dom aproximada desde hoy hacia atrás 6 días
    const start = addDays(y, m, d, -6);
    return {
      from: isoDay(start.y, start.m, start.d),
      to: today,
      label: 'Esta semana',
    };
  }
  if (period === 'previous_month') {
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const lastDay = new Date(Date.UTC(prev.y, prev.m, 0)).getUTCDate();
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    return {
      from: isoDay(prev.y, prev.m, 1),
      to: isoDay(prev.y, prev.m, lastDay),
      label: monthNames[prev.m - 1] ?? 'Mes anterior',
    };
  }
  // month
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  return {
    from: isoDay(y, m, 1),
    to: isoDay(y, m, Math.min(d, lastDay)),
    label: monthNames[m - 1] ?? 'Este mes',
  };
}

function movementDay(row: CashMovementListItem): string {
  const raw = String(row.fecha ?? row.createdAt ?? '').trim();
  return raw.slice(0, 10);
}

function toWalletMovement(row: CashMovementListItem): CashWalletMovement | null {
  const tipo = row.tipo === 'egreso' ? 'egreso' : row.tipo === 'ingreso' ? 'ingreso' : null;
  if (!tipo) return null;
  const categoria =
    String(
      row.categoriaLabel ?? row.categoria ?? row.categoriaId ?? row.concepto ?? ''
    ).trim() || null;
  return {
    tipo,
    monto: Number(row.monto) || 0,
    categoria,
    concepto: String(row.concepto ?? '').trim() || null,
    fecha: movementDay(row),
  };
}

export async function getCashWalletSummaryForPeriod(
  businessId: string,
  period: CashWalletPeriodKey,
  options: { from?: string; to?: string; ambitoId?: string; timeZone?: string } = {}
): Promise<CashWalletSummary & { from: string; to: string; message: string }> {
  const bounds = resolveCashWalletPeriodBounds(period, options);
  const listed = await getCashMovements(businessId, {
    ambitoId: options.ambitoId,
  });
  const items = Array.isArray(listed) ? listed : listed.items;
  const filtered: CashWalletMovement[] = [];
  for (const row of items) {
    const day = movementDay(row);
    if (!day || day < bounds.from || day > bounds.to) continue;
    const mapped = toWalletMovement(row);
    if (mapped) filtered.push(mapped);
  }
  const summary = buildCashWalletSummary(filtered, bounds.label);
  return {
    ...summary,
    from: bounds.from,
    to: bounds.to,
    message: formatCashWalletSummaryMessage(summary),
  };
}
