import { db } from '../firebase.ts';

function normalizeAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function productAliasKey(name: string): string {
  const key = normalizeAlias(name)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  return key || 'alias';
}

function aliasRef(businessId: string, name: string) {
  return db.doc(`negocios/${businessId}/whatsapp_product_aliases/${productAliasKey(name)}`);
}

export type ProductAliasHit =
  | { kind: 'product'; productId: string; productName: string }
  | { kind: 'insumo' };

export async function findProductAlias(
  businessId: string,
  invoiceName: string
): Promise<ProductAliasHit | null> {
  const raw = invoiceName.trim();
  if (raw.length < 2) return null;
  const snap = await aliasRef(businessId, raw).get();
  if (!snap.exists) return null;
  const data = snap.data() as {
    productId?: string;
    productName?: string;
    tipoLinea?: string;
  };
  if (String(data.tipoLinea ?? '').trim().toLowerCase() === 'insumo') {
    return { kind: 'insumo' };
  }
  const productId = String(data.productId ?? '').trim();
  if (!productId) return null;

  const productSnap = await db.doc(`negocios/${businessId}/stock/${productId}`).get();
  if (!productSnap.exists || productSnap.data()?.activo === false) {
    await snap.ref.delete().catch(() => undefined);
    return null;
  }
  const nombre = String(productSnap.data()?.nombre ?? data.productName ?? '').trim();
  return { kind: 'product', productId, productName: nombre || raw };
}

export async function saveProductAlias(
  businessId: string,
  invoiceName: string,
  product: { id: string; nombre: string }
): Promise<void> {
  const raw = invoiceName.trim();
  if (raw.length < 2 || !product.id) return;
  if (normalizeAlias(raw) === normalizeAlias(product.nombre)) return;
  await aliasRef(businessId, raw).set(
    {
      aliasKey: productAliasKey(raw),
      aliasRaw: raw,
      tipoLinea: 'stock',
      productId: product.id,
      productName: product.nombre,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

/** Recuerda que ese texto de boleta es insumo/herramienta (no mueve stock). */
export async function saveInsumoAlias(businessId: string, invoiceName: string): Promise<void> {
  const raw = invoiceName.trim();
  if (raw.length < 2) return;
  await aliasRef(businessId, raw).set(
    {
      aliasKey: productAliasKey(raw),
      aliasRaw: raw,
      tipoLinea: 'insumo',
      productId: '',
      productName: '',
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
