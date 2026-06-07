/**
 * Corrige el cliente de un pedido por número.
 * Uso: npx tsx scripts/fix-order-client-name.ts 00020 DevoHai [businessId]
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const targetLabel = (process.argv[2] ?? '00020').trim().padStart(5, '0');
const newClientName = String(process.argv[3] ?? 'DevoHai').trim();
const preferredBusinessId = process.argv[4]?.trim();

if (!newClientName) {
  console.error('Indicá el nombre del cliente.');
  process.exit(1);
}

async function findOrder(businessId: string) {
  const targetNumero = Number.parseInt(targetLabel, 10);
  if (Number.isFinite(targetNumero)) {
    const byNumero = await db
      .collection(`negocios/${businessId}/pedidos`)
      .where('numeroPedido', '==', targetNumero)
      .get();
    if (!byNumero.empty) return byNumero.docs[0];
  }

  const all = await db.collection(`negocios/${businessId}/pedidos`).get();
  return (
    all.docs.find((doc) => resolveOrderLabel(doc.data()) === targetLabel) ?? null
  );
}

async function findClientByName(businessId: string, name: string): Promise<string | null> {
  const snap = await db.collection(`negocios/${businessId}/clientes`).get();
  const normalized = name.trim().toLowerCase();
  const match = snap.docs.find(
    (doc) => String(doc.data().nombre ?? '').trim().toLowerCase() === normalized
  );
  return match?.id ?? null;
}

async function syncRelatedRecords(
  businessId: string,
  orderId: string,
  clienteId: string | null,
  clienteNombre: string
): Promise<void> {
  const batch = db.batch();
  let updates = 0;

  const orderSnap = await db.doc(`negocios/${businessId}/pedidos/${orderId}`).get();
  const order = orderSnap.data() ?? {};
  const ventaId = String(order.ventaId ?? '').trim();

  if (ventaId) {
    batch.update(db.doc(`negocios/${businessId}/ventas/${ventaId}`), {
      clienteId: clienteId ?? null,
      clienteNombre,
      updatedAt: new Date().toISOString(),
    });
    updates += 1;
  }

  const stockMovs = await db
    .collection(`negocios/${businessId}/movimientos_stock`)
    .where('pedidoId', '==', orderId)
    .get();
  for (const doc of stockMovs.docs) {
    batch.update(doc.ref, { clienteNombre, updatedAt: new Date().toISOString() });
    updates += 1;
  }

  if (updates > 0) {
    await batch.commit();
  }

  console.log(`[fix-order-client] Registros relacionados actualizados: ${updates}`);
}

async function main(): Promise<void> {
  console.log(`[fix-order-client] Pedido #${targetLabel} → cliente "${newClientName}"`);

  const businessIds = preferredBusinessId
    ? [preferredBusinessId]
    : (await db.collection('negocios').get()).docs.map((doc) => doc.id);

  for (const businessId of businessIds) {
    const orderDoc = await findOrder(businessId);
    if (!orderDoc) continue;

    const before = orderDoc.data();
    const orderId = orderDoc.id;
    const clienteId =
      (await findClientByName(businessId, newClientName)) ??
      (String(before.clienteId ?? '').trim() || null);

    console.log('[fix-order-client] Encontrado:', {
      businessId,
      orderId,
      label: resolveOrderLabel(before),
      clienteIdAntes: before.clienteId ?? null,
      clienteNombreAntes: before.clienteNombre ?? '',
      clienteIdNuevo: clienteId,
      clienteNombreNuevo: newClientName,
    });

    await orderDoc.ref.update({
      clienteId,
      clienteNombre: newClientName,
      updatedAt: new Date().toISOString(),
    });

    await syncRelatedRecords(businessId, orderId, clienteId, newClientName);

    console.log('[fix-order-client] Listo.');
    return;
  }

  console.error(`[fix-order-client] No se encontró el pedido #${targetLabel}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error('[fix-order-client] Error:', error);
  process.exit(1);
});
