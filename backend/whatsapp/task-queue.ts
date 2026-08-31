import type { WhatsappIntent } from './ai-command-parser.ts';
import { looksLikeCashMovement } from './ai-command-parser.ts';
import { looksLikeNewOrder } from './lookups.ts';
import type { QueuedWhatsappTask } from './turn-interpreter.ts';

const DUAL_CONNECTOR =
  /\s+y\s+(?:tambi[eé]n\s+)?(?:anot[aá](?:me)?|registr(?:[aá]|ame)|carg[aá](?:me)?|hac[eé]|sum[aá]|anotame)\s+/i;

export function splitCurrentAndQueued(text: string): { currentText: string; queuedRaw: string } | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const match = raw.match(DUAL_CONNECTOR);
  if (!match || match.index == null || match.index < 1) return null;
  const currentText = raw.slice(0, match.index).trim();
  const queuedRaw = raw.slice(match.index + match[0].length).trim();
  if (!currentText || !queuedRaw) return null;
  return { currentText, queuedRaw };
}

export function guessQueuedIntent(text: string): WhatsappIntent {
  const t = String(text ?? '');
  if (looksLikeCashMovement(t)) return 'register_cash';
  if (/\b(venta|vend[ií]|anot[aá].*venta)\b/i.test(t)) return 'create_sale';
  if (/\b(compra|remito|factura|proveedor)\b/i.test(t)) return 'create_purchase';
  if (looksLikeNewOrder(t) || /\bpedido\b/i.test(t)) return 'create_order';
  if (/\b(cobr|pag[oó]|se[nñ]a)\b/i.test(t)) return 'register_payment';
  if (/\b(saldo|cu[aá]nto\s+debe)\b/i.test(t)) return 'query_balance';
  return 'create_order';
}

export function queuedTaskFromText(text: string): QueuedWhatsappTask {
  return {
    intent: guessQueuedIntent(text),
    entities: { sourceText: text },
    raw: text,
  };
}

/** @deprecated llm_first: no usar. El modelo debe devolver operations[]. Solo engine legacy. */
export function takeDualIntent(text: string): {
  currentText: string;
  queued?: QueuedWhatsappTask;
} {
  const split = splitCurrentAndQueued(text);
  if (!split) return { currentText: text };
  return {
    currentText: split.currentText,
    queued: queuedTaskFromText(split.queuedRaw),
  };
}
