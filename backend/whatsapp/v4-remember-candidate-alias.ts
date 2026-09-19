import type {
  CandidateSelectionAwaiting,
  CandidateSelectionOption,
} from './v4-candidate-selection.ts';
import {
  recordConfirmedLanguageMapping,
  rememberSpokenProductTerms,
} from './language-memory.ts';
import { saveClientAlias, saveSupplierAlias } from './operator-memory.ts';
import { saveProductAlias } from './product-aliases.ts';

function normalizeLoose(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenHintFromAwaiting(awaiting: CandidateSelectionAwaiting): string {
  const args = (awaiting.resume.blockedArgs ?? {}) as Record<string, unknown>;
  const candidates = [
    args.query,
    args.clientQuery,
    args.productQuery,
    args.supplierQuery,
    args.name,
  ]
    .map((row) => String(row ?? '').trim())
    .filter(Boolean);
  // Prefer short lookup hints over the full original utterance.
  const short = candidates.find((row) => row.length <= 48) ?? candidates[0] ?? '';
  if (short) return short;
  const original = String(awaiting.resume.originalUserText ?? '').trim();
  return original.length <= 48 ? original : '';
}

/**
 * Tras elegir 1-N en un menú: guarda alias confirmado (solo si hay hint hablado distinto del label).
 * Bajo riesgo: no inventa; solo persiste confirmaciones explícitas del usuario.
 */
export async function rememberConfirmedCandidateAlias(input: {
  businessId: string;
  phone: string;
  awaiting: CandidateSelectionAwaiting;
  option: CandidateSelectionOption;
}): Promise<void> {
  const spoken = spokenHintFromAwaiting(input.awaiting);
  const label = String(input.option.label ?? '').trim();
  const entityId = String(input.option.entityId ?? '').trim();
  if (!spoken || !label || !entityId) return;

  try {
    if (input.awaiting.entityType === 'client') {
      await saveClientAlias(input.businessId, spoken, { id: entityId, nombre: label });
      await recordConfirmedLanguageMapping({
        businessId: input.businessId,
        phone: input.phone,
        userExpression: spoken,
        resolvedMeaning: label,
        entityType: 'client',
        entityId,
      });
      return;
    }
    if (input.awaiting.entityType === 'product') {
      await rememberSpokenProductTerms({
        businessId: input.businessId,
        phone: input.phone,
        spoken,
        resolvedName: label,
        productId: entityId,
      });
      if (spoken.length >= 2 && normalizeLoose(spoken) !== normalizeLoose(label)) {
        await saveProductAlias(input.businessId, spoken, { id: entityId, nombre: label });
      }
      return;
    }
    if (input.awaiting.entityType === 'supplier') {
      await saveSupplierAlias(input.businessId, spoken, { id: entityId, nombre: label });
      await recordConfirmedLanguageMapping({
        businessId: input.businessId,
        phone: input.phone,
        userExpression: spoken,
        resolvedMeaning: label,
        entityType: 'supplier',
        entityId,
      });
    }
  } catch (error) {
    console.warn('[v4:alias] rememberConfirmedCandidateAlias failed', error);
  }
}
