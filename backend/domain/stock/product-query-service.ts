import { db } from '../../firebase.ts';
import { resolveProductMatch } from '../../whatsapp/lookups.ts';
import { finalizeEntityLookupResult } from '../entity-lookup-result.ts';

export type ProductEntityResult = {
  status: 'resolved' | 'ambiguous' | 'not_found' | 'family_variant_missing';
  entity?: { id: string; name: string; price?: number; cost?: number; stock?: number };
  candidates?: Array<{ id: string; name: string; score?: number }>;
  query?: string;
  missingVariant?: string;
  familyLabel?: string;
  matchKind?: string;
};

export type ProductListResult = {
  items: Array<{ id: string; name: string; price?: number; stock?: number }>;
  total: number;
  hasMore: boolean;
};

function mapProduct(doc: { id: string; data: () => Record<string, unknown> }) {
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    name: String(data.nombre ?? '').trim(),
    price: Number(data.precioVenta ?? data.precio) || 0,
    stock: Number(data.stockActual) || 0,
  };
}

export async function findProduct(
  businessId: string,
  query: string,
  options?: {
    utterance?: string;
    attributes?: { type?: string | null; fabric?: string | null; color?: string | null; size?: string | null };
    preferChoices?: boolean;
  }
): Promise<ProductEntityResult> {
  const hint = String(query ?? '').trim();
  if (!hint) return { status: 'not_found', query: '' };
  const resolved = await resolveProductMatch(businessId, hint, {
    utterance: options?.utterance ?? hint,
    attributes: options?.attributes,
    preferChoices: options?.preferChoices,
  });
  const ambiguousPool =
    resolved.status === 'ambiguous'
      ? [...resolved.candidates, ...(resolved.rest ?? [])]
      : [];
  if (resolved.status === 'ambiguous' && resolved.matchKind === 'FAMILY_MATCH_VARIANT_MISSING') {
    return {
      status: 'family_variant_missing',
      query: hint,
      candidates: ambiguousPool.map((row) => ({
        id: row.id,
        name: row.nombre,
        score: row.score,
      })),
      missingVariant: resolved.missingVariant,
      familyLabel: resolved.familyLabel,
      matchKind: resolved.matchKind,
    };
  }
  const mapped = finalizeEntityLookupResult({
    query: hint,
    unique: resolved.status === 'unique' ? resolved.product : null,
    none: resolved.status === 'none',
    ambiguousCandidates: ambiguousPool,
    toEntity: (row) => ({
      id: row.id,
      name: row.nombre,
      price: row.precioVenta,
      cost: row.costo,
    }),
    getId: (row) => row.id,
  });
  if (mapped.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      query: hint,
      candidates: mapped.candidates!.map((row) => ({
        id: row.id,
        name: row.nombre,
        score: row.score,
      })),
      matchKind: resolved.status === 'ambiguous' ? resolved.matchKind : 'AMBIGUOUS',
    };
  }
  return mapped;
}

export async function getProduct(
  businessId: string,
  productId: string
): Promise<{ id: string; name: string; price?: number; cost?: number; stock?: number; controlsStock?: boolean } | null> {
  const id = String(productId ?? '').trim();
  if (!id) return null;
  const snap = await db.doc(`negocios/${businessId}/stock/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.activo === false) return null;
  return {
    id: snap.id,
    name: String(data.nombre ?? '').trim(),
    price: Number(data.precioVenta ?? data.precio) || 0,
    cost: Number(data.costo) || 0,
    stock: Number(data.stockActual) || 0,
    controlsStock: data.controlaStock !== false,
  };
}

export async function listProducts(
  businessId: string,
  input?: { query?: string; limit?: number; offset?: number }
): Promise<ProductListResult> {
  const limit = Math.min(100, Math.max(1, Number(input?.limit) || 10));
  const offset = Math.max(0, Number(input?.offset) || 0);
  const search = String(input?.query ?? '').trim().toLowerCase();
  const snap = await db.collection(`negocios/${businessId}/stock`).orderBy('nombre').get();
  const rows = snap.docs
    .filter((doc) => (doc.data() as { activo?: boolean }).activo !== false)
    .map(mapProduct)
    .filter((row) => {
      if (!search) return true;
      return row.name.toLowerCase().includes(search);
    });
  const sliced = rows.slice(offset, offset + limit);
  return {
    items: sliced,
    total: rows.length,
    hasMore: rows.length > offset + limit,
  };
}

export async function getProductStock(
  businessId: string,
  productId: string
): Promise<{ productId: string; name: string; stock: number } | null> {
  const product = await getProduct(businessId, productId);
  if (!product) return null;
  return { productId: product.id, name: product.name, stock: product.stock ?? 0 };
}
