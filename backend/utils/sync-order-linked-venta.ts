import { db } from '../firebase.ts';

type OrderWithVenta = {
  ventaId?: string | null;
};

/** Mantiene saldoPendiente/montoCobrado de la venta alineados con el saldo del pedido. */
export async function syncOrderLinkedVentaSaldo(
  businessId: string,
  order: OrderWithVenta,
  saldo: number,
  total: number
): Promise<void> {
  const ventaId = order.ventaId ? String(order.ventaId).trim() : '';
  if (!ventaId) return;

  const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
  const ventaSnap = await ventaRef.get();
  if (!ventaSnap.exists) return;

  const ventaData = ventaSnap.data() ?? {};
  const totalVenta = Number(ventaData.total) || total;
  const montoCobrado = Math.max(0, totalVenta - saldo);
  await ventaRef.update({
    montoCobrado,
    saldoPendiente: saldo,
    updatedAt: new Date().toISOString(),
  });
}
