/**
 * Alinea pedidos y tab Reservas con stockReservado de la grilla de productos.
 * Borra movimientos de reserva/transferencia y reconstruye cantidadReservada en pedidos.
 *
 * Uso: npm run stock:reconcile
 * Opcional: npm run stock:reconcile -- <businessId>
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { reconcileOrderStockFromProductReservations } from '../backend/utils/order-stock-reservations.ts';

async function resolveBusinessId(explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();

  const snap = await db.collection('negocios').limit(2).get();
  if (snap.empty) {
    throw new Error('No hay negocios en la base.');
  }
  if (snap.size > 1) {
    console.warn('[reconcile] Hay varios negocios; usando el primero:', snap.docs[0].id);
  }
  return snap.docs[0].id;
}

async function main(): Promise<void> {
  const businessId = await resolveBusinessId(process.argv[2]);
  console.log(`[reconcile] Negocio: ${businessId}`);

  const summary = await reconcileOrderStockFromProductReservations(businessId);

  console.log(`[reconcile] Pedidos actualizados: ${summary.ordersUpdated}`);
  console.log(`[reconcile] Movimientos de reserva eliminados: ${summary.movementsDeleted}`);
  console.log('[reconcile] Productos reservados:');
  for (const product of summary.products) {
    const ok = product.allocatedOnOrders === product.stockReservado ? 'OK' : 'REVISAR';
    console.log(
      `  - ${product.nombre}: grilla ${product.stockReservado} u. · pedidos ${product.allocatedOnOrders} u. [${ok}]`
    );
  }

  const mismatch = summary.products.some(
    (product) => product.allocatedOnOrders !== product.stockReservado
  );
  if (mismatch) {
    console.warn(
      '[reconcile] Hay diferencias: revisá si falta el producto en algún pedido activo.'
    );
  } else {
    console.log('[reconcile] Listo. Grilla, pedidos y Reservas deberían coincidir.');
  }
}

main().catch((error) => {
  console.error('[reconcile] Error:', error);
  process.exit(1);
});
