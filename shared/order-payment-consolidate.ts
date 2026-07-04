import type { OrderPaymentLike } from './order-balance.ts';

/** Une pagos «extra» en la última cuota/pago del pedido (corrige datos legacy). */
export function consolidateExtraPagosIntoCuotas<T extends OrderPaymentLike>(pagos: T[]): T[] {
  const extras = pagos.filter((pago) => pago.tipo === 'extra');
  if (!extras.length) return pagos;

  const extraTotal = extras.reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0);
  if (extraTotal <= 0) return pagos.filter((pago) => pago.tipo !== 'extra');

  const kept = pagos.filter((pago) => pago.tipo !== 'extra');
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    const pago = kept[index];
    if (pago.tipo !== 'cuota' && pago.tipo !== 'pago') continue;
    kept[index] = {
      ...pago,
      monto: Math.round(((Number(pago.monto) || 0) + extraTotal) * 100) / 100,
    };
    return kept;
  }

  const fecha = extras.find((pago) => pago.fecha)?.fecha ?? new Date().toISOString();
  return [
    ...kept,
    {
      id: `pago_consolidado_${Date.now()}`,
      tipo: 'cuota',
      monto: extraTotal,
      fecha,
    } as T,
  ];
}

export function pagosChanged(before: OrderPaymentLike[], after: OrderPaymentLike[]): boolean {
  if (before.length !== after.length) return true;
  return JSON.stringify(before) !== JSON.stringify(after);
}
