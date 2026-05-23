import { db } from '../firebase.ts';

export function formatOrderNumber(numero?: number): string {
  if (!numero || numero <= 0) return '';
  return String(numero).padStart(5, '0');
}

export function resolveOrderLabel(
  order: { numeroPedido?: number; numeroPedidoLabel?: string }
): string {
  if (order.numeroPedidoLabel) return order.numeroPedidoLabel;
  if (order.numeroPedido) return formatOrderNumber(order.numeroPedido);
  return '—';
}

async function bootstrapCounter(businessId: string): Promise<number> {
  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  let maxNum = 0;

  for (const doc of ordersSnap.docs) {
    const numero = Number(doc.data().numeroPedido) || 0;
    if (numero > maxNum) maxNum = numero;
  }

  return maxNum;
}

async function ensureCounter(businessId: string): Promise<void> {
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  if (snap.exists && Number(snap.data()?.ultimoPedido) > 0) return;

  const maxNum = await bootstrapCounter(businessId);
  await counterRef.set(
    { ultimoPedido: maxNum, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function allocateOrderNumber(
  businessId: string
): Promise<{ numero: number; label: string }> {
  await ensureCounter(businessId);
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.ultimoPedido) || 0 : 0;
    const next = current + 1;
    const label = formatOrderNumber(next);

    tx.set(
      counterRef,
      { ultimoPedido: next, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    return { numero: next, label };
  });
}
