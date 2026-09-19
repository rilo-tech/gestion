/**
 * Dataset de frases humanas para QA de Bot (sin writes reales).
 * Se evalúa contra reglas/heurísticas de intención — LOCAL VERIFIED.
 */

export type BotPhraseCase = {
  id: string;
  utterance: string;
  expectedIntentFamily:
    | 'sale'
    | 'order'
    | 'payment'
    | 'cash'
    | 'query'
    | 'status'
    | 'ambiguous'
    | 'typo_tolerable';
  notes?: string;
};

export const BOT_HUMAN_PHRASES: BotPhraseCase[] = [
  { id: 'sale-1', utterance: 'vendí dos', expectedIntentFamily: 'sale' },
  { id: 'pay-1', utterance: 'me dejó mil', expectedIntentFamily: 'payment' },
  { id: 'pay-2', utterance: 'me transfirió', expectedIntentFamily: 'payment' },
  { id: 'order-1', utterance: 'anotá un pedido', expectedIntentFamily: 'order' },
  { id: 'status-1', utterance: 'el de Ana ya está', expectedIntentFamily: 'status' },
  { id: 'cash-1', utterance: 'pagué la luz', expectedIntentFamily: 'cash' },
  { id: 'query-1', utterance: 'qué tengo pendiente', expectedIntentFamily: 'query' },
  { id: 'query-2', utterance: 'cuánto me deben', expectedIntentFamily: 'query' },
  { id: 'query-3', utterance: 'qué tengo para hoy', expectedIntentFamily: 'query' },
  { id: 'typo-1', utterance: 'vendi', expectedIntentFamily: 'typo_tolerable' },
  { id: 'typo-2', utterance: 'trasnferencia', expectedIntentFamily: 'typo_tolerable' },
  { id: 'typo-3', utterance: 'peddio', expectedIntentFamily: 'typo_tolerable' },
  { id: 'typo-4', utterance: 'pague ute', expectedIntentFamily: 'typo_tolerable' },
  { id: 'typo-5', utterance: 'cuanto me deve ana', expectedIntentFamily: 'typo_tolerable' },
  { id: 'amb-1', utterance: 'pagué 500', expectedIntentFamily: 'ambiguous', notes: 'Debe pedir contexto' },
  {
    id: 'rich-1',
    utterance: 'Venta a Ana de Producto A $1000, pagó todo por transferencia.',
    expectedIntentFamily: 'sale',
    notes: 'No sobrepreguntar',
  },
];

/** Clasificación liviana sin LLM (smoke LOCAL). No es el Agent V4. */
export function classifyPhraseFamily(utterance: string): BotPhraseCase['expectedIntentFamily'] {
  const t = utterance
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/^pague?\s*500$/.test(t.trim()) || t.trim() === 'pague 500' || t.trim() === 'pagué 500') {
    return 'ambiguous';
  }
  if (/cuanto|cuánto|que tengo|qué tengo|pendiente|deben|hoy/.test(t)) return 'query';
  if (/pedido|peddio|anota|anotá/.test(t)) return 'order';
  if (/vendi|vendí|venta/.test(t)) return 'sale';
  if (/transf|dejo|dejó|cobr|pago|pagó|pague/.test(t) && /ana|cliente|pedido/.test(t)) return 'payment';
  if (/luz|ute|caja|gaste|gasté|pague ute|pagué la/.test(t)) return 'cash';
  if (/ya esta|ya está|listo|entregado|en proceso/.test(t)) return 'status';
  if (/transf|dejo|dejó|me pago|me pagó|cobr/.test(t)) return 'payment';
  if (/vendi|peddio|trasnferencia|deve|pague/.test(t)) return 'typo_tolerable';
  return 'ambiguous';
}
