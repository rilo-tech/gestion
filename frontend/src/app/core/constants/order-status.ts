import {
  getOrderStatusLabelFromConfig,
  getOrderStatusCardEstados,
  normalizeOrderEstadoValue,
  orderEstadoValueInConfig,
  ORDER_STATUS_CARD_LIMIT,
  type OrderPedidosConfigShape,
} from './order-config';

export { getOrderStatusCardEstados, ORDER_STATUS_CARD_LIMIT };

export const ORDER_STATUS_OPTIONS = [
  { value: 'borrador', label: 'Borrador' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_produccion', label: 'En producción' },
  { value: 'listo', label: 'Listo' },
  { value: 'entregado', label: 'Entregado total' },
  { value: 'entregado_con_saldo', label: 'Entregado con saldo' },
  { value: 'cancelado', label: 'Cancelado' },
] as const;

/** Estados elegibles en el formulario (borrador y cancelado se asignan por acciones aparte). */
export const ORDER_WORKFLOW_STATUS_OPTIONS = ORDER_STATUS_OPTIONS.filter(
  (option) => option.value !== 'borrador' && option.value !== 'cancelado'
);

export type OrderStatusValue = (typeof ORDER_STATUS_OPTIONS)[number]['value'];

/** Valores por defecto de tarjetas KPI (si no hay config cargada). */
export const ORDER_STATUS_CARD_KEYS = [
  'borrador',
  'pendiente',
  'en_produccion',
  'listo',
  'entregado',
] as const;

export function normalizeOrderStatus(
  estado?: string,
  pedidos?: OrderPedidosConfigShape
): OrderStatusValue | string | 'otro' {
  const configured = orderEstadoValueInConfig(estado, pedidos);
  if (configured) return configured;

  const value = (estado ?? '').toLowerCase().trim();

  if (value === 'borrador' || value.includes('borrador')) return 'borrador';
  if (value === 'pendiente' || value.includes('pendiente')) return 'pendiente';
  if (value === 'en_produccion' || value.includes('produccion') || value.includes('producción')) {
    return 'en_produccion';
  }
  if (value === 'listo' || value.includes('listo')) return 'listo';
  if (
    value === 'entregado_con_saldo' ||
    value.includes('entregado_con_saldo') ||
    value.includes('entregado con saldo')
  ) {
    return 'entregado_con_saldo';
  }
  if (value === 'entregado' || value.includes('entregado total')) {
    return 'entregado';
  }
  if (value.includes('entregad') && !value.includes('saldo')) {
    return 'entregado';
  }
  if (value === 'cancelado' || value.includes('cancelad')) return 'cancelado';

  return 'otro';
}

export function getOrderStatusLabel(
  estado?: string,
  pedidos?: OrderPedidosConfigShape
): string {
  if (pedidos) {
    return getOrderStatusLabelFromConfig(estado, pedidos);
  }

  const normalized = normalizeOrderStatus(estado);
  if (normalized === 'otro') return estado?.trim() || 'Sin estado';
  return ORDER_STATUS_OPTIONS.find((option) => option.value === normalized)?.label ?? estado ?? '';
}

export function getOrderStatusCardBorderClass(index: number): string {
  const borders = [
    'border-gray-200',
    'border-blue-200',
    'border-purple-200',
    'border-green-200',
    'border-teal-200',
  ];
  return borders[index % borders.length] ?? 'border-gray-200';
}

export function getOrderStatusCardTitleClass(index: number): string {
  const titles = [
    'text-gray-500',
    'text-blue-500',
    'text-purple-500',
    'text-green-500',
    'text-teal-500',
  ];
  return titles[index % titles.length] ?? 'text-gray-500';
}

export function getOrderStatusCardValueClass(index: number): string {
  const values = [
    'text-gray-800',
    'text-blue-500',
    'text-purple-500',
    'text-green-500',
    'text-teal-500',
  ];
  return values[index % values.length] ?? 'text-gray-800';
}

export function orderMatchesStatusCardFilter(
  orderEstado: string | undefined,
  cardValue: string,
  pedidos?: OrderPedidosConfigShape
): boolean {
  const status = normalizeOrderStatus(orderEstado, pedidos);
  if (cardValue === 'entregado') {
    return status === 'entregado' || status === 'entregado_con_saldo';
  }
  return normalizeOrderEstadoValue(String(status)) === normalizeOrderEstadoValue(cardValue);
}

export function getOrderStatusBadgeClass(estado?: string, pedidos?: OrderPedidosConfigShape): string {
  switch (normalizeOrderStatus(estado, pedidos)) {
    case 'borrador':
      return 'bg-gray-100 text-gray-700';
    case 'pendiente':
      return 'bg-blue-50 text-blue-700';
    case 'en_produccion':
      return 'bg-purple-50 text-purple-700';
    case 'listo':
      return 'bg-green-50 text-green-700';
    case 'entregado':
      return 'bg-teal-50 text-teal-700';
    case 'entregado_con_saldo':
      return 'bg-orange-50 text-orange-700';
    case 'cancelado':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-yellow-50 text-yellow-700';
  }
}

export function orderIsConfirmedForSale(order: {
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  pagos?: unknown[];
  stockDescontado?: boolean;
  stockPreparado?: boolean;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
}): boolean {
  return !!(
    order.stockPreparado ||
    order.stockDescontado ||
    order.seniaBloqueada ||
    order.movimientoSeniaId ||
    (order.pagos?.length ?? 0) > 0 ||
    order.numeroPedido ||
    order.numeroPedidoLabel
  );
}

export function canRegisterSaleFromOrder(order: {
  estado?: string;
  ventaId?: string;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  pagos?: unknown[];
  stockDescontado?: boolean;
  stockPreparado?: boolean;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
}): boolean {
  if (order.ventaId) return false;

  const status = normalizeOrderStatus(order.estado);
  if (
    status === 'cancelado' ||
    status === 'borrador' ||
    status === 'entregado' ||
    status === 'entregado_con_saldo' ||
    status === 'otro'
  ) {
    return false;
  }

  if (!orderIsConfirmedForSale(order)) return false;

  return status === 'listo' || status === 'en_produccion' || status === 'pendiente';
}

export function orderIsLockedForEdit(estado?: string): boolean {
  return normalizeOrderStatus(estado) === 'entregado';
}

export function isOrderDeliveryEstado(estado?: string): boolean {
  const status = normalizeOrderStatus(estado);
  return status === 'entregado' || status === 'entregado_con_saldo';
}

/** Pedidos confirmados (en curso) que aún no fueron entregados. */
export function isOrderPendingDelivery(order: { estado?: string }): boolean {
  const status = normalizeOrderStatus(order.estado);
  return status === 'pendiente' || status === 'en_produccion' || status === 'listo';
}
