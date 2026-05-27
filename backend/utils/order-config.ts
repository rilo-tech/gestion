export type OrderStockMode = 'reservado' | 'directo';

/** Qué unidades bajan del depósito al cruzar el descuento físico. */
export type OrderPhysicalStockScope = 'solo_reservado' | 'pedido_completo';

export type OrderEstadoConfig = {
  value: string;
  label: string;
  sistema?: boolean;
};

export const DEFAULT_ORDER_ESTADOS: OrderEstadoConfig[] = [
  { value: 'borrador', label: 'Borrador', sistema: true },
  { value: 'pendiente', label: 'Pendiente', sistema: true },
  { value: 'en_produccion', label: 'En producción', sistema: true },
  { value: 'listo', label: 'Listo', sistema: true },
  { value: 'entregado', label: 'Entregado total', sistema: true },
  { value: 'entregado_con_saldo', label: 'Entregado con saldo', sistema: true },
  { value: 'cancelado', label: 'Cancelado', sistema: true },
];

export type OrderExtraCostPreset = {
  nombre: string;
  costo: number;
};

export type OrderPedidosConfig = {
  costosPersonalizacionDetallados: boolean;
  impresionDosVias: boolean;
  impresionDosViasHorizontal: boolean;
  impresionCasillasProductos: boolean;
  estados: OrderEstadoConfig[];
  modoStock: OrderStockMode;
  estadoDescuentaStock: string;
  /** Alcance del descuento físico al entrar a cada estado (clave = value del estado). */
  descuentoFisicoPorEstado: Partial<Record<string, OrderPhysicalStockScope>>;
  /** Si true, al cambiar estado el usuario puede elegir reservado vs pedido completo. */
  permitirElegirAlcanceDescuento: boolean;
  /** Estados donde pedido_completo exige stock completo antes del cambio. */
  estadosExigenStockCompleto: string[];
  costosExtraPredeterminados: OrderExtraCostPreset[];
  /** Si es true (default), pedidos y descuentos pueden dejar stock negativo. */
  permitirStockNegativo: boolean;
};

export const DEFAULT_ORDER_PEDIDOS_CONFIG: OrderPedidosConfig = {
  costosPersonalizacionDetallados: true,
  impresionDosVias: false,
  impresionDosViasHorizontal: false,
  impresionCasillasProductos: false,
  estados: DEFAULT_ORDER_ESTADOS,
  modoStock: 'reservado',
  estadoDescuentaStock: 'en_produccion',
  descuentoFisicoPorEstado: {
    en_produccion: 'solo_reservado',
    listo: 'pedido_completo',
  },
  permitirElegirAlcanceDescuento: true,
  estadosExigenStockCompleto: ['listo'],
  costosExtraPredeterminados: [],
};

const STOCK_TRIGGER_EXCLUDED = new Set([
  'borrador',
  'cancelado',
  'entregado',
  'entregado_con_saldo',
]);

export function normalizeOrderEstados(raw: unknown): OrderEstadoConfig[] {
  const saved = Array.isArray(raw) ? raw : [];
  const labelByValue = new Map<string, string>();

  for (const entry of saved) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const value = String(obj.value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const label = String(obj.label ?? '').trim();
    if (!value || !label) continue;
    labelByValue.set(value, label);
  }

  return DEFAULT_ORDER_ESTADOS.map((defaults) => ({
    ...defaults,
    label: labelByValue.get(defaults.value) ?? defaults.label,
  }));
}

const STOCK_CONSUME_EXCLUDED = new Set(['borrador', 'cancelado']);

export function normalizeOrderExtraCostPresets(raw: unknown): OrderExtraCostPreset[] {
  if (!Array.isArray(raw)) return [];

  const result: OrderExtraCostPreset[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const nombre = String(obj.nombre ?? '').trim();
    const costo = Number(obj.costo);
    if (!nombre || Number.isNaN(costo) || costo < 0) continue;

    const key = nombre.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ nombre, costo });
  }

  return result;
}

function normalizeOrderPhysicalStockScope(raw: unknown): OrderPhysicalStockScope | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'solo_reservado' || value === 'reservado') return 'solo_reservado';
  if (value === 'pedido_completo' || value === 'completo' || value === 'pedido') {
    return 'pedido_completo';
  }
  return undefined;
}

export function normalizeDescuentoFisicoPorEstado(
  raw: unknown
): Partial<Record<string, OrderPhysicalStockScope>> {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ORDER_PEDIDOS_CONFIG.descuentoFisicoPorEstado };
  }

  const result: Partial<Record<string, OrderPhysicalStockScope>> = {
    ...DEFAULT_ORDER_PEDIDOS_CONFIG.descuentoFisicoPorEstado,
  };

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const estado = normalizeOrderEstadoValue(key);
    const scope = normalizeOrderPhysicalStockScope(value);
    if (!estado || !scope) continue;
    result[estado] = scope;
  }

  return result;
}

export function normalizeEstadosExigenStockCompleto(
  raw: unknown,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): string[] {
  const allowed = new Set(estados.map((item) => normalizeOrderEstadoValue(item.value)));
  const source = Array.isArray(raw) ? raw : DEFAULT_ORDER_PEDIDOS_CONFIG.estadosExigenStockCompleto;
  const normalized = source
    .map((item) => normalizeOrderEstadoValue(String(item)))
    .filter((value) => value && allowed.has(value));

  if (normalized.length > 0) return [...new Set(normalized)];
  return [...DEFAULT_ORDER_PEDIDOS_CONFIG.estadosExigenStockCompleto];
}

export function normalizeOrderPedidosConfig(pedidos: Record<string, unknown> = {}): OrderPedidosConfig {
  const estados = normalizeOrderEstados(pedidos.estados);
  const modoStock: OrderStockMode = pedidos.modoStock === 'directo' ? 'directo' : 'reservado';
  let estadoDescuentaStock = String(pedidos.estadoDescuentaStock ?? 'en_produccion')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  const allowedTriggers = estados
    .map((item) => item.value)
    .filter((value) => !STOCK_TRIGGER_EXCLUDED.has(value));

  if (!allowedTriggers.includes(estadoDescuentaStock)) {
    estadoDescuentaStock = DEFAULT_ORDER_PEDIDOS_CONFIG.estadoDescuentaStock;
  }

  return {
    costosPersonalizacionDetallados: pedidos.costosPersonalizacionDetallados !== false,
    impresionDosVias: pedidos.impresionDosVias === true,
    impresionDosViasHorizontal: pedidos.impresionDosViasHorizontal === true,
    impresionCasillasProductos: pedidos.impresionCasillasProductos === true,
    estados,
    modoStock,
    estadoDescuentaStock,
    descuentoFisicoPorEstado: normalizeDescuentoFisicoPorEstado(pedidos.descuentoFisicoPorEstado),
    permitirElegirAlcanceDescuento:
      pedidos.permitirElegirAlcanceDescuento !== false && modoStock !== 'directo',
    estadosExigenStockCompleto: normalizeEstadosExigenStockCompleto(pedidos.estadosExigenStockCompleto, estados),
    costosExtraPredeterminados: normalizeOrderExtraCostPresets(pedidos.costosExtraPredeterminados),
    permitirStockNegativo: pedidos.permitirStockNegativo !== false,
  };
}

export function resolveOrderPhysicalStockScope(
  config: Pick<OrderPedidosConfig, 'modoStock' | 'descuentoFisicoPorEstado'>,
  targetEstado?: string
): OrderPhysicalStockScope {
  if (config.modoStock === 'directo') return 'pedido_completo';

  const normalized = normalizeOrderEstadoValue(targetEstado);
  const map = config.descuentoFisicoPorEstado ?? {};

  if (map[normalized]) return map[normalized]!;

  if (
    (normalized.includes('produccion') || normalized.includes('producción')) &&
    map.en_produccion
  ) {
    return map.en_produccion;
  }
  if (normalized.includes('listo') && map.listo) return map.listo;
  if (normalized.includes('pendiente') && map.pendiente) return map.pendiente;

  return 'solo_reservado';
}

export function orderEstadoRequiresFullStock(
  config: Pick<OrderPedidosConfig, 'estadosExigenStockCompleto'>,
  targetEstado?: string
): boolean {
  const normalized = normalizeOrderEstadoValue(targetEstado);
  const list = config.estadosExigenStockCompleto ?? DEFAULT_ORDER_PEDIDOS_CONFIG.estadosExigenStockCompleto;

  return list.some((estado) => {
    const configured = normalizeOrderEstadoValue(estado);
    if (!configured) return false;
    if (configured === normalized) return true;
    if (configured === 'listo' && normalized.includes('listo')) return true;
    if (
      configured === 'en_produccion' &&
      (normalized.includes('produccion') || normalized.includes('producción'))
    ) {
      return true;
    }
    return normalized.includes(configured);
  });
}

export function orderUsesReservedStock(config: Pick<OrderPedidosConfig, 'modoStock'>): boolean {
  return config.modoStock !== 'directo';
}

export function getOrderEstadoLabel(
  estado: string | undefined,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): string {
  const value = String(estado ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const match = estados.find((item) => item.value === value);
  if (match) return match.label;
  return estado?.trim() || 'Sin estado';
}

export function normalizeOrderEstadoValue(estado?: string): string {
  return String(estado ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export function orderEstadoMatchesTrigger(
  estado: string | undefined,
  trigger: string | undefined
): boolean {
  const normalized = normalizeOrderEstadoValue(estado);
  const normalizedTrigger = normalizeOrderEstadoValue(trigger);
  if (!normalized || !normalizedTrigger) return false;
  if (normalized === normalizedTrigger) return true;

  if (normalizedTrigger === 'en_produccion') {
    return normalized.includes('produccion') || normalized.includes('producción');
  }

  return normalized.includes(normalizedTrigger);
}

/** Posición en la lista de estados configurada (orden del flujo). */
export function buildOrderEstadoRankMap(
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): Map<string, number> {
  const map = new Map<string, number>();
  estados.forEach((item, index) => {
    map.set(normalizeOrderEstadoValue(item.value), index);
  });
  return map;
}

export function getOrderStockDiscountRank(
  estado?: string,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): number {
  const normalized = normalizeOrderEstadoValue(estado);
  if (!normalized || STOCK_CONSUME_EXCLUDED.has(normalized)) return -1;

  const rankMap = buildOrderEstadoRankMap(estados);
  if (rankMap.has(normalized)) return rankMap.get(normalized)!;

  if (normalized.includes('produccion') || normalized.includes('producción')) {
    return rankMap.get('en_produccion') ?? -1;
  }
  if (normalized.includes('listo')) return rankMap.get('listo') ?? -1;
  if (normalized.includes('pendiente')) return rankMap.get('pendiente') ?? -1;
  if (normalized.includes('entregado') && normalized.includes('saldo')) {
    return rankMap.get('entregado_con_saldo') ?? -1;
  }
  if (normalized.includes('entregad')) return rankMap.get('entregado') ?? -1;
  if (normalized.includes('borrador')) return -1;

  return -1;
}

/** Descuenta stock al entrar al trigger configurado o a cualquier estado posterior (ej. saltar a Listo). */
export function shouldConsumeStockOnStatusChange(params: {
  previousEstado?: string;
  nextEstado?: string;
  triggerEstado: string;
  stockDescontado?: boolean;
  stockFullyConsumed?: boolean;
  estados?: OrderEstadoConfig[];
}): boolean {
  if (params.stockDescontado && params.stockFullyConsumed !== false) return false;

  const estados = params.estados ?? DEFAULT_ORDER_ESTADOS;
  const nextNormalized = normalizeOrderEstadoValue(params.nextEstado);
  if (STOCK_CONSUME_EXCLUDED.has(nextNormalized)) return false;

  const previousRank = getOrderStockDiscountRank(params.previousEstado, estados);
  const nextRank = getOrderStockDiscountRank(params.nextEstado, estados);
  const triggerRank = getOrderStockDiscountRank(params.triggerEstado, estados);

  if (triggerRank < 0 || nextRank < 0) return false;
  if (nextRank < triggerRank) return false;

  if (previousRank < 0) return true;
  return previousRank < triggerRank;
}

const ORDER_ESTADO_ENTREGADO = new Set(['entregado', 'entregado_con_saldo']);

function orderEstadoIsEntregado(estado?: string): boolean {
  const normalized = normalizeOrderEstadoValue(estado);
  if (ORDER_ESTADO_ENTREGADO.has(normalized)) return true;
  return normalized.includes('entregad');
}

/** Retroceso en el flujo según el orden configurado de estados. */
export function isBackwardOrderEstadoChange(
  previousEstado?: string,
  nextEstado?: string,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): boolean {
  const previousRank = getOrderStockDiscountRank(previousEstado, estados);
  const nextRank = getOrderStockDiscountRank(nextEstado, estados);
  if (previousRank < 0 || nextRank < 0) return false;
  return nextRank < previousRank;
}

/** Al retroceder por debajo del trigger con stock ya descontado, hay que devolver stock. */
export function shouldRestoreStockOnStatusChange(params: {
  previousEstado?: string;
  nextEstado?: string;
  triggerEstado: string;
  stockDescontado?: boolean;
  estados?: OrderEstadoConfig[];
}): boolean {
  if (!params.stockDescontado) return false;

  const estados = params.estados ?? DEFAULT_ORDER_ESTADOS;
  if (!isBackwardOrderEstadoChange(params.previousEstado, params.nextEstado, estados)) {
    return false;
  }
  if (orderEstadoIsEntregado(params.previousEstado)) return false;

  const triggerRank = getOrderStockDiscountRank(params.triggerEstado, estados);
  const nextRank = getOrderStockDiscountRank(params.nextEstado, estados);
  if (triggerRank < 0 || nextRank < 0) return false;

  return nextRank < triggerRank;
}

export type OrderEstadoTransitionValidation = {
  allowed: boolean;
  requiresStockRestore: boolean;
  error?: string;
};

export function validateOrderEstadoTransition(params: {
  previousEstado?: string;
  nextEstado?: string;
  triggerEstado: string;
  stockDescontado?: boolean;
  estados?: OrderEstadoConfig[];
}): OrderEstadoTransitionValidation {
  const estados = params.estados ?? DEFAULT_ORDER_ESTADOS;
  const previousNorm = normalizeOrderEstadoValue(params.previousEstado);
  const nextNorm = normalizeOrderEstadoValue(params.nextEstado);

  if (previousNorm === nextNorm) {
    return { allowed: true, requiresStockRestore: false };
  }

  if (!isBackwardOrderEstadoChange(params.previousEstado, params.nextEstado, estados)) {
    return { allowed: true, requiresStockRestore: false };
  }

  if (orderEstadoIsEntregado(params.previousEstado)) {
    return {
      allowed: false,
      requiresStockRestore: false,
      error: 'No podés retroceder el estado de un pedido ya entregado.',
    };
  }

  if (shouldRestoreStockOnStatusChange(params)) {
    return { allowed: true, requiresStockRestore: true };
  }

  return {
    allowed: false,
    requiresStockRestore: false,
    error: 'No podés retroceder a un estado anterior del flujo del pedido.',
  };
}
