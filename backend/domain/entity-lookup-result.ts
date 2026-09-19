import type { NormalizedCandidateResult } from '../whatsapp/entity-candidate-result.ts';
import { normalizeCandidateResult } from '../whatsapp/entity-candidate-result.ts';

type EntityLookupResult<TEntity, TCandidate> = {
  status: 'resolved' | 'ambiguous' | 'not_found';
  entity?: TEntity;
  candidates?: TCandidate[];
  query?: string;
};

/** Aplica regla 0/1/2+ sobre el resultado de un resolver de lookups. */
export function finalizeEntityLookupResult<TEntity, TCandidate>(input: {
  query: string;
  unique?: TCandidate | null;
  none?: boolean;
  ambiguousCandidates?: TCandidate[];
  toEntity: (candidate: TCandidate) => TEntity;
  getId?: (candidate: TCandidate) => string;
}): EntityLookupResult<TEntity, TCandidate> {
  if (input.unique) {
    return { status: 'resolved', entity: input.toEntity(input.unique), query: input.query };
  }
  if (input.none) return { status: 'not_found', query: input.query };

  const normalized: NormalizedCandidateResult<TCandidate> = normalizeCandidateResult(
    input.ambiguousCandidates ?? [],
    input.getId ? { getId: input.getId } : undefined
  );
  if (normalized.status === 'not_found') return { status: 'not_found', query: input.query };
  if (normalized.status === 'resolved') {
    return { status: 'resolved', entity: input.toEntity(normalized.entity), query: input.query };
  }
  return { status: 'ambiguous', candidates: normalized.candidates, query: input.query };
}

export { normalizeCandidateResult, isRealCandidateAmbiguity } from '../whatsapp/entity-candidate-result.ts';
