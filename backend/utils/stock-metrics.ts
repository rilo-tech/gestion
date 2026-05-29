import { db } from '../firebase.ts';
import { getStockEnDeposito, productControlsStock } from './stock-product.ts';

export type StockMetrics = {
  totalItems: number;
  lowStockCount: number;
  /** Suma costo × unidades en depósito (disponible + reservado, sin duplicar). */
  valorDepositoEstimado: number;
  updatedAt: string;
};

const DEFAULT_METRICS: StockMetrics = {
  totalItems: 0,
  lowStockCount: 0,
  valorDepositoEstimado: 0,
  updatedAt: '',
};

function metricsRef(businessId: string) {
  return db.doc(`negocios/${businessId}/metrics/stock`);
}

function isLowStockItem(data: Record<string, unknown>): boolean {
  if (!productControlsStock(data)) return false;
  const minStock = Number(data.stockMinimo) || 0;
  if (minStock <= 0) return false;
  const disponible = Math.max(
    0,
    (Number(data.stockActual) || 0) - (Number(data.stockReservado) || 0)
  );
  return disponible <= minStock;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function recomputeStockMetrics(businessId: string): Promise<StockMetrics> {
  const snapshot = await db.collection(`negocios/${businessId}/stock`).get();

  let lowStockCount = 0;
  let valorDepositoEstimado = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (isLowStockItem(data)) lowStockCount += 1;
    if (!productControlsStock(data)) continue;
    const deposito = getStockEnDeposito(
      Number(data.stockActual) || 0,
      Number(data.stockReservado) || 0
    );
    if (deposito <= 0) continue;
    const costo = Number(data.costo) || 0;
    valorDepositoEstimado += deposito * costo;
  }

  const metrics: StockMetrics = {
    totalItems: snapshot.size,
    lowStockCount,
    valorDepositoEstimado: roundMoney(valorDepositoEstimado),
    updatedAt: new Date().toISOString(),
  };

  await metricsRef(businessId).set(metrics, { merge: true });
  return metrics;
}

export async function getStockMetrics(businessId: string): Promise<StockMetrics> {
  const snap = await metricsRef(businessId).get();
  if (!snap.exists) return { ...DEFAULT_METRICS };
  const data = snap.data() as Partial<StockMetrics>;
  return {
    totalItems: Number(data.totalItems) || 0,
    lowStockCount: Number(data.lowStockCount) || 0,
    valorDepositoEstimado: Number(data.valorDepositoEstimado) || 0,
    updatedAt: String(data.updatedAt ?? ''),
  };
}

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Recalcula en segundo plano (agrupa cambios seguidos de pedidos/compras/ventas). */
export function scheduleStockMetricsRefresh(businessId: string, delayMs = 1000): void {
  const existing = refreshTimers.get(businessId);
  if (existing) clearTimeout(existing);
  refreshTimers.set(
    businessId,
    setTimeout(() => {
      refreshTimers.delete(businessId);
      void recomputeStockMetrics(businessId).catch((error) => {
        console.error(`[stock-metrics] refresh failed for ${businessId}:`, error);
      });
    }, delayMs)
  );
}
