import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';
const ORDER_LABEL = (
  process.argv.find((arg) => arg.startsWith('--order='))?.split('=')[1] ?? '00002'
).padStart(5, '0');

type OrderDoc = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

async function findOrderByLabel(businessId: string, label: string): Promise<OrderDoc | null> {
  const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
  for (const doc of snap.docs) {
    if (resolveOrderLabel(doc.data()) === label) return doc;
  }
  return null;
}

async function main(): Promise<void> {
  const orderDoc = await findOrderByLabel(BUSINESS_ID, ORDER_LABEL);
  if (!orderDoc) throw new Error(`Pedido #${ORDER_LABEL} no encontrado.`);

  const order = orderDoc.data();
  const orderId = orderDoc.id;
  const orderLabel = resolveOrderLabel(order);
  const now = new Date().toISOString();
  const items = Array.isArray(order.items) ? order.items : [];

  const movSnap = await db.collection(`negocios/${BUSINESS_ID}/movimientos_stock`).get();
  const toDelete = movSnap.docs.filter((doc) => {
    const data = doc.data();
    const sameOrder = data.pedidoId === orderId || data.origenId === orderId;
    if (!sameOrder) return false;
    const origenTipo = String(data.origenTipo ?? '');
    return origenTipo === 'pedido_produccion' || origenTipo === 'pedido_correccion_stock';
  });

  const toCreate = items
    .map((line: Record<string, unknown>) => {
      const qty = Math.max(0, Number(line.cantidadUsada) || 0);
      const productoId = String(line.stockItemId ?? '').trim();
      if (!productoId || qty <= 0) return null;
      return {
        productoId,
        tipo: 'salida' as const,
        cantidad: qty,
        fecha: now,
        motivo: `Pedido #${orderLabel} - En producción`,
        origenId: orderId,
        origenTipo: 'pedido_produccion',
        origenGrupo: 'pedido',
        pedidoId: orderId,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        clienteId: order.clienteId ?? null,
        clienteNombre: order.clienteNombre ?? null,
        afectaStockReal: true,
        negocioId: BUSINESS_ID,
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  console.log(`[repair] Pedido #${orderLabel} (${orderId})`);
  console.log(`[repair] Movimientos a borrar: ${toDelete.length}`);
  console.log(`[repair] Movimientos correctos a crear: ${toCreate.length}`);
  toCreate.forEach((mov) =>
    console.log(`  + ${String(mov.motivo)} :: producto=${String(mov.productoId)} cant=${Number(mov.cantidad)}`)
  );

  if (!APPLY) {
    console.log('[repair] Simulación terminada. Ejecutá con --apply para persistir.');
    return;
  }

  for (const doc of toDelete) {
    await doc.ref.delete();
  }
  for (const mov of toCreate) {
    await db.collection(`negocios/${BUSINESS_ID}/movimientos_stock`).add(mov);
  }

  console.log('[repair] Listo. Movimientos de producción normalizados.');
}

main().catch((error) => {
  console.error('[repair] Error:', error);
  process.exit(1);
});
