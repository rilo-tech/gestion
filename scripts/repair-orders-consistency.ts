/**
 * Deja pedidos #00001, #00002 y #00003 consistentes.
 * Renumerar #00004 → #00003, actualizar movimientos y contador.
 *
 * Uso:
 *   npx tsx scripts/repair-orders-consistency.ts
 *   npx tsx scripts/repair-orders-consistency.ts --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { formatOrderNumber, resolveOrderLabel } from '../backend/utils/order-number.ts';
import { reconcileOrderStockFromProductReservations } from '../backend/utils/order-stock-reservations.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';

const RENUMBER: Array<{ from: string; to: string }> = [{ from: '00004', to: '00003' }];
const TARGET_ULTIMO_PEDIDO = 3;

type OrderDoc = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

function matchesLabel(data: Record<string, unknown>, label: string): boolean {
  const padded = label.padStart(5, '0');
  const numero = Number.parseInt(label, 10);
  return (
    resolveOrderLabel(data) === padded ||
    data.numeroPedidoLabel === padded ||
    data.numeroPedido === numero
  );
}

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

async function findOrderByLabel(
  businessId: string,
  label: string
): Promise<OrderDoc | null> {
  const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
  for (const doc of snap.docs) {
    if (matchesLabel(doc.data(), label)) return doc;
  }
  return null;
}

async function deleteOrdersAboveNumber(
  businessId: string,
  maxNumber: number,
  keepLabels: string[] = []
): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
  let deleted = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const label = resolveOrderLabel(data);
    if (keepLabels.includes(label)) continue;

    const numero = Number(data.numeroPedido) || Number.parseInt(label, 10) || 0;
    if (numero <= maxNumber) continue;

    if (APPLY) {
      await deleteRelatedDataForOrder(businessId, doc.id);
      await doc.ref.delete();
    }
    console.log(`[repair] Eliminar pedido #${label} (${doc.id})`);
    deleted++;
  }

  return deleted;
}

async function deleteRelatedDataForOrder(businessId: string, orderId: string): Promise<void> {
  const stockSnap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();
  for (const doc of stockSnap.docs) {
    const data = doc.data();
    if (data.pedidoId === orderId || data.origenId === orderId) {
      await doc.ref.delete();
    }
  }

  const cashSnap = await db
    .collection(`negocios/${businessId}/movimientos_caja`)
    .where('pedidoId', '==', orderId)
    .get();
  for (const doc of cashSnap.docs) {
    await doc.ref.delete();
  }

  const salesSnap = await db
    .collection(`negocios/${businessId}/ventas`)
    .where('pedidoId', '==', orderId)
    .get();
  for (const doc of salesSnap.docs) {
    await doc.ref.delete();
  }
}

async function updateMovementMotivos(
  businessId: string,
  replacements: Array<{ from: string; to: string }>
): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    let motivo = String(data.motivo ?? '');
    let numeroPedidoLabel = data.numeroPedidoLabel ? String(data.numeroPedidoLabel) : '';
    let changed = false;

    for (const { from, to } of replacements) {
      const fromHash = `#${from}`;
      const toHash = `#${to}`;
      if (motivo.includes(fromHash)) {
        motivo = motivo.split(fromHash).join(toHash);
        changed = true;
      }
      if (numeroPedidoLabel === from) {
        numeroPedidoLabel = to;
        changed = true;
      }
    }

    if (!changed) continue;

    if (APPLY) {
      await doc.ref.update({
        motivo,
        ...(numeroPedidoLabel ? { numeroPedidoLabel } : {}),
      });
    }
    updated++;
  }

  const cashSnap = await db.collection(`negocios/${businessId}/movimientos_caja`).get();
  for (const doc of cashSnap.docs) {
    const data = doc.data();
    let motivo = String(data.motivo ?? data.descripcion ?? '');
    let changed = false;

    for (const { from, to } of replacements) {
      const fromHash = `#${from}`;
      const toHash = `#${to}`;
      if (motivo.includes(fromHash)) {
        motivo = motivo.split(fromHash).join(toHash);
        changed = true;
      }
    }

    if (!changed) continue;

    if (APPLY) {
      await doc.ref.update({
        ...(data.motivo ? { motivo } : {}),
        ...(data.descripcion ? { descripcion: motivo } : {}),
      });
    }
    updated++;
  }

  return updated;
}

async function main(): Promise<void> {
  const businessId = await resolveBusinessId();
  console.log(`[repair] Negocio: ${businessId}`);
  console.log(`[repair] Modo: ${APPLY ? 'APLICAR' : 'SIMULACIÓN (usá --apply)'}`);

  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  console.log(`[repair] Pedidos actuales: ${ordersSnap.size}`);
  for (const doc of ordersSnap.docs.sort(
    (a, b) => (Number(a.data().numeroPedido) || 0) - (Number(b.data().numeroPedido) || 0)
  )) {
    const data = doc.data();
    console.log(`  - #${resolveOrderLabel(data)} (${doc.id}) · ${data.estado}`);
  }

  for (const { from, to } of RENUMBER) {
    const existingTarget = await findOrderByLabel(businessId, to);
    if (existingTarget) {
      throw new Error(
        `Ya existe pedido #${to} (${existingTarget.id}). Resolvé el conflicto antes de continuar.`
      );
    }

    const order = await findOrderByLabel(businessId, from);
    if (!order) {
      console.log(`[repair] No hay pedido #${from} para renumerar (omitido).`);
      continue;
    }
    console.log(`[repair] Renumerar #${from} → #${to} (${order.id})`);
  }

  const extraDeleted = await deleteOrdersAboveNumber(
    businessId,
    TARGET_ULTIMO_PEDIDO,
    RENUMBER.map((item) => item.from)
  );
  if (extraDeleted === 0) {
    console.log(`[repair] No hay pedidos con número > ${TARGET_ULTIMO_PEDIDO}.`);
  }

  if (!APPLY) {
    console.log(`[repair] Contador ultimoPedido → ${TARGET_ULTIMO_PEDIDO}`);
    console.log('[repair] Simulación terminada. Ejecutá con --apply para persistir.');
    return;
  }

  for (const { from, to } of RENUMBER) {
    const order = await findOrderByLabel(businessId, from);
    if (!order) continue;

    const numero = Number.parseInt(to, 10);
    await order.ref.update({
      numeroPedido: numero,
      numeroPedidoLabel: formatOrderNumber(numero),
      updatedAt: new Date().toISOString(),
    });
    console.log(`[repair] Pedido ${order.id} renumerado a #${to}`);
  }

  const extraDeletedAfter = await deleteOrdersAboveNumber(businessId, TARGET_ULTIMO_PEDIDO);
  if (extraDeletedAfter > 0) {
    console.log(`[repair] Pedidos extra eliminados: ${extraDeletedAfter}`);
  }

  const motivosUpdated = await updateMovementMotivos(businessId, RENUMBER);
  console.log(`[repair] Referencias en movimientos actualizadas: ${motivosUpdated}`);

  await db.doc(`negocios/${businessId}/config/contadores`).set(
    {
      ultimoPedido: TARGET_ULTIMO_PEDIDO,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  console.log(`[repair] Contador ultimoPedido = ${TARGET_ULTIMO_PEDIDO}`);

  const summary = await reconcileOrderStockFromProductReservations(businessId);
  console.log(
    `[repair] Reconcile pedidos: ${summary.ordersUpdated} · mov. reserva borrados: ${summary.movementsDeleted}`
  );
  for (const product of summary.products) {
    console.log(
      `  - ${product.nombre}: grilla ${product.stockReservado} u. · pedidos ${product.allocatedOnOrders} u.`
    );
  }

  const finalSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  console.log('[repair] Pedidos finales:');
  for (const doc of finalSnap.docs.sort(
    (a, b) => (Number(a.data().numeroPedido) || 0) - (Number(b.data().numeroPedido) || 0)
  )) {
    const data = doc.data();
    console.log(`  - #${resolveOrderLabel(data)} (${doc.id}) · ${data.estado}`);
  }

  console.log('[repair] Listo.');
}

main().catch((error) => {
  console.error('[repair] Error:', error);
  process.exit(1);
});
