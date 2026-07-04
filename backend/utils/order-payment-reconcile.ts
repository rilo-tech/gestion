import {
  resolveOrderBalance,
  sumPagosHaciaTotal,
  type OrderBalanceInput,
  type OrderPaymentLike,
} from '../../shared/order-balance.ts';
import {
  consolidateExtraPagosIntoCuotas,
  pagosChanged,
} from '../../shared/order-payment-consolidate.ts';

export type ReconciledOrderPayments = {
  pagos: OrderPaymentLike[];
  total: number;
  totalPagado: number;
  saldo: number;
  changed: boolean;
};

export function reconcileOrderPayments(order: OrderBalanceInput): ReconciledOrderPayments {
  const rawPagos = (order.pagos ?? []) as OrderPaymentLike[];
  const pagos = consolidateExtraPagosIntoCuotas(rawPagos);
  const paymentsChanged = pagosChanged(rawPagos, pagos);

  const balance = resolveOrderBalance({
    ...order,
    pagos,
  });

  const totalPagado = sumPagosHaciaTotal(pagos);
  const storedTotal = Number(order.total) || 0;
  const storedSaldo = Number((order as { saldo?: number }).saldo) || 0;
  const storedPagado = Number(order.totalPagado) || 0;

  const fieldsChanged =
    paymentsChanged ||
    Math.abs(balance.total - storedTotal) > 0.009 ||
    Math.abs(balance.saldo - storedSaldo) > 0.009 ||
    Math.abs(totalPagado - storedPagado) > 0.009;

  return {
    pagos,
    total: balance.total,
    totalPagado,
    saldo: balance.saldo,
    changed: fieldsChanged,
  };
}
