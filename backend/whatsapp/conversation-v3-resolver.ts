import { resolveClientMatch } from './lookups.ts';
import type { QueryPlan } from './conversation-query-plan.ts';

export type ClientResolverFn = (businessId: string, hint: string) => Promise<ClientResolution>;

export type ClientResolution =
  | { status: 'RESOLVED'; id: string; displayName: string }
  | { status: 'AMBIGUOUS'; candidates: Array<{ id: string; displayName: string; score?: number }> }
  | { status: 'NOT_FOUND'; hint: string }
  | { status: 'NONE' };

export async function resolveQueryClient(
  businessId: string,
  hint: string
): Promise<ClientResolution> {
  const query = String(hint ?? '').trim();
  if (!query) return { status: 'NONE' };
  const resolved = await resolveClientMatch(businessId, query, { utterance: query });
  const candidates =
    resolved.status === 'unique'
      ? [{ id: resolved.client.id, displayName: resolved.client.nombre, score: resolved.client.score }]
      : resolved.status === 'ambiguous'
        ? resolved.candidates.map((row) => ({
            id: row.id,
            displayName: row.nombre,
            score: row.score,
          }))
        : [];
  console.info(
    '[whatsapp:v3:resolver:client]',
    JSON.stringify({
      query,
      status: resolved.status,
      candidates,
      selected:
        resolved.status === 'unique'
          ? { id: resolved.client.id, displayName: resolved.client.nombre }
          : null,
    })
  );
  if (resolved.status === 'unique') {
    return { status: 'RESOLVED', id: resolved.client.id, displayName: resolved.client.nombre };
  }
  if (resolved.status === 'ambiguous') {
    return { status: 'AMBIGUOUS', candidates };
  }
  return { status: 'NOT_FOUND', hint: query };
}

export async function applyClientResolution(
  businessId: string,
  plan: QueryPlan,
  resolve: ClientResolverFn = resolveQueryClient
): Promise<QueryPlan> {
  if (!plan.requestedFilters.client) return plan;
  const hint = String(plan.filters.clientHint ?? '').trim();
  if (!hint) {
    return { ...plan, invalid: 'QUERY_PLAN_INVALID' };
  }
  const resolved = await resolve(businessId, hint);
  if (resolved.status === 'RESOLVED') {
    return {
      ...plan,
      filters: {
        ...plan.filters,
        clientId: resolved.id,
        clientHint: resolved.displayName || hint,
      },
    };
  }
  if (resolved.status === 'AMBIGUOUS') {
    return {
      ...plan,
      invalid: 'AMBIGUOUS_ENTITY',
      invalidHint: hint,
      ambiguousNames: resolved.candidates.map((row) => row.displayName),
    };
  }
  return { ...plan, invalid: 'ENTITY_NOT_FOUND', invalidHint: hint };
}
