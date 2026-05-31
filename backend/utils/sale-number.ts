import { db } from '../firebase.ts';

export function formatSaleNumber(numero?: number): string {
  if (!numero || numero <= 0) return '';
  return String(numero).padStart(5, '0');
}

export function resolveSaleLabel(venta: {
  numeroVenta?: number;
  ventaLabel?: string;
  estado?: string;
}): string {
  if (String(venta.estado ?? '').trim().toLowerCase() === 'borrador') return 'Borrador';
  if (venta.ventaLabel) return venta.ventaLabel;
  if (venta.numeroVenta) return formatSaleNumber(venta.numeroVenta);
  return '—';
}

async function bootstrapSaleCounter(businessId: string): Promise<number> {
  const ventasSnap = await db.collection(`negocios/${businessId}/ventas`).get();
  let maxNum = 0;

  for (const doc of ventasSnap.docs) {
    const numero = Number(doc.data().numeroVenta) || 0;
    if (numero > maxNum) maxNum = numero;
  }

  return maxNum;
}

async function ensureSaleCounter(businessId: string): Promise<void> {
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  if (snap.exists && Number(snap.data()?.ultimoVenta) > 0) return;

  const maxNum = await bootstrapSaleCounter(businessId);
  await counterRef.set(
    { ultimoVenta: maxNum, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function allocateSaleNumber(
  businessId: string
): Promise<{ numero: number; label: string }> {
  await ensureSaleCounter(businessId);
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? Number(snap.data()?.ultimoVenta) || 0 : 0;
    const next = current + 1;
    const label = formatSaleNumber(next);

    tx.set(
      counterRef,
      { ultimoVenta: next, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    return { numero: next, label };
  });
}
