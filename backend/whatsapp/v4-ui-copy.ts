import { formatWhatsappMessage, waBold } from '../../shared/whatsapp-format.ts';
import type { CandidateSelectionEntityType } from './v4-candidate-selection.ts';

/** Cierre estándar para toda confirmación V4 con OperationPlan congelado. */
export const V4_CONFIRMATION_PROMPT = `¿Confirmo? ${waBold('Sí')} / ${waBold('No')}`;

/** Tras un «No» suave: el plan sigue pendiente y el usuario puede enmendar. */
export const V4_CONFIRM_EDIT_PROMPT =
  'Dale. ¿Qué querés cambiar? Decime el monto, el concepto, la caja u otra cosa.';

/** Cierre tras auto-commit (horas/extras): no pide Sí/No. */
export { V4_AUTO_COMMIT_MODIFY_PROMPT } from './v4-auto-commit.ts';

/** Cierre estándar para selección de productos en compra por imagen. */
export const V4_PRODUCT_CANDIDATE_ASK =
  'Si no es ninguno, indicame el nombre con el que está guardado y te muestro similares.';

/** Cierre estándar para toda selección numerada V4 (candidate_selection). */
export const V4_CANDIDATE_SELECTION_PROMPT =
  'Indicame qué ítem querés usar, escribime el nombre, o qué querés hacer.';

const ENTITY_SELECTION_TITLES: Record<CandidateSelectionEntityType, string> = {
  client: '👥 Clientes encontrados',
  product: '📦 Productos encontrados',
  supplier: '🚚 Proveedores encontrados',
  order: '📋 Pedidos encontrados',
  cash_account: '💰 ¿En qué caja?',
  collaborator: '👷 Colaboradores',
  payment: '💳 Forma de pago',
  work_log: '👷 Registros de horas',
};

export function formatV4Confirmation(input: { title?: string; lines?: string[] }): string {
  const lines = input.lines ?? [];
  const numberedConfirm = lines.some((row) => /confirmar compra/i.test(row));
  return formatWhatsappMessage({
    title: input.title,
    lines,
    // Opciones 1/0 ya bastan; no reusar el ask de matching de productos.
    ask: numberedConfirm ? undefined : V4_CONFIRMATION_PROMPT,
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
  return `Opción inválida. Indicá un número del 1 al ${max}, o decime qué querés hacer.`;
}

export function candidateSelectionTitle(entityType: CandidateSelectionEntityType): string {
  return ENTITY_SELECTION_TITLES[entityType] ?? 'Encontré varias opciones';
}

/** @deprecated Use V4_CANDIDATE_SELECTION_PROMPT */
export const CANDIDATE_SELECTION_PROMPT = V4_CANDIDATE_SELECTION_PROMPT;
