export type OrderListMode = 'open' | 'closed' | 'all';

export type OrderQueryFilter = {
  listMode: OrderListMode;
  /** Si el dueño negó un estado (p. ej. no entregado), el backend filtra con esto. */
  statusEquals?: 'entregado' | 'pendiente' | 'listo' | 'en_produccion';
  statusNotEquals?: 'entregado' | 'pendiente' | 'listo' | 'en_produccion';
  /** Solo false cuando la negación/abiertos es explícita: no inyectar entregados. */
  allowClosedFallback: boolean;
};

const STATUS_STEMS: Record<
  NonNullable<OrderQueryFilter['statusEquals']>,
  string[]
> = {
  entregado: ['entregado', 'entregada', 'entregados', 'entregadas', 'entregar', 'entregue', 'entrego'],
  pendiente: ['pendiente', 'pendientes'],
  listo: ['listo', 'lista', 'pronto', 'terminado', 'terminada'],
  en_produccion: ['produccion', 'proceso'],
};

const NEGATION_TOKENS = new Set([
  'no',
  'sin',
  'falta',
  'faltan',
  'faltaba',
  'todavia',
  'aun',
]);

const CLOSED_ONLY =
  /(?<![\p{L}])((?:solo|solamente|nomas|nom[aá]s)\s+(?:los\s+)?entregad|(?:los\s+)?entregad[oa]s?(?:\s+solamente)?|cerrad[oa]s?|ya\s+entregad)(?![\p{L}])/iu;
const ALL_ORDERS =
  /(?<![\p{L}])(todos(?:\s+los\s+pedidos)?|incluyendo\s+entregad)(?![\p{L}])/iu;
const EXPLICIT_OPEN =
  /(?<![\p{L}])(abiertos?|pendientes?)(?![\p{L}])/iu;

function fold(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function tokensOf(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function tokenMatchesStem(token: string, stems: string[]): boolean {
  return stems.some((stem) => token === stem || (token.length >= 5 && stem.startsWith(token)) || (stem.length >= 5 && token.startsWith(stem)));
}

/**
 * Negación de estado como condición de consulta.
 * Una sola pasada: «no / sin / falta / todavía no» cerca del estado.
 * No hay un regex distinto por cada frase equivalente.
 */
export function negatedOrderStatus(text: string): OrderQueryFilter['statusNotEquals'] | undefined {
  const tokens = tokensOf(text);
  if (!tokens.length) return undefined;
  for (const [status, stems] of Object.entries(STATUS_STEMS) as Array<
    [NonNullable<OrderQueryFilter['statusEquals']>, string[]]
  >) {
    const statusIdx = tokens.findIndex((token) => tokenMatchesStem(token, stems));
    if (statusIdx < 0) continue;
    const window = tokens.slice(Math.max(0, statusIdx - 5), statusIdx);
    if (window.some((token) => NEGATION_TOKENS.has(token))) return status;
  }
  return undefined;
}

export function parseOrderQueryFilter(text: string): OrderQueryFilter {
  const raw = String(text ?? '');
  const statusNotEquals = negatedOrderStatus(raw);
  if (statusNotEquals) {
    return {
      listMode: 'open',
      statusNotEquals,
      allowClosedFallback: false,
    };
  }
  if (CLOSED_ONLY.test(raw)) {
    return { listMode: 'closed', statusEquals: 'entregado', allowClosedFallback: false };
  }
  if (ALL_ORDERS.test(raw)) {
    return { listMode: 'all', allowClosedFallback: false };
  }
  if (EXPLICIT_OPEN.test(raw)) {
    return { listMode: 'open', allowClosedFallback: false };
  }
  return { listMode: 'open', allowClosedFallback: true };
}

export function orderStatusIs(estado: string, expected: NonNullable<OrderQueryFilter['statusEquals']>): boolean {
  const folded = fold(estado).replace(/\s+/g, '_');
  if (expected === 'entregado') return folded.includes('entregad');
  if (expected === 'pendiente') return folded.includes('pendiente');
  if (expected === 'listo') return folded.includes('listo') || folded.includes('pronto');
  if (expected === 'en_produccion') return folded.includes('produccion') || folded.includes('proceso');
  return false;
}

export function orderMatchesQueryFilter(
  order: { estado?: string; clientName?: string },
  filter: OrderQueryFilter
): boolean {
  const estado = String(order.estado ?? '');
  if (filter.statusNotEquals && orderStatusIs(estado, filter.statusNotEquals)) return false;
  if (filter.statusEquals && !orderStatusIs(estado, filter.statusEquals)) return false;
  if (filter.listMode === 'open' && !filter.statusEquals && orderStatusIs(estado, 'entregado')) {
    return false;
  }
  if (filter.listMode === 'closed' && !orderStatusIs(estado, 'entregado')) return false;
  return true;
}

export function filterOrdersByQuery<T extends { estado?: string; clientName?: string }>(
  orders: T[],
  filter: OrderQueryFilter
): T[] {
  return orders.filter((order) => orderMatchesQueryFilter(order, filter));
}
