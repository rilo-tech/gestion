/**
 * Marca productos de servicio/personalización (ej. Estampado) y limpia stock erróneo.
 *
 * Uso:
 *   npx tsx scripts/repair-service-stock-products.ts
 *   npx tsx scripts/repair-service-stock-products.ts --apply
 *   npx tsx scripts/repair-service-stock-products.ts --apply --nombre=Estampado
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import {
  computeLineStockFields,
  computeOrderStockStatus,
} from '../backend/utils/order-stock-reservations.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID =
  process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';
const PRODUCT_NAME =
  process.argv.find((arg) => arg.startsWith('--nombre='))?.split('=')[1] ?? 'Estampado';

async function resolveBusinessId(): Promise<string> {
  const explicit = BUSINESS_ID.trim();
  if (explicit) {
    const snap = await db.doc(`negocios/${explicit}`).get();
    if (snap.exists) return explicit;
  }

  const snap = await db.collection('negocios').limit(2).get();
  if (snap.empty) throw new Error('No hay negocios.');
  return snap.docs[0].id;
}

async function main(): Promise<void> {
  const businessId = await resolveBusinessId();
  console.log(`[service-stock] Negocio: ${businessId}`);
  console.log(`[service-stock] Producto: ${PRODUCT_NAME}`);
  console.log(`[service-stock] Modo: ${APPLY ? 'APLICAR' : 'SIMULACIÓN (usá --apply)'}`);

  const stockSnap = await db
    .collection(`negocios/${businessId}/stock`)
    .where('nombre', '==', PRODUCT_NAME)
    .get();

  if (stockSnap.empty) {
    throw new Error(`No se encontró "${PRODUCT_NAME}" en stock.`);
  }

  const productDoc = stockSnap.docs[0];
  const productId = productDoc.id;
  const before = productDoc.data();

  console.log('[service-stock] Estado actual del producto:');
  console.log(
    `  controlaStock=${before.controlaStock !== false} · stockActual=${before.stockActual ?? 0} · stockReservado=${before.stockReservado ?? 0}`
  );

  const movSnap = await db
    .collection(`negocios/${businessId}/movimientos_stock`)
    .where('productoId', '==', productId)
    .get();

  console.log(`[service-stock] Movimientos del producto: ${movSnap.size}`);
  for (const doc of movSnap.docs) {
    const data = doc.data();
    console.log(
      `  - ${doc.id}: ${data.tipo} ${data.cantidad} · ${data.motivo} · afectaStockReal=${data.afectaStockReal !== false}`
    );
  }

  if (APPLY) {
    await productDoc.ref.update({
      controlaStock: false,
      stockActual: 0,
      stockReservado: 0,
      stockMinimo: 0,
      updatedAt: new Date().toISOString(),
    });

    for (const doc of movSnap.docs) {
      await doc.ref.delete();
      console.log(`[service-stock] Movimiento eliminado: ${doc.id}`);
    }
  }

  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  let ordersUpdated = 0;

  for (const orderDoc of ordersSnap.docs) {
    const data = orderDoc.data();
    const items = Array.isArray(data.items) ? [...data.items] : [];
    let changed = false;

    const nextItems = items.map((line) => {
      if (String(line.stockItemId ?? '') !== productId) return line;
      changed = true;
      return computeLineStockFields({
        ...line,
        controlaStock: false,
        cantidadReservada: 0,
        cantidadFaltante: 0,
      });
    });

    if (!changed) continue;

    const estadoStock = computeOrderStockStatus(nextItems);
    console.log(
      `[service-stock] Pedido ${orderDoc.id}: línea "${PRODUCT_NAME}" → sin control de stock · estadoStock=${estadoStock}`
    );

    if (APPLY) {
      await orderDoc.ref.update({
        items: nextItems,
        estadoStock,
        updatedAt: new Date().toISOString(),
      });
    }
    ordersUpdated++;
  }

  console.log(`[service-stock] Pedidos actualizados: ${ordersUpdated}`);

  if (!APPLY) {
    console.log('[service-stock] Simulación OK. Ejecutá con --apply para persistir.');
    return;
  }

  console.log('[service-stock] Listo.');
}

main().catch((error) => {
  console.error('[service-stock] Error:', error);
  process.exit(1);
});
