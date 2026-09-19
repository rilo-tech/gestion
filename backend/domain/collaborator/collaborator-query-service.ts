import {
  getCollaborator,
  listCollaborators,
  type CollaboratorModalidad,
  type CollaboratorRecord,
} from '../../utils/collaborators.ts';
import type { CollaboratorAccessScope } from '../../utils/collaborator-scope.ts';

export type CollaboratorEntityResult = {
  status: 'resolved' | 'ambiguous' | 'not_found';
  entity?: CollaboratorListItem;
  candidates?: Array<CollaboratorListItem & { score?: number }>;
  query?: string;
  entityType?: 'collaborator';
};

export type CollaboratorListItem = {
  id: string;
  name: string;
  telefono?: string;
  modalidad?: CollaboratorModalidad;
  activo?: boolean;
};

export type CollaboratorListResult = {
  items: CollaboratorListItem[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
  footer?: string;
};

export type CollaboratorDetail = CollaboratorListItem & {
  email?: string;
  notas?: string;
  valorHora?: number;
  montoFijoPeriodo?: number;
  periodoReferencia?: string;
};

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreNameMatch(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 90;
  if (c.includes(q) || q.includes(c)) return 75;
  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  const hits = qTokens.filter((token) => cTokens.some((row) => row.startsWith(token) || token.startsWith(row)));
  if (!hits.length) return 0;
  return Math.round((hits.length / Math.max(qTokens.length, 1)) * 70);
}

function mapRow(row: CollaboratorRecord): CollaboratorListItem {
  return {
    id: row.id,
    name: String(row.nombre ?? '').trim(),
    telefono: String(row.telefono ?? '').trim() || undefined,
    modalidad: row.modalidad,
    activo: row.activo !== false,
  };
}

function mapDetail(row: CollaboratorRecord): CollaboratorDetail {
  return {
    ...mapRow(row),
    email: String(row.email ?? '').trim() || undefined,
    notas: String(row.notas ?? '').trim() || undefined,
    valorHora: row.valorHora,
    montoFijoPeriodo: row.montoFijoPeriodo,
    periodoReferencia: row.periodoReferencia,
  };
}

function scopeAllows(scope: CollaboratorAccessScope | undefined, colaboradorId: string): boolean {
  if (!scope || scope.mode === 'all') return true;
  return scope.colaboradorId === colaboradorId;
}

function applyScope(rows: CollaboratorRecord[], scope?: CollaboratorAccessScope): CollaboratorRecord[] {
  if (!scope || scope.mode === 'all') return rows;
  return rows.filter((row) => row.id === scope.colaboradorId);
}

export async function findCollaborator(
  businessId: string,
  query: string,
  options?: { scope?: CollaboratorAccessScope }
): Promise<CollaboratorEntityResult> {
  const hint = String(query ?? '').trim();
  if (!hint) return { status: 'not_found', query: '', entityType: 'collaborator' };

  const all = applyScope(await listCollaborators(businessId), options?.scope);
  const matches = all
    .map((row) => ({ row, score: scoreNameMatch(hint, row.nombre) }))
    .filter((entry) => entry.score >= 50)
    .sort((a, b) => b.score - a.score || a.row.nombre.localeCompare(b.row.nombre, 'es'));

  if (!matches.length) return { status: 'not_found', query: hint, entityType: 'collaborator' };

  if (matches.length === 1) {
    return { status: 'resolved', entity: mapRow(matches[0]!.row), query: hint, entityType: 'collaborator' };
  }

  const top = matches[0]!;
  const close = matches.filter((entry) => entry.score >= Math.max(50, top.score - 20));
  const pool = close.length ? close : matches;

  if (pool.length === 1) {
    return { status: 'resolved', entity: mapRow(pool[0]!.row), query: hint, entityType: 'collaborator' };
  }

  return {
    status: 'ambiguous',
    query: hint,
    entityType: 'collaborator',
    candidates: pool.slice(0, 8).map((entry) => ({
      ...mapRow(entry.row),
      score: entry.score,
    })),
  };
}

export async function getCollaboratorEntity(
  businessId: string,
  colaboradorId: string,
  options?: { scope?: CollaboratorAccessScope }
): Promise<CollaboratorDetail | null> {
  const id = String(colaboradorId ?? '').trim();
  if (!id || !scopeAllows(options?.scope, id)) return null;
  const row = await getCollaborator(businessId, id);
  if (!row) return null;
  return mapDetail(row);
}

export async function listCollaboratorEntities(
  businessId: string,
  input?: {
    query?: string;
    active?: boolean | null;
    modalidad?: CollaboratorModalidad | null;
    limit?: number;
    offset?: number;
    scope?: CollaboratorAccessScope;
  }
): Promise<CollaboratorListResult> {
  const limit = Math.min(100, Math.max(1, Number(input?.limit) || 10));
  const offset = Math.max(0, Number(input?.offset) || 0);
  const search = String(input?.query ?? '').trim();

  let rows = applyScope(await listCollaborators(businessId), input?.scope);

  if (input?.active === true) rows = rows.filter((row) => row.activo !== false);
  if (input?.active === false) rows = rows.filter((row) => row.activo === false);
  if (input?.modalidad) rows = rows.filter((row) => row.modalidad === input.modalidad);

  if (search) {
    rows = rows
      .map((row) => ({ row, score: scoreNameMatch(search, row.nombre) }))
      .filter((entry) => entry.score >= 50)
      .sort((a, b) => b.score - a.score || a.row.nombre.localeCompare(b.row.nombre, 'es'))
      .map((entry) => entry.row);
  }

  const total = rows.length;
  const sliced = rows.slice(offset, offset + limit);
  const hasMore = total > offset + limit;

  return {
    items: sliced.map(mapRow),
    total,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
  };
}
