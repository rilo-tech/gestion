export type OrderStockStatus = 'sin_preparar' | 'completo' | 'parcial' | 'faltante';

export const ORDER_STOCK_STATUS_OPTIONS: Array<{ value: OrderStockStatus; label: string }> = [
  { value: 'sin_preparar', label: 'Sin preparar' },
  { value: 'completo', label: 'Stock completo' },
  { value: 'parcial', label: 'Stock parcial' },
  { value: 'faltante', label: 'Stock faltante' },
];

export function getOrderStockStatusLabel(value?: string): string {
  const normalized = (value ?? 'sin_preparar') as OrderStockStatus;
  return ORDER_STOCK_STATUS_OPTIONS.find((option) => option.value === normalized)?.label ?? 'Sin preparar';
}

export function getOrderStockStatusBadgeClass(value?: string): string {
  switch (value as OrderStockStatus) {
    case 'completo':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'parcial':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'faltante':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

export function getStockDisponible(
  item: Pick<{ stockActual?: number; stockReservado?: number }, 'stockActual' | 'stockReservado'>
): number {
  return Math.max(0, (Number(item.stockActual) || 0) - (Number(item.stockReservado) || 0));
}
