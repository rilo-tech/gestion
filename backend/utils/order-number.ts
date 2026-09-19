import { db } from '../firebase.ts';

export function formatOrderNumber(numero?: number): string {
  if (!numero || numero <= 0) return '';
  return String(numero).padStart(5, '0');
}

export type NormalizedOrderReference = {
  raw: string;
  digits: string;
  numeric: number;
  label: string;
};

/**
 * Technical identifier normalization only. Accepts 239 / 00239 / #239 / #00239.
 * Does not interpret Spanish or discover intent from a phrase.
 */
export function normalizeOrderReference(input: unknown): NormalizedOrderReference | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const stripped = raw.replace(/^#\s*/, '').trim();
  if (!/^\d{1,12}$/.test(stripped)) return null;
  const numeric = Number(stripped.replace(/^0+/, '') || '0');
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return {
    raw,
    digits: String(numeric),
    numeric,
    label: formatOrderNumber(numeric),
  };
}

export function orderReferenceLookupValues(
  ref: NormalizedOrderReference
): Array<{ field: 'numeroPedido' | 'numeroPedidoLabel'; value: string | number }> {
  const values: Array<{ field: 'numeroPedido' | 'numeroPedidoLabel'; value: string | number }> = [
    { field: 'numeroPedidoLabel', value: ref.label },
    { field: 'numeroPedido', value: ref.numeric },
  ];
  if (ref.digits !== ref.label) {
    values.push(
      { field: 'numeroPedidoLabel', value: ref.digits },
      { field: 'numeroPedido', value: ref.digits },
      { field: 'numeroPedido', value: ref.label }
    );
  }
  return values;
}

export function orderRecordMatchesReference(
  data: { numeroPedido?: unknown; numeroPedidoLabel?: unknown },
  ref: NormalizedOrderReference
): boolean {
  const label = String(data.numeroPedidoLabel ?? '').trim();
  if (label === ref.label || label === ref.digits) return true;
  if (data.numeroPedido == null || data.numeroPedido === '') return false;
  const asString = String(data.numeroPedido).trim();
  if (asString === ref.label || asString === ref.digits) return true;
  const asNumber = Number(asString.replace(/^0+/, '') || '0');
  return Number.isFinite(asNumber) && asNumber === ref.numeric;
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
