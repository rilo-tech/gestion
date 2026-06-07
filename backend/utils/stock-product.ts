import { db } from '../firebase.ts';

export function productControlsStock(data: Record<string, unknown> | undefined): boolean {
  return data?.controlaStock !== false;
}

export function getStockDisponibleFromValues(
  stockActual: number,
  stockReservado: number
): number {
  return Math.max(0, (Number(stockActual) || 0) - (Number(stockReservado) || 0));
}

/** Unidades físicas en depósito: libre + reservado (una sola vez, sin duplicar). */
export function getStockEnDeposito(stockActual: number, stockReservado: number): number {
  const reservado = Math.max(0, Number(stockReservado) || 0);
  return getStockDisponibleFromValues(stockActual, stockReservado) + reservado;
}

export function productPermitsNegativeStock(data: Record<string, unknown> | undefined): boolean {
  return data?.permitirStockNegativo !== false;
}

export async function renameProductCategory(
  businessId: string,
  from: string,
  to: string
): Promise<{ stockUpdated: number }> {
  const fromKey = from.trim().toLowerCase();
  const toName = to.trim();
  if (!fromKey || !toName || fromKey === toName.toLowerCase()) {
    return { stockUpdated: 0 };
  }

  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  let stockUpdated = 0;

  for (const doc of stockSnap.docs) {
    const prodCat = String(doc.data().categoria ?? '')
      .trim()
      .toLowerCase();
    if (prodCat !== fromKey) continue;
    await doc.ref.update({
      categoria: toName,
      updatedAt: new Date().toISOString(),
    });
    stockUpdated += 1;
  }

  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const counterSnap = await counterRef.get();
  const counters = (counterSnap.data()?.codigosProducto as Record<string, number>) ?? {};
  const counterKey = Object.keys(counters).find(
    (key) => key.trim().toLowerCase() === fromKey
  );

  if (counterKey) {
    const nextCounters = { ...counters };
    if (nextCounters[toName] === undefined) {
      nextCounters[toName] = nextCounters[counterKey];
    }
    delete nextCounters[counterKey];
    await counterRef.set(
      {
        codigosProducto: nextCounters,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  return { stockUpdated };
}

/** Renombra un valor de talle o color en todos los productos que lo usan. */
export async function renameProductField(
  businessId: string,
  field: 'talle' | 'color',
  from: string,
  to: string
): Promise<{ stockUpdated: number }> {
  const fromKey = from.trim().toLowerCase();
  const toName = to.trim();
  if (!fromKey || !toName || fromKey === toName.toLowerCase()) {
    return { stockUpdated: 0 };
  }

  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  let stockUpdated = 0;

  for (const doc of stockSnap.docs) {
    const value = String(doc.data()[field] ?? '')
      .trim()
      .toLowerCase();
    if (value !== fromKey) continue;
    await doc.ref.update({
      [field]: toName,
      updatedAt: new Date().toISOString(),
    });
    stockUpdated += 1;
  }

  return { stockUpdated };
}

export async function countStockItemsInCategoria(
  businessId: string,
  categoria: string
): Promise<number> {
  const target = categoria.trim().toLowerCase();
  if (!target) return 0;

  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  return snap.docs.filter((doc) => {
    const prodCat = String(doc.data().categoria ?? '')
      .trim()
      .toLowerCase();
    return prodCat === target;
  }).length;
}
