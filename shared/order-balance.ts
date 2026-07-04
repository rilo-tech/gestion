import { consolidateExtraPagosIntoCuotas } from './order-payment-consolidate.ts';

export type OrderPaymentLike = {
  id?: string;
  tipo?: string;
  monto?: number;
  fecha?: string;
  movimientoCajaId?: string;
  notas?: string;
};

export type OrderLineLike = {
  cantidad?: number;
  precioVenta?: number | null;
};

export type OrderBalanceInput = {
  total?: number;
  senia?: number;
  totalPagado?: number;
  pagos?: OrderPaymentLike[];
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string | null;
  items?: OrderLineLike[];
};

export function sumPagosHaciaTotal(pagos: OrderPaymentLike[] = []): number {
  return consolidateExtraPagosIntoCuotas(pagos).reduce(
    (acc, pago) => acc + (Number(pago.monto) || 0),
    0
  );
}

export function normalizePagosForBalance(order: OrderBalanceInput): OrderPaymentLike[] {
  const pagos = [...(order.pagos ?? [])];
  if (
    pagos.length === 0 &&
    order.movimientoSeniaId &&
    Number(order.senia) > 0
  ) {
    pagos.push({
      id: `pago_senia_${order.movimientoSeniaId}`,
      tipo: 'seña',
      monto: Number(order.senia),
    });
  }
  return consolidateExtraPagosIntoCuotas(pagos);
}

/** Total de venta desde líneas cuando hay precios por ítem (misma regla que el formulario). */
export function computeOrderTotalFromItems(items: OrderLineLike[] | undefined): number | null {
  if (!items?.length) return null;

  const hasExplicitLinePrice = items.some(
    (line) => line.precioVenta != null && line.precioVenta !== undefined
  );
  if (!hasExplicitLinePrice) return null;

  const lineTotal = items.reduce((acc, line) => {
    const qty = Number(line.cantidad) || 0;
    const unit = Number(line.precioVenta) || 0;
    return acc + qty * unit;
  }, 0);

  return Math.round(lineTotal * 100) / 100;
}

export function resolveOrderBalance(order: OrderBalanceInput): {
  pagado: number;
  saldo: number;
  total: number;
} {
  const storedTotal = Number(order.total) || 0;
  const totalFromItems = computeOrderTotalFromItems(order.items);
  const total =
    totalFromItems != null && totalFromItems > 0 ? totalFromItems : storedTotal;

  const pagos = normalizePagosForBalance(order);
  const pagadoFromPagos = sumPagosHaciaTotal(pagos);

  let pagado = 0;
  if (pagadoFromPagos > 0) {
    pagado = pagadoFromPagos;
  } else if (
    order.totalPagado != null &&
    (order.seniaBloqueada || order.movimientoSeniaId || pagos.length > 0)
  ) {
    pagado = Number(order.totalPagado) || 0;
  }

  const saldo = Math.max(0, Math.round((total - pagado) * 100) / 100);
  return { pagado, saldo, total };
}
