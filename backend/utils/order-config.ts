export type OrderStockMode = 'reservado' | 'directo';

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

export type OrderPedidosConfig = {
  costosPersonalizacionDetallados: boolean;
  impresionDosVias: boolean;
  estados: OrderEstadoConfig[];
  modoStock: OrderStockMode;
  estadoDescuentaStock: string;
};

export const DEFAULT_ORDER_PEDIDOS_CONFIG: OrderPedidosConfig = {
  costosPersonalizacionDetallados: true,
  impresionDosVias: false,
  estados: DEFAULT_ORDER_ESTADOS,
  modoStock: 'reservado',
  estadoDescuentaStock: 'en_produccion',
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
    estados,
    modoStock,
    estadoDescuentaStock,
  };
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
