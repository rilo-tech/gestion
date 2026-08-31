import { db } from '../../firebase.ts';
import {
  findClientsByName,
  resolveClientMatch,
  type MatchedClient,
} from '../../whatsapp/lookups.ts';

export type ClientEntityResult = {
  status: 'resolved' | 'ambiguous' | 'not_found';
  entity?: { id: string; name: string; telefono?: string };
  candidates?: Array<{ id: string; name: string; score?: number }>;
  query?: string;
};

export type ClientListResult = {
  items: Array<{ id: string; name: string; telefono?: string }>;
  total: number;
  hasMore: boolean;
  nextCursor?: string;
};

function mapClient(doc: { id: string; data: () => Record<string, unknown> }): {
  id: string;
  name: string;
  telefono?: string;
} {
  const data = doc.data() as { nombre?: string; telefono?: string; activo?: boolean };
  return {
    id: doc.id,
    name: String(data.nombre ?? '').trim(),
    telefono: String(data.telefono ?? '').trim() || undefined,
  };
}

export async function findClient(
  businessId: string,
  query: string,
  options?: { utterance?: string }
): Promise<ClientEntityResult> {
  const hint = String(query ?? '').trim();
  if (!hint) return { status: 'not_found', query: '' };
  const resolved = await resolveClientMatch(businessId, hint, { utterance: options?.utterance ?? hint });
  if (resolved.status === 'unique') {
    return {
      status: 'resolved',
      entity: { id: resolved.client.id, name: resolved.client.nombre },
      query: hint,
    };
  }
  if (resolved.status === 'none') {
    return { status: 'not_found', query: hint };
  }
  return {
    status: 'ambiguous',
    query: hint,
    candidates: resolved.candidates.map((row: MatchedClient) => ({
      id: row.id,
      name: row.nombre,
      score: row.score,
    })),
  };
}

export async function getClient(
  businessId: string,
  clientId: string
): Promise<{ id: string; name: string; telefono?: string } | null> {
  const id = String(clientId ?? '').trim();
  if (!id) return null;
  const snap = await db.doc(`negocios/${businessId}/clientes/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as { nombre?: string; telefono?: string; activo?: boolean };
  if (data.activo === false) return null;
  return {
    id: snap.id,
    name: String(data.nombre ?? '').trim(),
    telefono: String(data.telefono ?? '').trim() || undefined,
  };
}

export async function listClients(
  businessId: string,
  input?: { query?: string; limit?: number; offset?: number }
): Promise<ClientListResult> {
  const limit = Math.min(100, Math.max(1, Number(input?.limit) || 10));
  const offset = Math.max(0, Number(input?.offset) || 0);
  const search = String(input?.query ?? '').trim();

  if (search) {
    const matches = await findClientsByName(businessId, search, { limit: limit + offset + 1 });
    const sliced = matches.slice(offset, offset + limit);
    return {
      items: sliced.map((row) => ({ id: row.id, name: row.nombre })),
      total: matches.length,
      hasMore: matches.length > offset + limit,
    };
  }

  const snap = await db
    .collection(`negocios/${businessId}/clientes`)
    .orderBy('nombre')
    .offset(offset)
    .limit(limit + 1)
    .get();
  const active = snap.docs.filter((doc) => (doc.data() as { activo?: boolean }).activo !== false);
  const hasMore = active.length > limit;
  const items = active.slice(0, limit).map(mapClient);
  return { items, total: items.length + offset + (hasMore ? 1 : 0), hasMore };
}
