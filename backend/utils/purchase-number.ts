import { db } from '../firebase.ts';

export function formatPurchaseNumber(numero?: number): string {
  if (!numero || numero <= 0) return '';
  return String(numero).padStart(5, '0');
}

export function resolvePurchaseLabel(compra: {
  numeroCompra?: number;
  compraLabel?: string;
  estado?: string;
  id?: string;
}): string {
  if (String(compra.estado ?? '').trim().toLowerCase() === 'borrador') return 'Borrador';
  if (compra.compraLabel) return compra.compraLabel;
  if (compra.numeroCompra) return formatPurchaseNumber(compra.numeroCompra);
  if (compra.id) return compra.id.slice(-6).toUpperCase();
  return '—';
}

async function bootstrapPurchaseCounter(businessId: string): Promise<number> {
  const comprasSnap = await db.collection(`negocios/${businessId}/compras`).get();
  let maxNum = 0;

  for (const doc of comprasSnap.docs) {
    const numero = Number(doc.data().numeroCompra) || 0;
    if (numero > maxNum) maxNum = numero;
  }

  return maxNum;
}

async function ensurePurchaseCounter(businessId: string): Promise<void> {
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  if (snap.exists && Number(snap.data()?.ultimoCompra) > 0) return;

  const maxNum = await bootstrapPurchaseCounter(businessId);
  await counterRef.set(
    { ultimoCompra: maxNum, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function allocatePurchaseNumber(
  businessId: string
): Promise<{ numero: number; label: string }> {
  await ensurePurchaseCounter(businessId);
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.ultimoCompra) || 0 : 0;
    const next = current + 1;
    const label = formatPurchaseNumber(next);

    tx.set(
      counterRef,
      { ultimoCompra: next, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    return { numero: next, label };
  });
}
