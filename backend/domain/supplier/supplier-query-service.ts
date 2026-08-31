import { db } from '../../firebase.ts';
import { findSuppliersByName, resolveSupplierMatch } from '../../whatsapp/lookups.ts';

export type SupplierEntityResult = {
  status: 'resolved' | 'ambiguous' | 'not_found';
  entity?: { id: string; name: string };
  candidates?: Array<{ id: string; name: string; score?: number }>;
  query?: string;
};

export type SupplierListResult = {
  items: Array<{ id: string; name: string }>;
  total: number;
  hasMore: boolean;
};

export async function findSupplier(businessId: string, query: string): Promise<SupplierEntityResult> {
  const hint = String(query ?? '').trim();
  if (!hint) return { status: 'not_found', query: '' };
  const resolved = await resolveSupplierMatch(businessId, hint);
  if (resolved.status === 'unique') {
    return { status: 'resolved', entity: { id: resolved.supplier.id, name: resolved.supplier.nombre }, query: hint };
  }
  if (resolved.status === 'none') return { status: 'not_found', query: hint };
  return {
    status: 'ambiguous',
    query: hint,
    candidates: resolved.candidates.map((row) => ({ id: row.id, name: row.nombre, score: row.score })),
  };
}

export async function getSupplier(
  businessId: string,
  supplierId: string
): Promise<{ id: string; name: string } | null> {
  const id = String(supplierId ?? '').trim();
  if (!id) return null;
  const snap = await db.doc(`negocios/${businessId}/proveedores/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { nombre?: string; activo?: boolean };
  if (data.activo === false) return null;
  return { id: snap.id, name: String(data.nombre ?? '').trim() };
}

export async function listSuppliers(
  businessId: string,
  input?: { query?: string; limit?: number; offset?: number }
): Promise<SupplierListResult> {
  const limit = Math.min(100, Math.max(1, Number(input?.limit) || 10));
  const offset = Math.max(0, Number(input?.offset) || 0);
  const search = String(input?.query ?? '').trim();
  if (search) {
    const matches = await findSuppliersByName(businessId, search, { limit: limit + offset + 1 });
    const sliced = matches.slice(offset, offset + limit);
    return {
      items: sliced.map((row) => ({ id: row.id, name: row.nombre })),
      total: matches.length,
      hasMore: matches.length > offset + limit,
    };
  }
  const snap = await db
    .collection(`negocios/${businessId}/proveedores`)
    .orderBy('nombre')
    .offset(offset)
    .limit(limit + 1)
    .get();
  const active = snap.docs.filter((doc) => (doc.data() as { activo?: boolean }).activo !== false);
  const hasMore = active.length > limit;
  const items = active.slice(0, limit).map((doc) => ({
    id: doc.id,
    name: String((doc.data() as { nombre?: string }).nombre ?? '').trim(),
  }));
  return { items, total: items.length + offset + (hasMore ? 1 : 0), hasMore };
}
