import { db } from '../firebase.ts';

/** Normaliza descripciones externas de remito/compra para lookup exacto (sin fuzzy). */
export function normalizeExternalDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita cantidad/precio al inicio de una línea de remito (normalización técnica, no NLP). */
export function stripLeadingQuantityFromLine(text: string): string {
  return String(text ?? '')
    .replace(/^\s*\d+(?:[.,]\d+)?\s*(?:x|×|\*)?\s*/i, '')
    .trim();
}

/** Descripción estable para SupplierProductMapping (sin cantidad ni línea bruta). */
export function mappingExternalDescription(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const withoutQty = stripLeadingQuantityFromLine(trimmed);
  return withoutQty || trimmed;
}

function normalizeAlias(value: string): string {
  return normalizeExternalDescription(value);
}

export function productAliasKey(name: string): string {
  const canonical = mappingExternalDescription(name) || name;
  const key = normalizeAlias(canonical)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
  return key || 'alias';
}

function aliasDocId(name: string, supplierId?: string | null): string {
  const canonical = mappingExternalDescription(name) || name;
  const base = productAliasKey(canonical);
  const supplier = String(supplierId ?? '').trim();
  return supplier ? `${base}__s_${supplier.slice(0, 40)}` : base;
}

function aliasRef(businessId: string, name: string, supplierId?: string | null) {
  return db.doc(`negocios/${businessId}/whatsapp_product_aliases/${aliasDocId(name, supplierId)}`);
}

export type ProductAliasHit =
  | { kind: 'product'; productId: string; productName: string }
  | { kind: 'insumo' };

export type ProductSupplierMappingSource = 'confirmed_manual_match' | 'confirmed_auto_match';

export type ProductSupplierMappingRecord = {
  id: string;
  businessId: string;
  supplierId: string;
  rawExternalDescription: string;
  normalizedExternalDescription: string;
  productId: string;
  productNameSnapshot?: string;
  source: ProductSupplierMappingSource;
  active: boolean;
  useCount: number;
  lastUsedAt?: string | null;
  previousProductId?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  lastConfirmedPurchaseId?: string | null;
};

type AliasDoc = {
  productId?: string;
  productName?: string;
  productNameSnapshot?: string;
  tipoLinea?: string;
  active?: boolean;
  useCount?: number;
  lastUsedAt?: string | null;
  lastConfirmedPurchaseId?: string | null;
  lastConfirmedPurchaseIds?: string[];
  previousProductId?: string | null;
  createdAt?: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  source?: string;
  supplierId?: string | null;
  aliasRaw?: string;
  rawExternalDescription?: string;
  normalizedExternalDescription?: string;
};

async function markMappingInactive(
  ref: { set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown> },
  reason: string
): Promise<void> {
  await ref.set(
    {
      active: false,
      staleAt: new Date().toISOString(),
      staleReason: reason,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

async function touchMappingUsage(
  ref: { set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown> },
  data: AliasDoc
): Promise<void> {
  const useCount = Number(data.useCount ?? 0) + 1;
  await ref.set(
    {
      useCount,
      lastUsedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

async function readAliasHit(
  businessId: string,
  raw: string,
  snap: {
    exists: boolean;
    id: string;
    data: () => Record<string, unknown> | undefined;
    ref: {
      set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown>;
    };
  },
  options?: { touchUsage?: boolean; logSource?: 'supplier_mapping' | 'global_alias'; supplierId?: string }
): Promise<ProductAliasHit | null> {
  if (!snap.exists) return null;
  const data = snap.data() as AliasDoc;
  if (data.active === false) return null;
  if (String(data.tipoLinea ?? '').trim().toLowerCase() === 'insumo') {
    return { kind: 'insumo' };
  }
  const productId = String(data.productId ?? '').trim();
  if (!productId) return null;

  const productSnap = await db.doc(`negocios/${businessId}/stock/${productId}`).get();
  if (!productSnap.exists || productSnap.data()?.activo === false) {
    await markMappingInactive(snap.ref, 'product_unavailable');
    return null;
  }
  const nombre = String(productSnap.data()?.nombre ?? data.productName ?? data.productNameSnapshot ?? '').trim();

  if (options?.touchUsage !== false) {
    await touchMappingUsage(snap.ref, data);
  }

  if (options?.logSource === 'supplier_mapping') {
    console.info(
      '[purchase:item:resolved]',
      JSON.stringify({
        supplierId: options.supplierId ?? data.supplierId ?? null,
        externalDescription: raw,
        productId,
        source: 'supplier_mapping',
      })
    );
  }

  return { kind: 'product', productId, productName: nombre || raw };
}

/** Lookup global o por proveedor (legacy / memoria conversacional). */
export async function findProductAlias(
  businessId: string,
  invoiceName: string,
  supplierId?: string | null
): Promise<ProductAliasHit | null> {
  const raw = invoiceName.trim();
  if (raw.length < 2) return null;
  const supplier = String(supplierId ?? '').trim();
  if (supplier) {
    const scoped = await readAliasHit(
      businessId,
      raw,
      await aliasRef(businessId, raw, supplier).get(),
      { logSource: 'supplier_mapping', supplierId: supplier }
    );
    if (scoped) return scoped;
  }
  return readAliasHit(businessId, raw, await aliasRef(businessId, raw).get());
}

/** Lookup estricto por proveedor — sin fallback global. */
export async function findSupplierProductMapping(
  businessId: string,
  supplierId: string,
  externalDescription: string,
  options?: { touchUsage?: boolean }
): Promise<ProductAliasHit | null> {
  const supplier = String(supplierId ?? '').trim();
  const raw = externalDescription.trim();
  if (!supplier || raw.length < 2) return null;

  const lookupKeys = [mappingExternalDescription(raw), raw].filter(
    (value, index, list) => value.length >= 2 && list.indexOf(value) === index
  );

  for (const key of lookupKeys) {
    console.info(
      '[purchase:mapping:lookup]',
      JSON.stringify({
        supplierId: supplier,
        externalDescription: key,
        normalized: normalizeExternalDescription(key),
      })
    );
    const hit = await readAliasHit(
      businessId,
      key,
      await aliasRef(businessId, key, supplier).get(),
      { touchUsage: options?.touchUsage, logSource: 'supplier_mapping', supplierId: supplier }
    );
    if (hit) {
      console.info(
        '[purchase:mapping:hit]',
        JSON.stringify({ supplierId: supplier, externalDescription: key, productId: hit.kind === 'product' ? hit.productId : null })
      );
      return hit;
    }
  }

  console.info(
    '[purchase:mapping:miss]',
    JSON.stringify({ supplierId: supplier, externalDescription: raw, tried: lookupKeys })
  );
  return null;
}

export async function saveProductAlias(
  businessId: string,
  invoiceName: string,
  product: { id: string; nombre: string },
  options?: {
    supplierId?: string | null;
    source?: string;
    confirmedPurchaseId?: string | null;
    updatedBy?: string | null;
  }
): Promise<void> {
  const supplierId = String(options?.supplierId ?? '').trim();
  if (supplierId) {
    await saveSupplierProductMapping(businessId, invoiceName, product, {
      supplierId,
      source:
        options?.source === 'confirmed_auto_match'
          ? 'confirmed_auto_match'
          : 'confirmed_manual_match',
      confirmedPurchaseId: options?.confirmedPurchaseId ?? null,
      updatedBy: options?.updatedBy ?? null,
    });
    return;
  }

  const raw = invoiceName.trim();
  if (raw.length < 2 || !product.id) return;
  if (normalizeAlias(raw) === normalizeAlias(product.nombre)) return;
  const now = new Date().toISOString();
  const payload = {
    aliasKey: aliasDocId(raw),
    aliasRaw: raw,
    rawExternalDescription: raw,
    normalizedExternalDescription: normalizeExternalDescription(raw),
    tipoLinea: 'stock',
    productId: product.id,
    productName: product.nombre,
    productNameSnapshot: product.nombre,
    supplierId: null,
    source: String(options?.source ?? 'confirmed_purchase_match').trim() || 'confirmed_purchase_match',
    active: true,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
    useCount: 0,
  };
  await aliasRef(businessId, raw).set(payload, { merge: true });
}

export async function saveSupplierProductMapping(
  businessId: string,
  externalDescription: string,
  product: { id: string; nombre: string },
  options: {
    supplierId: string;
    source?: ProductSupplierMappingSource;
    confirmedPurchaseId?: string | null;
    updatedBy?: string | null;
  }
): Promise<void> {
  const supplierId = String(options.supplierId ?? '').trim();
  const raw = mappingExternalDescription(externalDescription);
  if (!supplierId || raw.length < 2 || !product.id) return;
  // Always persist supplier-scoped mappings — even when the remito text normalizes
  // to the catalog name. That is required to skip catalog ambiguity next time.

  const ref = aliasRef(businessId, raw, supplierId);
  const existing = await ref.get();
  const existingData = (existing.data() ?? {}) as AliasDoc;
  const confirmedPurchaseId = String(options.confirmedPurchaseId ?? '').trim();

  if (confirmedPurchaseId) {
    const priorIds = Array.isArray(existingData.lastConfirmedPurchaseIds)
      ? existingData.lastConfirmedPurchaseIds
      : existingData.lastConfirmedPurchaseId
        ? [existingData.lastConfirmedPurchaseId]
        : [];
    if (priorIds.includes(confirmedPurchaseId) && String(existingData.productId ?? '') === product.id) {
      return;
    }
  }

  const previousProductId = existing.exists
    ? String(existingData.productId ?? '').trim() || undefined
    : undefined;
  const now = new Date().toISOString();
  const updatedBy = options.updatedBy ?? null;

  await ref.set(
    {
      aliasKey: aliasDocId(raw, supplierId),
      aliasRaw: raw,
      rawExternalDescription: raw,
      normalizedExternalDescription: normalizeExternalDescription(raw),
      tipoLinea: 'stock',
      productId: product.id,
      productName: product.nombre,
      productNameSnapshot: product.nombre,
      supplierId,
      source: options.source ?? 'confirmed_manual_match',
      active: true,
      staleAt: null,
      staleReason: null,
      previousProductId:
        previousProductId && previousProductId !== product.id
          ? previousProductId
          : existingData.previousProductId ?? null,
      createdAt: existingData.createdAt ?? now,
      createdBy: existingData.createdBy ?? updatedBy,
      updatedAt: now,
      updatedBy,
      confirmedAt: now,
      lastConfirmedPurchaseId: confirmedPurchaseId || (existingData.lastConfirmedPurchaseId ?? null),
      lastConfirmedPurchaseIds: confirmedPurchaseId
        ? [
            ...new Set([
              ...(Array.isArray(existingData.lastConfirmedPurchaseIds)
                ? existingData.lastConfirmedPurchaseIds
                : []),
              confirmedPurchaseId,
            ]),
          ].slice(-20)
        : existingData.lastConfirmedPurchaseIds ?? [],
      useCount: Number(existingData.useCount ?? 0),
      lastUsedAt: existingData.lastUsedAt ?? null,
    },
    { merge: true }
  );
}

export async function listSupplierProductMappings(
  businessId: string,
  supplierId?: string | null
): Promise<ProductSupplierMappingRecord[]> {
  const col = db.collection(`negocios/${businessId}/whatsapp_product_aliases`);
  const supplier = String(supplierId ?? '').trim();
  const snap = await col.get();
  const out: ProductSupplierMappingRecord[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as AliasDoc;
    const mappedSupplierId = String(data.supplierId ?? '').trim();
    if (!mappedSupplierId) continue;
    if (supplier && mappedSupplierId !== supplier) continue;
    out.push({
      id: doc.id,
      businessId,
      supplierId: mappedSupplierId,
      rawExternalDescription: String(data.rawExternalDescription ?? data.aliasRaw ?? '').trim(),
      normalizedExternalDescription: String(
        data.normalizedExternalDescription ?? normalizeExternalDescription(data.aliasRaw ?? '')
      ).trim(),
      productId: String(data.productId ?? '').trim(),
      productNameSnapshot: String(data.productNameSnapshot ?? data.productName ?? '').trim() || undefined,
      source:
        data.source === 'confirmed_auto_match' ? 'confirmed_auto_match' : 'confirmed_manual_match',
      active: data.active !== false,
      useCount: Number(data.useCount ?? 0),
      lastUsedAt: data.lastUsedAt ?? null,
      previousProductId: data.previousProductId ?? null,
      createdAt: String(data.createdAt ?? ''),
      updatedAt: String(data.updatedAt ?? ''),
      createdBy: data.createdBy ?? null,
      updatedBy: data.updatedBy ?? null,
      lastConfirmedPurchaseId: data.lastConfirmedPurchaseId ?? null,
    });
  }
  return out;
}

export async function deactivateSupplierProductMapping(
  businessId: string,
  supplierId: string,
  externalDescription: string,
  updatedBy?: string | null
): Promise<void> {
  const ref = aliasRef(businessId, externalDescription, supplierId);
  await ref.set(
    {
      active: false,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy ?? null,
    },
    { merge: true }
  );
}

export async function deleteSupplierProductMapping(
  businessId: string,
  supplierId: string,
  externalDescription: string
): Promise<void> {
  await aliasRef(businessId, externalDescription, supplierId).delete();
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
