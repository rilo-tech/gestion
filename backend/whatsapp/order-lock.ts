import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { extractOrderNumberFromText, extractQueryClientFromText, personNamesLookRelated } from './lookups.ts';

export type LockedOrderEntity = {
  kind: 'order';
  id: string;
  label?: string;
  clientName?: string;
  resolved: true;
  active: true;
};

function foldOrderLabel(value: string): string {
  return String(value ?? '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

const DEMONSTRATIVE = /^(este|esta|esto|ese|esa|eso)$/i;
const NOT_A_CLIENT =
  /^(estado|entregad[oa]|listo|pendiente|producci[oó]n|proceso|pedido|hoy|mañana|pone|pon[eé]|ponelo|move|movelo|pasalo|marcalo|dejalo|cambialo|cambiale|ahora)$/i;

function looksLikeExplicitSearch(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^(ese|esta|esto|eso|este)\b/i.test(t) && /\b(ponelo|cambialo|saldalo|entregad|cobra)/i.test(t)) {
    return false;
  }
  return /(?<![\p{L}])(busc(?:ame|[áa]|ar)|mostr(?:ame|[áa])|list(?:ame|[áa]))\s+(?:el\s+|los\s+|la\s+|un\s+)?pedidos?(?![\p{L}])/iu.test(
    t
  );
}

/** El dueño pidió OTRO pedido (número distinto o cliente distinto), no el que está bloqueado. */
export function isExplicitOrderSwitch(
  text: string,
  entities: WhatsappCommandEntities,
  locked: LockedOrderEntity
): boolean {
  const spokenNumber =
    foldOrderLabel(String(entities.orderNumber ?? entities.targetOrderLabel ?? '')) ||
    foldOrderLabel(extractOrderNumberFromText(text) ?? '');
  const lockedNumber = foldOrderLabel(String(locked.label ?? ''));
  if (spokenNumber && lockedNumber && spokenNumber !== lockedNumber) return true;

  const spokenClient =
    String(entities.clientName ?? '').trim() || String(extractQueryClientFromText(text) ?? '').trim();
  if (spokenClient && !DEMONSTRATIVE.test(spokenClient) && !NOT_A_CLIENT.test(spokenClient)) {
    const lockedClient = String(locked.clientName ?? '').trim();
    if (lockedClient && !personNamesLookRelated(spokenClient, lockedClient)) return true;
  }

  if (looksLikeExplicitSearch(text) && spokenClient) {
    const lockedClient = String(locked.clientName ?? '').trim();
    if (lockedClient && !personNamesLookRelated(spokenClient, lockedClient)) return true;
    if (spokenNumber && lockedNumber && spokenNumber !== lockedNumber) return true;
  }
  return false;
}

export function shouldUseLockedOrder(
  text: string,
  entities: WhatsappCommandEntities,
  locked?: LockedOrderEntity | null
): boolean {
  if (!locked?.id || locked.resolved !== true || locked.active !== true) return false;
  if (entities.listOrders) return false;
  if (looksLikeExplicitSearch(text) && !/^(ese|este|eso|esta)\b/i.test(String(text ?? '').trim())) {
    return false;
  }
  return !isExplicitOrderSwitch(text, entities, locked);
}

export function applyOrderLock(
  entities: WhatsappCommandEntities,
  locked: LockedOrderEntity | null | undefined,
  text = ''
): WhatsappCommandEntities {
  if (!shouldUseLockedOrder(text, entities, locked)) return { ...entities };
  const next = { ...entities };
  if (
    DEMONSTRATIVE.test(String(next.clientName ?? '').trim()) ||
    NOT_A_CLIENT.test(String(next.clientName ?? '').trim())
  ) {
    next.clientName = undefined;
    next.spokenClientName = undefined;
  }
  next.targetOrderId = locked!.id;
  next.targetOrderLabel = locked!.label || next.targetOrderLabel;
  next.clientName = next.clientName || locked!.clientName;
  next.spokenClientName = next.spokenClientName || locked!.clientName;
  next.referToLast = false;
  return next;
}

export function lockedOrderFromFocus(
  focus?: { id?: string; label?: string; clientName?: string } | null
): LockedOrderEntity | null {
  const id = String(focus?.id ?? '').trim();
  if (!id) return null;
  return {
    kind: 'order',
    id,
    label: focus?.label,
    clientName: focus?.clientName,
    resolved: true,
    active: true,
  };
}

export function plannedCollection(input: {
  saldo: number;
  payFullBalance?: boolean;
  paid?: boolean;
  amount?: number;
}): { collect: number; remaining: number } {
  const saldo = Math.max(0, Number(input.saldo) || 0);
  const amount = Number(input.amount) || 0;
  const collectAll = (input.payFullBalance === true || input.paid === true) && !(amount > 0);
  const collect = collectAll ? saldo : Math.min(saldo, amount);
  return { collect, remaining: Math.max(0, saldo - collect) };
}
