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

export const ORDER_STATUS_CARD_KEYS = [
  'borrador',
  'pendiente',
  'en_produccion',
  'listo',
  'entregado',
] as const;

export function normalizeOrderStatus(estado?: string): OrderStatusValue | 'otro' {
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

export function getOrderStatusLabel(estado?: string): string {
  const normalized = normalizeOrderStatus(estado);
  if (normalized === 'otro') return estado?.trim() || 'Sin estado';
  return ORDER_STATUS_OPTIONS.find((option) => option.value === normalized)?.label ?? estado ?? '';
}

export function getOrderStatusBadgeClass(estado?: string): string {
  switch (normalizeOrderStatus(estado)) {
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
}): boolean {
  return !!(
    order.stockDescontado ||
    order.seniaBloqueada ||
    order.movimientoSeniaId ||
    (order.pagos?.length ?? 0) > 0
  );
}

export function canRegisterSaleFromOrder(order: {
  estado?: string;
  ventaId?: string;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  pagos?: unknown[];
  stockDescontado?: boolean;
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
