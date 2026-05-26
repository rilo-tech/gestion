/**
 * Elimina un pedido por número (ej. 00002) del Firestore configurado en .env
 * Uso: npx tsx scripts/delete-order-by-label.ts 00002
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const targetLabel = (process.argv[2] ?? '00002').trim().padStart(5, '0');
const targetNumero = Number.parseInt(targetLabel, 10);

interface OrderRecord {
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  stockDescontado?: boolean;
  stockRestaurado?: boolean;
  items?: Array<{ stockItemId?: string; cantidad?: number }>;
  ventaId?: string;
}

async function restoreStockIfNeeded(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<void> {
  if (!order.stockDescontado || order.stockRestaurado) return;

  const orderLabel = resolveOrderLabel(order);

  for (const line of order.items ?? []) {
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: `Pedido #${orderLabel} eliminado (duplicado)`,
      origenId: orderId,
      origenTipo: 'pedido_cancelado',
      origenGrupo: 'pedido',
      usuarioId: 'admin',
      negocioId: businessId,
    });
  }
}

async function deleteCashMovementsForOrder(businessId: string, orderId: string): Promise<number> {
  const snap = await db
    .collection(`negocios/${businessId}/movimientos_caja`)
    .where('pedidoId', '==', orderId)
    .get();

  for (const doc of snap.docs) {
    await doc.ref.delete();
  }

  return snap.size;
}

async function main(): Promise<void> {
  console.log(`[delete-order] Buscando pedido #${targetLabel}...`);

  const negociosSnap = await db.collection('negocios').get();
  let deleted = 0;

  for (const businessDoc of negociosSnap.docs) {
    const businessId = businessDoc.id;
    const pedidosSnap = await db.collection(`negocios/${businessId}/pedidos`).get();

    for (const orderDoc of pedidosSnap.docs) {
      const data = orderDoc.data() as OrderRecord;
      const label = resolveOrderLabel(data);
      const matches =
        label === targetLabel ||
        data.numeroPedidoLabel === targetLabel ||
        data.numeroPedido === targetNumero;

      if (!matches) continue;

      if (data.ventaId) {
        console.error(
          `[delete-order] Pedido #${label} (${orderDoc.id}) tiene venta vinculada. No se eliminó.`
        );
        continue;
      }

      await restoreStockIfNeeded(businessId, orderDoc.id, data);
      const cashDeleted = await deleteCashMovementsForOrder(businessId, orderDoc.id);
      await orderDoc.ref.delete();

      deleted++;
      console.log(
        `[delete-order] Eliminado pedido #${label} (${orderDoc.id}) en negocio ${businessId}` +
          (cashDeleted ? ` · ${cashDeleted} mov. caja` : '')
      );
    }
  }

  if (deleted === 0) {
    console.log(`[delete-order] No se encontró ningún pedido #${targetLabel}.`);
  } else {
    console.log(`[delete-order] Listo. Pedidos eliminados: ${deleted}`);
  }
}

main().catch((error) => {
  console.error('[delete-order] Error:', error);
  process.exit(1);
});
