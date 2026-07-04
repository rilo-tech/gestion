export type OrderStockMode = 'reservado' | 'directo';

export type OrderPhysicalStockScope = 'solo_reservado' | 'pedido_completo';

export interface OrderEstadoConfig {
  value: string;
  label: string;
  sistema?: boolean;
}

export const DEFAULT_ORDER_ESTADOS: OrderEstadoConfig[] = [
  { value: 'borrador', label: 'Borrador', sistema: true },
  { value: 'pendiente', label: 'Pendiente', sistema: true },
  { value: 'en_produccion', label: 'En proceso', sistema: true },
  { value: 'listo', label: 'Listo', sistema: true },
  { value: 'entregado', label: 'Entregado', sistema: true },
  { value: 'cancelado', label: 'Cancelado', sistema: true },
];

/** Tarjetas resumen en el listado de pedidos (máximo). */
export const ORDER_STATUS_CARD_LIMIT = 5;

/** Estados fijos del flujo (siempre 6, solo editable el nombre). */
export const FIXED_ORDER_ESTADO_VALUES = DEFAULT_ORDER_ESTADOS.map((item) => item.value);

/** Estados que no se pueden quitar de la configuración. */
export const PROTECTED_ORDER_ESTADO_VALUES = new Set(FIXED_ORDER_ESTADO_VALUES);

export interface OrderExtraCostPreset {
  nombre: string;
  costo: number;
}

export interface OrderPedidosConfigShape {
  costosPersonalizacionDetallados?: boolean;
  impresionDosVias?: boolean;
  /** Una sola vía en A4 apaisado (dos vías: A4 vertical, copias lado a lado). */
  impresionDosViasHorizontal?: boolean;
  /** Casillas vacías junto a cada producto en la impresión. */
  impresionCasillasProductos?: boolean;
  estados?: OrderEstadoConfig[];
  modoStock?: OrderStockMode;
  estadoDescuentaStock?: string;
  descuentoFisicoPorEstado?: Partial<Record<string, OrderPhysicalStockScope>>;
  permitirElegirAlcanceDescuento?: boolean;
  estadosExigenStockCompleto?: string[];
  costosExtraPredeterminados?: OrderExtraCostPreset[];
  permitirStockNegativo?: boolean;
  /** Permite adjuntar fotos de referencia en pedidos. */
  fotosReferenciaHabilitadas?: boolean;
  /** Incluye las fotos de referencia en el imprimible del pedido. */
  fotosReferenciaEnImpresion?: boolean;
  fotosEliminacionAutomatica?: boolean;
  fotosRetencionDias?: number;
}

const STOCK_TRIGGER_EXCLUDED = new Set([
  'borrador',
  'cancelado',
  'entregado',
  'entregado_con_saldo',
]);

export function slugifyOrderEstadoValue(label: string): string {
  const slug = String(label ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'estado';
}

function isLegacyEnProduccionLabel(label: string): boolean {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized === 'en produccion';
}

export function normalizeOrderEstados(raw: OrderEstadoConfig[] | undefined): OrderEstadoConfig[] {
  const saved = Array.isArray(raw) ? raw : [];
  const labelByValue = new Map<string, string>();

  for (const entry of saved) {
    const label = String(entry?.label ?? '').trim();
    if (!label) continue;

    let value = normalizeOrderEstadoValue(String(entry?.value ?? ''));
    if (!value) value = slugifyOrderEstadoValue(label);
    if (value === 'entregado_con_saldo') value = 'entregado';
    if (!PROTECTED_ORDER_ESTADO_VALUES.has(value)) continue;

    labelByValue.set(value, label);
  }

  return DEFAULT_ORDER_ESTADOS.map((defaults) => {
    const savedLabel = labelByValue.get(defaults.value);
    let label = savedLabel ?? defaults.label;
    if (defaults.value === 'entregado' && savedLabel) {
      const lower = savedLabel.toLowerCase();
      if (lower.includes('saldo') || lower.includes('total')) {
        label = defaults.label;
      }
    }
    if (defaults.value === 'en_produccion' && savedLabel && isLegacyEnProduccionLabel(savedLabel)) {
      label = defaults.label;
    }
    return {
      ...defaults,
      label,
      sistema: true,
    };
  });
}

/** Primeros estados del flujo que alimentan las tarjetas del módulo Pedidos. */
export function getOrderStatusCardEstados(
  pedidos: OrderPedidosConfigShape | undefined
): OrderEstadoConfig[] {
  const estados = getOrderEstadosFromConfig(pedidos);
  return estados.slice(0, ORDER_STATUS_CARD_LIMIT);
}

export function canRemoveOrderEstado(
  _estado: OrderEstadoConfig,
  _estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): boolean {
  return false;
}

export function orderEstadoValueInConfig(
  estado: string | undefined,
  pedidos: OrderPedidosConfigShape | undefined
): string | null {
  const normalized = normalizeOrderEstadoValue(estado);
  if (!normalized) return null;
  const match = getOrderEstadosFromConfig(pedidos).find((item) => item.value === normalized);
  return match?.value ?? null;
}

const STOCK_CONSUME_EXCLUDED = new Set(['borrador', 'cancelado']);

export function normalizeOrderExtraCostPresets(raw: OrderExtraCostPreset[] | undefined): OrderExtraCostPreset[] {
  if (!Array.isArray(raw)) return [];

  const result: OrderExtraCostPreset[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const nombre = String(entry?.nombre ?? '').trim();
    const costo = Number(entry?.costo);
    if (!nombre || Number.isNaN(costo) || costo < 0) continue;

    const key = nombre.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ nombre, costo });
  }

  return result;
}

const DEFAULT_DESCUENTO_FISICO_POR_ESTADO: Partial<Record<string, OrderPhysicalStockScope>> = {
  en_produccion: 'solo_reservado',
  listo: 'pedido_completo',
};

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
  raw: OrderPedidosConfigShape['descuentoFisicoPorEstado']
): Partial<Record<string, OrderPhysicalStockScope>> {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DESCUENTO_FISICO_POR_ESTADO };
  }

  const result: Partial<Record<string, OrderPhysicalStockScope>> = {
    ...DEFAULT_DESCUENTO_FISICO_POR_ESTADO,
  };

  for (const [key, value] of Object.entries(raw)) {
    const estado = normalizeOrderEstadoValue(key);
    const scope = normalizeOrderPhysicalStockScope(value);
    if (!estado || !scope) continue;
    result[estado] = scope;
  }

  return result;
}

export function normalizeEstadosExigenStockCompleto(
  raw: string[] | undefined,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): string[] {
  const allowed = new Set(estados.map((item) => normalizeOrderEstadoValue(item.value)));
  const source = raw ?? ['listo'];
  const normalized = source
    .map((item) => normalizeOrderEstadoValue(item))
    .filter((value) => value && allowed.has(value));

  if (normalized.length > 0) return [...new Set(normalized)];
  return ['listo'];
}

export const MIN_ORDER_PHOTO_RETENTION_DAYS = 7;
export const MAX_ORDER_PHOTO_RETENTION_DAYS = 365;
export const DEFAULT_ORDER_PHOTO_RETENTION_DAYS = 30;

export function normalizeOrderPhotoRetentionDays(raw: unknown): number {
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed)) return DEFAULT_ORDER_PHOTO_RETENTION_DAYS;
  return Math.min(MAX_ORDER_PHOTO_RETENTION_DAYS, Math.max(MIN_ORDER_PHOTO_RETENTION_DAYS, parsed));
}

export function normalizeOrderPedidosConfig(
  pedidos: OrderPedidosConfigShape = {}
): Required<OrderPedidosConfigShape> & { estados: OrderEstadoConfig[] } {
  const estados = normalizeOrderEstados(pedidos.estados);
  const modoStock: OrderStockMode = pedidos.modoStock === 'directo' ? 'directo' : 'reservado';
  let estadoDescuentaStock = String(pedidos.estadoDescuentaStock ?? 'en_produccion').trim();

  const allowedTriggers = estados
    .map((item) => item.value)
    .filter((value) => !STOCK_TRIGGER_EXCLUDED.has(value));

  if (!allowedTriggers.includes(estadoDescuentaStock)) {
    estadoDescuentaStock = 'en_produccion';
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
    estadosExigenStockCompleto: normalizeEstadosExigenStockCompleto(
      pedidos.estadosExigenStockCompleto,
      estados
    ),
    costosExtraPredeterminados: normalizeOrderExtraCostPresets(pedidos.costosExtraPredeterminados),
    permitirStockNegativo: pedidos.permitirStockNegativo !== false,
    fotosReferenciaHabilitadas: pedidos.fotosReferenciaHabilitadas !== false,
    fotosReferenciaEnImpresion: pedidos.fotosReferenciaEnImpresion !== false,
    fotosEliminacionAutomatica: pedidos.fotosEliminacionAutomatica === true,
    fotosRetencionDias: normalizeOrderPhotoRetentionDays(
      pedidos.fotosRetencionDias ?? DEFAULT_ORDER_PHOTO_RETENTION_DAYS
    ),
  };
}

export function resolveOrderPhysicalStockScope(
  pedidos: OrderPedidosConfigShape | undefined,
  targetEstado?: string
): OrderPhysicalStockScope {
  const config = normalizeOrderPedidosConfig(pedidos ?? {});
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
  pedidos: OrderPedidosConfigShape | undefined,
  targetEstado?: string
): boolean {
  const config = normalizeOrderPedidosConfig(pedidos ?? {});
  const normalized = normalizeOrderEstadoValue(targetEstado);
  const list = config.estadosExigenStockCompleto ?? ['listo'];

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

export function getOrderPhysicalStockScopeLabel(scope: OrderPhysicalStockScope): string {
  return scope === 'solo_reservado' ? 'Solo lo reservado' : 'Todo el pedido pendiente';
}

export function orderHasPendingPhysicalStock(
  items: Array<{
    stockItemId?: string;
    cantidad?: number;
    cantidadUsada?: number;
    controlaStock?: boolean;
  }> = []
): boolean {
  return items.some((line) => {
    if (line.controlaStock === false) return false;
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return false;
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    return cantidadUsada < cantidadPedida;
  });
}

/** True si el pedido tiene al menos una línea con producto que controla stock físico. */
export function orderHasStockControlledLines(
  items: Array<{
    stockItemId?: string;
    cantidad?: number;
    controlaStock?: boolean;
  }> = []
): boolean {
  return items.some((line) => {
    if (line.controlaStock === false) return false;
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return false;
    return (Number(line.cantidad) || 0) > 0;
  });
}

export function orderStockFullyConsumed(
  items: Array<{
    stockItemId?: string;
    cantidad?: number;
    cantidadUsada?: number;
    controlaStock?: boolean;
  }> = []
): boolean {
  return !orderHasPendingPhysicalStock(items);
}

export function orderUsesReservedStock(
  pedidos: Pick<OrderPedidosConfigShape, 'modoStock'> | undefined
): boolean {
  return normalizeOrderPedidosConfig(pedidos ?? {}).modoStock !== 'directo';
}

export function getOrderEstadosFromConfig(
  pedidos: OrderPedidosConfigShape | undefined
): OrderEstadoConfig[] {
  return normalizeOrderPedidosConfig(pedidos ?? {}).estados;
}

export function getOrderWorkflowStatusOptions(
  pedidos: OrderPedidosConfigShape | undefined
): OrderEstadoConfig[] {
  return getOrderEstadosFromConfig(pedidos).filter(
    (option) =>
      option.value !== 'borrador' &&
      option.value !== 'cancelado' &&
      option.value !== 'entregado_con_saldo'
  );
}

export type OrderEntregaModo = 'completa' | 'con_saldo';

export function getOrderWorkflowStatusOptionsForSelect(
  pedidos: OrderPedidosConfigShape | undefined
): OrderEstadoConfig[] {
  const seen = new Set<string>();
  const options: OrderEstadoConfig[] = [];

  for (const option of getOrderWorkflowStatusOptions(pedidos)) {
    const value = option.value === 'entregado_con_saldo' ? 'entregado' : option.value;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      ...option,
      value,
      label: value === 'entregado' ? 'Entregado' : option.label,
    });
  }

  return options;
}

export function getOrderStockTriggerOptions(
  pedidos: OrderPedidosConfigShape | undefined
): OrderEstadoConfig[] {
  return getOrderEstadosFromConfig(pedidos).filter(
    (option) => !STOCK_TRIGGER_EXCLUDED.has(option.value)
  );
}

export function getOrderStatusLabelFromConfig(
  estado: string | undefined,
  pedidos: OrderPedidosConfigShape | undefined
): string {
  const estados = getOrderEstadosFromConfig(pedidos);
  const normalized = String(estado ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  const direct = estados.find((item) => item.value === normalized);
  if (direct) return direct.label;

  if (normalized.includes('produccion') || normalized.includes('producción')) {
    return estados.find((item) => item.value === 'en_produccion')?.label ?? estado ?? '';
  }
  if (normalized.includes('pendiente')) {
    return estados.find((item) => item.value === 'pendiente')?.label ?? estado ?? '';
  }
  if (normalized.includes('listo')) {
    return estados.find((item) => item.value === 'listo')?.label ?? estado ?? '';
  }
  if (normalized.includes('borrador')) {
    return estados.find((item) => item.value === 'borrador')?.label ?? estado ?? '';
  }
  if (normalized.includes('cancelad')) {
    return estados.find((item) => item.value === 'cancelado')?.label ?? estado ?? '';
  }
  if (normalized.includes('entregado') && normalized.includes('saldo')) {
    return estados.find((item) => item.value === 'entregado_con_saldo')?.label ?? estado ?? '';
  }
  if (normalized.includes('entregad')) {
    return estados.find((item) => item.value === 'entregado')?.label ?? estado ?? '';
  }

  return estado?.trim() || 'Sin estado';
}

export function normalizeOrderEstadoValue(estado?: string): string {
  return String(estado ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
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
  /** Retroceso permitido (salvo desde entregado). */
  isBackward?: boolean;
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

  return {
    allowed: true,
    requiresStockRestore: shouldRestoreStockOnStatusChange(params),
    isBackward: true,
  };
}

export function orderEstadoMatchesStockTrigger(
  estado: string | undefined,
  pedidos: OrderPedidosConfigShape | undefined
): boolean {
  const cfg = normalizeOrderPedidosConfig(pedidos ?? {});
  const normalized = String(estado ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const trigger = cfg.estadoDescuentaStock;

  if (normalized === trigger) return true;
  if (trigger === 'en_produccion') {
    return normalized.includes('produccion') || normalized.includes('producción');
  }
  return normalized.includes(trigger);
}
