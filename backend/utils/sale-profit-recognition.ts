import { sumLineExtraCosts } from './line-extra-costs.ts';
import { consolidateExtraPagosIntoCuotas } from '../../shared/order-payment-consolidate.ts';

type SaleLineExtraCost = { costo?: number };
type SaleLine = {
  cantidad?: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: SaleLineExtraCost[];
};

type OrderPayment = {
  tipo?: string;
  monto?: number;
  fecha?: string;
};

function sumLinePersonalizationCost(line: SaleLine): number {
  return sumLineExtraCosts(
    Number(line.cantidad) || 0,
    line.costosExtra,
    line.costoPersonalizacion
  );
}

export function calculateSaleCostFromItems(items: SaleLine[]): number {
  return items.reduce((acc, line) => {
    const cantidad = Number(line.cantidad) || 0;
    const base = cantidad * (Number(line.costoUnitario) || 0);
    return acc + base + sumLinePersonalizationCost(line);
  }, 0);
}

export function resolveSaleCostoReal(
  sale: Record<string, unknown>,
  items: SaleLine[] = (Array.isArray(sale.items) ? sale.items : []) as SaleLine[]
): number {
  const calculated = calculateSaleCostFromItems(items);
  const stored = Number(sale.costoReal) || 0;
  return Math.max(stored, calculated);
}

export function isDonationSale(sale: Record<string, unknown>): boolean {
  if (sale.esDonacion === true) return true;
  return (Number(sale.total) || 0) <= 0;
}

export function resolveSaleGananciaEstimada(sale: Record<string, unknown>): number {
  const stored = Number(sale.gananciaEstimada);
  if (Number.isFinite(stored)) {
    return Math.round(stored * 100) / 100;
  }
  const total = Number(sale.total) || 0;
  const costoReal = resolveSaleCostoReal(sale);
  return Math.round((total - costoReal) * 100) / 100;
}

export function resolveSaleSaldoPendiente(sale: Record<string, unknown>): number {
  const stored = Number(sale.saldoPendiente);
  if (Number.isFinite(stored) && stored >= 0) return stored;

  const total = Number(sale.total) || 0;
  const pagadoAnterior = Number(sale.totalPagadoAnterior) || 0;
  const cobrado = Number(sale.montoCobrado) || 0;
  return Math.max(0, Math.round((total - pagadoAnterior - cobrado) * 100) / 100);
}

function normalizeOrderPayments(order: Record<string, unknown> | null | undefined): OrderPayment[] {
  if (!order) return [];
  const pagos = (Array.isArray(order.pagos) ? order.pagos : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => entry as OrderPayment)
    .filter((pago) => (Number(pago.monto) || 0) > 0);
  return consolidateExtraPagosIntoCuotas(pagos).sort((a, b) =>
    String(a.fecha ?? '').localeCompare(String(b.fecha ?? ''))
  );
}

/** Fecha ISO en la que la venta quedó totalmente cobrada; null si aún tiene saldo. */
export function resolveSaleFullyPaidAt(
  sale: Record<string, unknown>,
  order?: Record<string, unknown> | null
): string | null {
  if (resolveSaleSaldoPendiente(sale) > 0) return null;

  const total = Number(sale.total) || 0;
  if (total <= 0) return null;

  if (String(sale.origen ?? '') === 'pedido') {
    const pagos = normalizeOrderPayments(order);
    if (pagos.length === 0) return String(sale.fecha ?? '') || null;

    let accumulated = 0;
    for (const pago of pagos) {
      accumulated += Number(pago.monto) || 0;
      if (accumulated >= total - 0.001) {
        return String(pago.fecha ?? sale.fecha ?? '') || null;
      }
    }
    return String(sale.fecha ?? '') || null;
  }

  const cobros = (Array.isArray(sale.cobros) ? sale.cobros : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => entry as { monto?: number; fecha?: string })
    .filter((cobro) => (Number(cobro.monto) || 0) > 0)
    .sort((a, b) => String(a.fecha ?? '').localeCompare(String(b.fecha ?? '')));

  if (cobros.length > 0) {
    const cobrosSum = cobros.reduce((acc, cobro) => acc + (Number(cobro.monto) || 0), 0);
    const initialCollected = Math.max(0, (Number(sale.montoCobrado) || 0) - cobrosSum);
    let accumulated = initialCollected;
    if (initialCollected >= total - 0.001) {
      return String(sale.fecha ?? '') || null;
    }
    for (const cobro of cobros) {
      accumulated += Number(cobro.monto) || 0;
      if (accumulated >= total - 0.001) {
        return String(cobro.fecha ?? '') || null;
      }
    }
  }

  return String(sale.fecha ?? '') || null;
}

export function isIsoDateInCalendarMonth(iso: string, mes: number, anio: number): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getUTCFullYear() === anio && parsed.getUTCMonth() + 1 === mes;
}

export function isSaleProfitRecognizedInMonth(
  sale: Record<string, unknown>,
  mes: number,
  anio: number,
  order?: Record<string, unknown> | null
): boolean {
  if (isDonationSale(sale)) {
    const deliveredAt = String(sale.fecha ?? '').trim();
    if (!deliveredAt) return false;
    return isIsoDateInCalendarMonth(deliveredAt, mes, anio);
  }

  const fullyPaidAt = resolveSaleFullyPaidAt(sale, order);
  if (!fullyPaidAt) return false;
  return isIsoDateInCalendarMonth(fullyPaidAt, mes, anio);
}
