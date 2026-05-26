export type OrderStockMode = 'reservado' | 'directo';

export interface OrderEstadoConfig {
  value: string;
  label: string;
  sistema?: boolean;
}

export const DEFAULT_ORDER_ESTADOS: OrderEstadoConfig[] = [
  { value: 'borrador', label: 'Borrador', sistema: true },
  { value: 'pendiente', label: 'Pendiente', sistema: true },
  { value: 'en_produccion', label: 'En producción', sistema: true },
  { value: 'listo', label: 'Listo', sistema: true },
  { value: 'entregado', label: 'Entregado total', sistema: true },
  { value: 'entregado_con_saldo', label: 'Entregado con saldo', sistema: true },
  { value: 'cancelado', label: 'Cancelado', sistema: true },
];

export interface OrderPedidosConfigShape {
  costosPersonalizacionDetallados?: boolean;
  impresionDosVias?: boolean;
  estados?: OrderEstadoConfig[];
  modoStock?: OrderStockMode;
  estadoDescuentaStock?: string;
}

const STOCK_TRIGGER_EXCLUDED = new Set([
  'borrador',
  'cancelado',
  'entregado',
  'entregado_con_saldo',
]);

export function normalizeOrderEstados(raw: OrderEstadoConfig[] | undefined): OrderEstadoConfig[] {
  const saved = raw ?? [];
  const labelByValue = new Map<string, string>();

  for (const entry of saved) {
    const value = String(entry.value ?? '').trim();
    const label = String(entry.label ?? '').trim();
    if (!value || !label) continue;
    labelByValue.set(value, label);
  }

  return DEFAULT_ORDER_ESTADOS.map((defaults) => ({
    ...defaults,
    label: labelByValue.get(defaults.value) ?? defaults.label,
  }));
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
    estados,
    modoStock,
    estadoDescuentaStock,
  };
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
    (option) => option.value !== 'borrador' && option.value !== 'cancelado'
  );
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
