/**
 * Política de listados ERP. Gemini dice QUÉ filtró el usuario;
 * este módulo decide límite default, paginación y modo count vs lista.
 * No lee rawMessage.
 */

export const DEFAULT_LIST_LIMIT = 10;

export type QueryListEntity =
  | 'orders'
  | 'sales'
  | 'purchases'
  | 'cash'
  | 'clients'
  | 'products'
  | 'payments';

export type QueryListMetric = 'list' | 'count' | 'status' | 'balance' | 'details' | 'stock' | 'verify';

export type QueryListInput = {
  entity?: QueryListEntity | string;
  metric?: QueryListMetric | string;
  limit?: number;
  requestAll?: boolean;
  page?: 'next' | 'first' | string;
  offset?: number;
  sortDirection?: 'asc' | 'desc';
};

export type ResolvedListPolicy = {
  mode: 'list' | 'count' | 'single';
  limit: number;
  offset: number;
  requestAll: boolean;
  sortDirection: 'asc' | 'desc';
  pageSize: number;
};

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

function parseIsoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isoUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDay(base: Date, delta: number): Date {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isListQueryMetric(metric?: string | null): boolean {
  const m = String(metric ?? '').trim().toLowerCase();
  return m === 'list' || m === 'count' || m === 'sum';
}

export function isSingleRecordMetric(metric?: string | null): boolean {
  const m = String(metric ?? '').trim().toLowerCase();
  return m === 'status' || m === 'balance' || m === 'details' || m === 'stock' || m === 'verify';
}

/** Lista de registros (no el detalle de uno). Un targetOrderId de foco viejo no degrada un listado. */
export function wantsEntityList(input: {
  listOrders?: boolean;
  entity?: string;
  metric?: string;
  orderNumber?: string;
  targetOrderId?: string;
}): boolean {
  if (isSingleRecordMetric(input.metric)) return false;
  const entity = String(input.entity ?? '').trim().toLowerCase();
  const collection =
    Boolean(input.listOrders) ||
    isListQueryMetric(input.metric) ||
    entity === 'orders' ||
    entity === 'sales' ||
    entity === 'purchases' ||
    entity === 'cash' ||
    entity === 'clients' ||
    entity === 'products' ||
    entity === 'payments';
  if (collection) return true;
  if (input.orderNumber || input.targetOrderId) return false;
  return false;
}

export function resolveListPolicy(input: QueryListInput): ResolvedListPolicy {
  const metric = String(input.metric ?? '').trim().toLowerCase();
  const requestAll = input.requestAll === true;
  const sortDirection: 'asc' | 'desc' = input.sortDirection === 'asc' ? 'asc' : 'desc';
  const explicit = Number(input.limit);
  const hasExplicit = Number.isFinite(explicit) && explicit > 0;
  const offsetIn = Math.max(0, Number(input.offset) || 0);
  const pageNext = String(input.page ?? '').trim().toLowerCase() === 'next';

  if (metric === 'count' || metric === 'sum') {
    return {
      mode: 'count',
      limit: 0,
      offset: 0,
      requestAll: false,
      sortDirection,
      pageSize: DEFAULT_LIST_LIMIT,
    };
  }

  const pageSize = DEFAULT_LIST_LIMIT;
  let limit = hasExplicit ? Math.min(100, Math.floor(explicit)) : DEFAULT_LIST_LIMIT;
  if (hasExplicit && explicit === 1) {
    return {
      mode: 'single',
      limit: 1,
      offset: pageNext && offsetIn === 0 ? 1 : offsetIn,
      requestAll: false,
      sortDirection,
      pageSize: 1,
    };
  }

  if (requestAll) {
    limit = pageSize;
  }

  const offset = pageNext && offsetIn === 0 ? pageSize : offsetIn;
  return {
    mode: 'list',
    limit,
    offset,
    requestAll,
    sortDirection,
    pageSize,
  };
}

export function resolveQueryDateRange(
  token: string | undefined,
  today: string
): { from: string; to: string } | undefined {
  const raw = String(token ?? '').trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { from: raw, to: raw };
  const t = fold(raw);
  const base = parseIsoDay(today);
  if (!base) return undefined;

  if (t === 'hoy' || t === 'today') return { from: today, to: today };
  if (t === 'ayer' || t === 'yesterday') {
    const d = isoUtc(shiftDay(base, -1));
    return { from: d, to: d };
  }
  if (t === 'manana' || t === 'tomorrow') {
    const d = isoUtc(shiftDay(base, 1));
    return { from: d, to: d };
  }
  if (t === 'pasado manana' || t === 'day_after_tomorrow') {
    const d = isoUtc(shiftDay(base, 2));
    return { from: d, to: d };
  }
  if (t === 'esta semana' || t === 'this week') {
    const dow = base.getUTCDay();
    const mondayDelta = dow === 0 ? -6 : 1 - dow;
    const from = shiftDay(base, mondayDelta);
    const to = shiftDay(from, 6);
    return { from: isoUtc(from), to: isoUtc(to) };
  }
  if (t === 'este mes' || t === 'this month') {
    const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const to = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return { from: isoUtc(from), to: isoUtc(to) };
  }

  const month = MONTHS[t];
  if (month != null) {
    let year = base.getUTCFullYear();
    if (month > base.getUTCMonth()) year -= 1;
    const from = new Date(Date.UTC(year, month, 1));
    const to = new Date(Date.UTC(year, month + 1, 0));
    return { from: isoUtc(from), to: isoUtc(to) };
  }
  return undefined;
}

export function presentListFooter(input: {
  shown: number;
  total: number;
  hasMore: boolean;
  requestAll?: boolean;
}): string | undefined {
  if (!input.hasMore && input.shown >= input.total) return undefined;
  if (input.requestAll && input.hasMore) {
    return `Te mostré ${input.shown} de ${input.total}.\n¿Querés que te muestre los siguientes?`;
  }
  if (input.hasMore) {
    const extra =
      input.total > input.shown
        ? `Mostrando ${input.shown} de ${input.total}.`
        : `Mostrando ${input.shown}.`;
    return `${extra}\nDecime *más* para ver los siguientes.`;
  }
  return undefined;
}
