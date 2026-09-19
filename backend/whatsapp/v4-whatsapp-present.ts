/**
 * Presentación saliente V4 → Meta WhatsApp.
 *
 * Flujo obligatorio:
 *   tool/agent reply → presenters (opcional) → formatWhatsappOutbound → splitWaBubbles → Meta
 */
import {
  formatWhatsappOutbound,
  splitWaBubbles,
} from '../../shared/whatsapp-format.ts';
import {
  ensureSingleListAsk,
  detectListAskEntity,
} from '../../shared/whatsapp-visual.ts';
import type { WhatsappHandlerResult } from './message-handler.ts';

/** Normaliza un bloque de texto antes de enviarlo a Meta. */
export function presentV4WhatsappText(text: string): string {
  const formatted = formatWhatsappOutbound(text);
  return appendListAskIfNumberedResults(formatted);
}

/**
 * Listados numerados de entidades (1. 2. 3.) siempre cierran con UNA sola invitación.
 */
export function appendListAskIfNumberedResults(text: string): string {
  const raw = String(text ?? '').trim();
  if (!raw) return raw;
  const numbered = raw.match(/^\s*\d+\.\s+\S/gm);
  if (!numbered || numbered.length < 2) return raw;
  if (/¿Confirmo\?|saldar todo|cobrar un monto|dejar con saldo/i.test(raw)) return raw;
  if (/Confirmar compra|Cancelar compra/i.test(raw)) return raw;
  if (/^✅\s*(?:Listo|Compra registrada)/i.test(raw) || /renombr[eé] los?\s+\d+/i.test(raw)) return raw;
  return ensureSingleListAsk(raw, detectListAskEntity(raw));
}

export function formatWhatsappOutboundPages(reply: string, replies?: string[]): string[] {
  if (replies?.length) {
    return replies
      .map((page) => formatWhatsappOutbound(String(page ?? '')))
      .filter(Boolean);
  }
  const formatted = formatWhatsappOutbound(String(reply ?? ''));
  if (!formatted) return [];
  const bubbles = splitWaBubbles(formatted);
  return bubbles.map((page) => formatWhatsappOutbound(page)).filter(Boolean);
}

export function presentV4WhatsappHandlerResult(
  result: WhatsappHandlerResult,
  extraPages: string[] = []
): WhatsappHandlerResult {
  if (!result.reply && !result.replies?.length && !extraPages.length) return result;

  const pages = [
    ...formatWhatsappOutboundPages(result.reply ?? '', result.replies),
    ...extraPages.map((page) => formatWhatsappOutbound(page)).filter(Boolean),
  ];

  if (!pages.length) return result;

  return {
    ...result,
    reply: pages[0]!,
    replies: pages.length > 1 ? pages : undefined,
  };
}

export { formatWhatsappOutbound };
export const presentV4WhatsappMessage = presentV4WhatsappText;
