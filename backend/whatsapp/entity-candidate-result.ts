/**
 * Regla V4 unificada para resolución de entidades por candidatos:
 * 0 → not_found | 1 → resolved | 2+ → ambiguous
 */

export type NormalizedCandidateResult<T> =
  | { status: 'not_found' }
  | { status: 'resolved'; entity: T }
  | { status: 'ambiguous'; candidates: T[] };

export function candidateEntityId(item: unknown): string {
  const row = item as Record<string, unknown>;
  return String(row.id ?? row.entityId ?? row.clientId ?? row.productId ?? '').trim();
}

/** Dedupe por id y aplica regla 0 / 1 / 2+. */
export function normalizeCandidateResult<T>(
  candidates: T[],
  options?: { getId?: (item: T) => string }
): NormalizedCandidateResult<T> {
  const getId = options?.getId ?? ((item: T) => candidateEntityId(item));
  const deduped: T[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(item);
  }
  if (deduped.length === 0) return { status: 'not_found' };
  if (deduped.length === 1) return { status: 'resolved', entity: deduped[0]! };
  return { status: 'ambiguous', candidates: deduped };
}

export function isRealCandidateAmbiguity(candidates: unknown[]): boolean {
  return normalizeCandidateResult(candidates).status === 'ambiguous';
}
