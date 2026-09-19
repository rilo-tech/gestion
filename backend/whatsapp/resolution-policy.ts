/**
 * Política transversal V4: resolver automáticamente antes de preguntar.
 *
 * Prioridad:
 * 1. explicit (turno actual)
 * 2. entity_config (config específica de entidad — vía caller)
 * 3. business_default
 * 4. mapping (vía caller)
 * 5. context (conversación estructurada)
 * 6. single_candidate
 * 7. ask
 */
import { normalizeCandidateResult } from './entity-candidate-result.ts';

export type ResolutionSource =
  | 'explicit'
  | 'entity_config'
  | 'business_default'
  | 'mapping'
  | 'context'
  | 'single_candidate';

export type ResolutionOutcome<T> =
  | { action: 'resolved'; value: T; source: ResolutionSource }
  | { action: 'ask'; field: string; reason: string; candidates: T[] }
  | { action: 'not_found'; field: string; hint?: string };

export function logAutoResolve(
  field: string,
  source: ResolutionSource,
  detail?: Record<string, unknown>
): void {
  console.info('[v4:auto-resolve]', JSON.stringify({ field, source, ...(detail ?? {}) }));
}

export function logAskRequired(missingField: string, reason: string, detail?: Record<string, unknown>): void {
  console.info('[v4:ask-required]', JSON.stringify({ missingField, reason, ...(detail ?? {}) }));
}

export type ResolveCandidatesInput<T> = {
  field: string;
  candidates: T[];
  getId: (item: T) => string;
  /** Valor explícito del turno actual (prioridad máxima). */
  explicitId?: string | null;
  /** Config específica de entidad (ej. supplier default account). */
  entityConfigId?: string | null;
  /** Default operativo del negocio (BusinessProfile.defaults). */
  businessDefaultId?: string | null;
  /** Contexto conversacional válido (focusEntities, draft previo). */
  contextId?: string | null;
  /** Workflows que exigen confirmación manual aunque haya 1 candidato. */
  requireManualConfirm?: boolean;
};

function findById<T>(candidates: T[], id: string | null | undefined, getId: (item: T) => string): T | null {
  const normalized = String(id ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return candidates.find((row) => getId(row).trim().toLowerCase() === normalized) ?? null;
}

/** Resuelve un campo contra candidatos ERP respetando la política de simplicidad. */
export function resolveCandidatesWithPolicy<T>(input: ResolveCandidatesInput<T>): ResolutionOutcome<T> {
  const candidates = input.candidates.filter(Boolean);
  const getId = input.getId;

  const explicit = findById(candidates, input.explicitId, getId);
  if (explicit) {
    logAutoResolve(input.field, 'explicit', { id: getId(explicit) });
    return { action: 'resolved', value: explicit, source: 'explicit' };
  }

  const entity = findById(candidates, input.entityConfigId, getId);
  if (entity) {
    logAutoResolve(input.field, 'entity_config', { id: getId(entity) });
    return { action: 'resolved', value: entity, source: 'entity_config' };
  }

  const businessDefault = findById(candidates, input.businessDefaultId, getId);
  if (businessDefault) {
    logAutoResolve(input.field, 'business_default', { id: getId(businessDefault) });
    return { action: 'resolved', value: businessDefault, source: 'business_default' };
  }

  const context = findById(candidates, input.contextId, getId);
  if (context) {
    logAutoResolve(input.field, 'context', { id: getId(context) });
    return { action: 'resolved', value: context, source: 'context' };
  }

  const normalized = normalizeCandidateResult(candidates, { getId });
  if (normalized.status === 'resolved' && !input.requireManualConfirm) {
    logAutoResolve(input.field, 'single_candidate', { id: getId(normalized.entity) });
    return { action: 'resolved', value: normalized.entity, source: 'single_candidate' };
  }
  if (normalized.status === 'ambiguous') {
    logAskRequired(input.field, 'multiple_candidates', { count: normalized.candidates.length });
    return {
      action: 'ask',
      field: input.field,
      reason: 'multiple_candidates',
      candidates: normalized.candidates,
    };
  }

  return { action: 'not_found', field: input.field };
}

/** Campos faltantes obligatorios tras auto-resolución. */
export function requiredMissingFields(fields: Array<{ name: string; satisfied: boolean }>): string[] {
  return fields.filter((row) => !row.satisfied).map((row) => row.name);
}
