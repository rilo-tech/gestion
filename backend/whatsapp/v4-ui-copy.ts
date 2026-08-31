import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';
import type { CandidateSelectionEntityType } from './v4-candidate-selection.ts';

/** Cierre estándar para toda confirmación V4 con OperationPlan congelado. */
export const V4_CONFIRMATION_PROMPT = '¿Confirmo? Sí / No';

/** Cierre estándar para toda selección numerada V4 (candidate_selection). */
export const V4_CANDIDATE_SELECTION_PROMPT = 'Respondeme con el número de la opción.';

const ENTITY_SELECTION_TITLES: Record<CandidateSelectionEntityType, string> = {
  client: 'Encontré más de un cliente',
  product: 'Encontré varias opciones',
  supplier: 'Encontré más de un proveedor',
  order: 'Encontré varios pedidos',
};

export function formatV4Confirmation(input: { title?: string; lines?: string[] }): string {
  return formatWhatsappMessage({
    title: input.title,
    lines: input.lines,
    ask: V4_CONFIRMATION_PROMPT,
  });
}

export function formatV4CandidateSelection(input: {
  entityType: CandidateSelectionEntityType;
  numberedLines: string[];
  title?: string;
}): string {
  return formatWhatsappMessage({
    title: input.title ?? candidateSelectionTitle(input.entityType),
    lines: input.numberedLines,
    ask: V4_CANDIDATE_SELECTION_PROMPT,
  });
}

export function formatV4InvalidCandidateSelection(max: number): string {
  return `Esa opción no está en la lista. Respondeme con un número del 1 al ${max}.`;
}

export function candidateSelectionTitle(entityType: CandidateSelectionEntityType): string {
  return ENTITY_SELECTION_TITLES[entityType] ?? 'Encontré más de una opción';
}

/** @deprecated Use V4_CANDIDATE_SELECTION_PROMPT */
export const CANDIDATE_SELECTION_PROMPT = V4_CANDIDATE_SELECTION_PROMPT;
