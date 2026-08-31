import type { WhatsappCommandEntities, WhatsappIntent } from './ai-command-parser.ts';
import { extractSpokenColor, extractSpokenSize } from './turn-interpreter.ts';
import { isUnlikelyPersonName, looksLikeExistingOrderQuery, looksLikeNewOrder, looksLikeStatusQuery } from './lookups.ts';
import { looksLikeCashMovement } from './ai-command-parser.ts';

export const QUERY_INTENTS: WhatsappIntent[] = [
  'query_balance',
  'query_cash',
  'query_status',
  'query_stock',
];

export type LastQuerySlots = {
  clientName?: string;
  productHint?: string;
  productId?: string;
  color?: string;
  size?: string;
  orderNumber?: string;
  targetOrderId?: string;
  targetOrderLabel?: string;
  cashAmbitoHint?: string;
  metric?: string;
  entity?: string;
  limit?: number;
  requestAll?: boolean;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: string;
  sortDir?: string;
  offset?: number;
};

export type LastQuery = {
  intent: WhatsappIntent;
  slots: LastQuerySlots;
};

export type ListContext = {
  type: 'products' | 'clients' | 'orders' | 'options' | 'items' | 'stock';
  query?: string;
  items: string[];
  currentPage: number;
  pageSize: number;
  totalResults: number;
  filters?: LastQuerySlots;
  wantAll?: boolean;
};

const LIST_CONTINUE =
  /^(m[aá]s|segu[ií]|segu[ií]d|siguientes|el resto|mostrame el resto|continuar|otra p[aá]gina)[\s.!?]*$/i;

const WANT_ALL =
  /\b(todos?|todas|la lista completa|mostrame todo|mandame (?:todo|todos|todas)|quiero ver todo|el listado completo)\b/i;

const QUERY_FOLLOW_PREFIX = /^(y|e)\s+\S+/i;
const REFINE = /^(solo|solamente|nada m[aá]s)\s+/i;

export function isQueryIntent(intent: string): boolean {
  return QUERY_INTENTS.includes(intent as WhatsappIntent);
}

export function looksLikeListContinue(text: string): boolean {
  return LIST_CONTINUE.test(String(text ?? '').trim());
}

export function looksLikeWantAll(text: string): boolean {
  return WANT_ALL.test(String(text ?? '').trim());
}

export function looksLikeQueryFollowUp(text: string, last?: LastQuery | null): boolean {
  const t = String(text ?? '').trim();
  if (!t || t.length > 80) return false;
  if (looksLikeNewOrder(t) || looksLikeCashMovement(t)) return false;
  if (looksLikeListContinue(t) || looksLikeWantAll(t)) return true;
  if (!last || !isQueryIntent(last.intent)) return false;
  if (QUERY_FOLLOW_PREFIX.test(t)) return true;
  if (REFINE.test(t)) return true;
  if (last.intent === 'query_stock') {
    if (extractSpokenSize(t) && t.length < 24) return true;
    if (extractSpokenColor(t) && t.length < 28) return true;
  }
  return false;
}

function stripFollowPrefix(text: string): string {
  return String(text ?? '')
    .replace(/^(y|e)\s+/i, '')
    .replace(/^(solo|solamente|nada m[aá]s)\s+/i, '')
    .replace(/[?¿!.]+$/g, '')
    .trim();
}

export function applyQueryFollowUp(text: string, last: LastQuery): LastQuery {
  const t = String(text ?? '').trim();
  const slots = { ...last.slots };
  if (looksLikeWantAll(t)) return { intent: last.intent, slots };
  if (looksLikeListContinue(t)) return { intent: last.intent, slots };

  if (last.intent === 'query_balance' || last.intent === 'query_status') {
    const name = stripFollowPrefix(t);
    const sameEntityQuery =
      looksLikeStatusQuery(t) ||
      looksLikeExistingOrderQuery(t) ||
      /\b(cu[aá]nto\s+debe|cu[aá]nto\s+saldo|el\s+saldo|qu[eé]\s+saldo|cu[aá]nto\s+queda)\b/i.test(t);
    if (
      name &&
      !extractSpokenSize(t) &&
      !sameEntityQuery &&
      !isUnlikelyPersonName(name)
    ) {
      slots.clientName = name;
    }
  }

  if (last.intent === 'query_stock') {
    const size = extractSpokenSize(t);
    const color = extractSpokenColor(t);
    if (size) slots.size = size;
    if (color) slots.color = color;
    const leftover = stripFollowPrefix(t)
      .replace(/\b(talle|size|xl|xxl|xs|s|m|l)\b/gi, '')
      .replace(/\b(negro|negra|negras|blanco|blanca|rojo|roja|azul|verde|gris|rosa)\b/gi, '')
      .trim();
    if (leftover.length >= 3 && !size && !color) slots.productHint = leftover;
  }

  if (last.intent === 'query_cash') {
    const hint = stripFollowPrefix(t);
    if (hint) slots.cashAmbitoHint = hint;
  }

  return { intent: last.intent, slots };
}

export function lastQueryFromEntities(intent: WhatsappIntent, entities: WhatsappCommandEntities): LastQuery {
  const item = entities.items?.[0];
  return {
    intent,
    slots: {
      clientName: entities.clientName,
      productHint: entities.productName || item?.productHint || item?.productName,
      productId: entities.productId || item?.productId,
      color: item?.attributes?.color ?? undefined,
      size: item?.attributes?.size ?? undefined,
      orderNumber: entities.orderNumber,
      targetOrderId: entities.targetOrderId,
      targetOrderLabel: entities.targetOrderLabel,
      cashAmbitoHint: entities.cashAmbitoHint,
      metric: entities.queryMetric,
      entity: entities.queryEntity,
      limit: entities.queryLimit,
      requestAll: entities.queryRequestAll,
      status: entities.queryStatusFilter,
      dateFrom: entities.queryDateFrom,
      dateTo: entities.queryDateTo,
      dateField: entities.queryDateField,
      sortDir: entities.querySortDir,
      offset: entities.queryOffset,
    },
  };
}

export function entitiesFromLastQuery(last: LastQuery): WhatsappCommandEntities {
  const slots = last.slots;
  const entities: WhatsappCommandEntities = {
    clientName: slots.clientName,
    productName: slots.productHint,
    productId: slots.productId,
    orderNumber: slots.orderNumber,
    targetOrderId: slots.targetOrderId,
    targetOrderLabel: slots.targetOrderLabel,
    cashAmbitoHint: slots.cashAmbitoHint,
    queryMetric: slots.metric as WhatsappCommandEntities['queryMetric'],
    queryEntity: slots.entity,
    queryLimit: slots.limit,
    queryRequestAll: slots.requestAll,
    queryStatusFilter: slots.status,
    queryDateFrom: slots.dateFrom,
    queryDateTo: slots.dateTo,
    queryDateField: slots.dateField as WhatsappCommandEntities['queryDateField'],
    querySortDir: slots.sortDir as WhatsappCommandEntities['querySortDir'],
    queryOffset: slots.offset,
    listOrders: slots.metric === 'list' || slots.metric === 'count' || slots.entity === 'orders',
    referToLast: !slots.targetOrderId && !slots.orderNumber && !slots.clientName,
  };
  if (slots.color || slots.size || slots.productHint) {
    entities.items = [
      {
        quantity: 1,
        rawText: [slots.productHint, slots.color, slots.size].filter(Boolean).join(' '),
        productHint: slots.productHint,
        attributes: { color: slots.color ?? null, size: slots.size ?? null },
      },
    ];
  }
  return entities;
}

export function nextListPage(context: ListContext): ListContext {
  const maxPage = Math.max(1, Math.ceil(context.totalResults / Math.max(1, context.pageSize)));
  return {
    ...context,
    currentPage: Math.min(context.currentPage + 1, maxPage),
  };
}
