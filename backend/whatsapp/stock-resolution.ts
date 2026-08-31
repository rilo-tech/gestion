import type { OrderPhysicalStockScope, StockDiscountAsk } from '../utils/order-config.ts';
import { looksLikeExistingOrderQuery, looksLikeStatusQuery } from './lookups.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';

export const STOCK_RESOLUTION_INTENT = 'stock_resolution';

export type StockResolutionAction = 'discount_full_order' | 'discount_reserved' | 'cancel';

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i;

export function isStockResolutionPending(pendingIntent?: string | null): boolean {
  return String(pendingIntent ?? '') === STOCK_RESOLUTION_INTENT;
}

export function formatStockResolutionAsk(ask: StockDiscountAsk): string {
  if (ask.options.length === 1 && ask.options[0] === 'pedido_completo') {
    return waCard({
      title: 'Stock del pedido',
      lines: ['No hay unidades reservadas.'],
      ask: `¿Descuento el stock de todo el pedido? ${waBold('SÍ')} / ${waBold('NO')}`,
    });
  }

  const lines: string[] = [];
  if (ask.reason === 'no_reserved_units') {
    lines.push('No hay unidades reservadas.');
  } else {
    lines.push('Hay que descontar stock del depósito.');
  }
  ask.options.forEach((option, index) => {
    if (option === 'solo_reservado') {
      lines.push(`${index + 1}. Solo lo reservado (${ask.totalReservado} u.)`);
    } else {
      lines.push(`${index + 1}. Todo el pedido (${ask.totalCompleto} u.)`);
    }
  });
  return waCard({
    title: 'Stock del pedido',
    lines,
    ask: '¿Qué hago?',
  });
}

export function splitCompoundStockUtterance(text: string): { head: string; leftover: string } {
  const raw = String(text ?? '').trim();
  const match = raw.match(/^(.*?)\s+y\s+(?:despu[eé]s\s+)?(?:decime\s+)?(.+)$/i);
  if (!match) return { head: raw, leftover: '' };
  const leftover = String(match[2] ?? '').trim();
  if (
    looksLikeExistingOrderQuery(leftover) ||
    looksLikeStatusQuery(leftover) ||
    /^(cu[aá]nto|saldo|estado|resumen)\b/i.test(leftover)
  ) {
    return { head: String(match[1] ?? '').trim(), leftover };
  }
  return { head: raw, leftover: '' };
}

export function scopeFromStockResolution(
  action: StockResolutionAction | null | undefined
): OrderPhysicalStockScope | undefined {
  if (action === 'discount_full_order') return 'pedido_completo';
  if (action === 'discount_reserved') return 'solo_reservado';
  return undefined;
}

export function actionFromStockScope(
  scope: OrderPhysicalStockScope | string | undefined
): StockResolutionAction | undefined {
  if (scope === 'pedido_completo' || scope === 'discount_full_order') return 'discount_full_order';
  if (scope === 'solo_reservado' || scope === 'discount_reserved') return 'discount_reserved';
  if (scope === 'cancel') return 'cancel';
  return undefined;
}

/**
 * Interpreta la respuesta a la pregunta de stock.
 * No cubre cada frase: sí/no/todo/números + señales semánticas (todo/total vs cancelar).
 * Gemini aporta el resto con el awaiting.
 */
export function interpretStockResolutionFromText(
  text: string,
  allowed: OrderPhysicalStockScope[] = ['pedido_completo']
): { action: StockResolutionAction | null; leftover: string } {
  const { head, leftover } = splitCompoundStockUtterance(text);
  const t = head.trim();
  if (!t) return { action: null, leftover };

  if (
    CONFIRM_NO.test(t) ||
    /^(no,?\s*)?(cancel[aá]|dejalo|dejálo|no cambies|como estaba)\b/i.test(t) ||
    /\b(dejalo|dejálo|no cambies nada|como estaba)\b/i.test(t)
  ) {
    return { action: 'cancel', leftover };
  }

  const numbered = t.match(/^(\d{1,2})$/);
  if (numbered) {
    const chosen = allowed[Number(numbered[1]) - 1];
    if (chosen === 'pedido_completo') return { action: 'discount_full_order', leftover };
    if (chosen === 'solo_reservado') return { action: 'discount_reserved', leftover };
  }

  const mentionsReserved = /\breservad/i.test(t);
  const mentionsFull = /\b(todo|total|completo|todas|unidades del pedido)\b/i.test(t);
  const mentionsDiscount = /\bdescont/i.test(t);

  if (mentionsReserved && !mentionsFull && allowed.includes('solo_reservado')) {
    return { action: 'discount_reserved', leftover };
  }
  if (
    (mentionsFull || mentionsDiscount || CONFIRM_YES.test(t) || /^(el total)$/i.test(t)) &&
    allowed.includes('pedido_completo')
  ) {
    return { action: 'discount_full_order', leftover };
  }
  if (CONFIRM_YES.test(t) && allowed.length === 1 && allowed[0] === 'solo_reservado') {
    return { action: 'discount_reserved', leftover };
  }

  return { action: null, leftover };
}

export function parseRequestedStockScope(value: unknown): OrderPhysicalStockScope | undefined {
  const raw = String(value ?? '').trim();
  if (raw === 'solo_reservado' || raw === 'pedido_completo') return raw;
  return scopeFromStockResolution(actionFromStockScope(raw));
}
