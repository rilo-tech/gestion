import type { WhatsappCommandEntities, WhatsappFollowUpAction, WhatsappIntent } from './ai-command-parser.ts';
import {
  catalogQueryForItem,
  followUpToConversationAction,
  parseConversationAction,
  parseLineItems,
  splitConcatenatedProductText,
  type AwaitingSlot,
  type ConversationAction,
  type LineItemAttributes,
  type LineItemIntent,
} from './conversation-contract.ts';
import { extractSpokenProductType, extractSpokenFabric, mergeAttributes, signalsFromItem } from './catalog-rank.ts';
import { extractAmountFromText, extractDeliveryDateFromText, extractNotesHintFromText, looksLikeClientCorrection } from './lookups.ts';
import { preferCompleteEntityName } from './entity-name.ts';
import { traceOrderItems } from './conversation-log.ts';

export type QueuedWhatsappTask = {
  intent: WhatsappIntent;
  entities: WhatsappCommandEntities;
  raw?: string;
};

export type TurnInterpretation = {
  intent: WhatsappIntent;
  confidence: number;
  conversationAction: ConversationAction;
  client?: { raw?: string; name?: string; phone?: string; id?: string };
  supplier?: { raw?: string; name?: string; phone?: string; id?: string };
  items: LineItemIntent[];
  amount?: number | null;
  seniaAmount?: number | null;
  date?: string | null;
  deliveryDate?: string | null;
  notes?: string | null;
  requestedStatus?: 'pendiente' | 'en_produccion' | 'listo' | 'entregado' | null;
  paid?: boolean;
  providedFields: string[];
  missingFields: string[];
  ambiguousFields: string[];
  requiresClarification: boolean;
  clarificationReason?: string | null;
  choiceIndex?: number;
  choiceIndexes?: number[];
  followUpAction?: WhatsappFollowUpAction;
  queuedTask?: QueuedWhatsappTask | null;
};

export function ensureOrderItems(entities: WhatsappCommandEntities): LineItemIntent[] {
  if (Array.isArray(entities.items) && entities.items.length) {
    entities.items = normalizeOrderLineItems(
      entities.items.map((item) => fillItemAttributes(item)),
      entities.sourceText
    );
    return entities.items;
  }
  const fromPurchase = Array.isArray(entities.purchaseLines) ? entities.purchaseLines : [];
  if (fromPurchase.length) {
    const items = parseLineItems(
      fromPurchase.map((line) => ({
        ...line,
        rawText: line.invoiceName || line.productName,
        productHint: line.productName,
        quantity: line.quantity,
      }))
    );
    entities.items = normalizeOrderLineItems(items.map((item) => fillItemAttributes(item)), entities.sourceText);
    return entities.items;
  }
  const productName = String(entities.productName ?? '').trim();
  if (!productName) {
    entities.items = [];
    return [];
  }
  const split = splitConcatenatedProductText(productName);
  const qtyFromName = quantityFromSpokenText(productName, Math.max(1, Number(entities.quantity) || 1));
  const items = (split.length
    ? split
    : [
        {
          quantity: qtyFromName,
          rawText: productName,
          productHint: productName,
          productId: entities.productId,
          productName,
          spokenProductName: entities.spokenProductName || productName,
          sourceSpan: productName,
          tipoLinea: entities.productAsConcept ? ('concepto' as const) : undefined,
        },
      ]
  ).map((item) => fillItemAttributes(item));
  entities.items = normalizeOrderLineItems(items, entities.sourceText);
  return entities.items;
}

export function syncLegacyProductFields(entities: WhatsappCommandEntities): void {
  const items = Array.isArray(entities.items) ? entities.items.filter((item) => !item.skipped) : [];
  if (!items.length) return;
  const first = items[0]!;
  if (!entities.productName) entities.productName = first.productName || first.productHint || first.rawText;
  if (!entities.spokenProductName) {
    entities.spokenProductName = first.spokenProductName || first.rawText;
  }
  if (!entities.productId && first.productId) entities.productId = first.productId;
  if (items.length === 1 && !entities.quantity) entities.quantity = first.quantity;
  if (items.length > 1) entities.quantity = undefined;
}

const ORDINAL: Record<string, number> = {
  primer: 1,
  primero: 1,
  primera: 1,
  segundo: 2,
  segunda: 2,
  tercero: 3,
  tercera: 3,
  cuarto: 4,
  cuarta: 4,
};

const COLOR_WORDS: Record<string, string> = {
  negro: 'negro',
  negra: 'negro',
  negros: 'negro',
  negras: 'negro',
  blanco: 'blanco',
  blanca: 'blanco',
  blancos: 'blanco',
  blancas: 'blanco',
  rojo: 'rojo',
  roja: 'rojo',
  gris: 'gris',
  azul: 'azul',
  verde: 'verde',
  rosa: 'rosa',
  beige: 'beige',
  naranja: 'naranja',
  violeta: 'violeta',
  lila: 'violeta',
  celeste: 'celeste',
  fucsia: 'fucsia',
  bordo: 'bordo',
  crema: 'crema',
  mostaza: 'mostaza',
  amarillo: 'amarillo',
  amarilla: 'amarillo',
};

const SIZE_RE = /\b(?:talle\s+)?(xxxxl|xxxl|xxl|xl|xs|s|m|l|2xl|3xl|4xl|5xl)\b/i;

export function parseChoiceFromText(text: string): {
  index?: number;
  indexes?: number[];
  reject?: boolean;
  none?: boolean;
  more?: boolean;
} {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return {};
  if (
    /^(ningun[oa]s?(?:\s+de\s+(?:estos|esos|ellas?|ellos))?|ninguno de (?:la lista|arriba)|otra cosa)$/i.test(
      raw
    )
  ) {
    return { none: true };
  }
  if (
    /^(m[aá]s|segu[ií]|siguientes|otras?(?:\s+opciones?)?|el resto|otros|mostrame\s+m[aá]s)$/i.test(raw)
  ) {
    return { more: true };
  }
  if (/^(ese|esa|esto|eso)\s+no\b/.test(raw) || /^no[,.]?\s+(ese|esa|el\s+otro|la\s+otra)\b/.test(raw)) {
    return { index: 1, reject: true };
  }
  if (/^(los|las)\s+dos\b/.test(raw) || /^ambos\b/.test(raw) || /^las\s+dos\b/.test(raw)) {
    return { indexes: [1, 2] };
  }
  const numbered = raw.match(/^(?:el|la|los|las)?\s*(\d{1,2})(?:\s*y\s*(\d{1,2}))?$/);
  if (numbered) {
    const first = Number(numbered[1]);
    const second = numbered[2] ? Number(numbered[2]) : undefined;
    if (second) return { indexes: [first, second] };
    return { index: first };
  }
  const ordinal = raw.match(/^(?:el|la)\s+(primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta)\b/);
  if (ordinal?.[1] && ORDINAL[ordinal[1]]) return { index: ORDINAL[ordinal[1]] };
  if (/^(ese|esa|este|esta|eso)\s*$/.test(raw)) return { index: 1 };
  return {};
}

export type ConfirmReplyKind = 'confirm' | 'cancel' | 'correct' | 'confirm_amend';

function requestedStatusFromText(
  text: string
): 'pendiente' | 'en_produccion' | 'listo' | 'entregado' | undefined {
  const match = String(text ?? '').match(
    /(?<![\p{L}])(?:pon(?:[eé])?lo|pasalo|dejalo|marcalo|cambialo|poneme)\s+(?:el\s+pedido\s+)?(?:en\s+|a\s+|como\s+)?(?:estado\s+)?(listo|pendiente|entregad[oa]|pronto|terminad[oa]|en\s+producci[oó]n|en\s+proceso)(?![\p{L}])/iu
  );
  const token = String(match?.[1] ?? '').toLowerCase();
  if (!token) return undefined;
  if (token.startsWith('entreg')) return 'entregado';
  if (token.startsWith('pend')) return 'pendiente';
  if (token.includes('produc') || token.includes('proceso')) return 'en_produccion';
  return 'listo';
}

/**
 * Intención de confirmar/cancelar un pendingPlan sensible.
 * Frases naturales cortas → confirm|cancel; con enmienda → confirm_amend;
 * ambiguo / corrección → correct (NO ejecutar).
 * Backend sigue siendo la autoridad: solo se ejecuta si pendingIntent + confirm.
 */
export function classifyConfirmReply(text: string): ConfirmReplyKind {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return 'correct';

  // Cancel primero: «mejor no» no debe caer en reinterpretación.
  if (
    /^(no+|n[oó]|nop|n|cancelar|cancel[áa]|cancela|dejalo|d[eé]jalo|dej[áa]|mejor\s+no|no\s+gracias|nah|olvidalo|olv[ií]dalo|no\s+lo\s+guardes|no\s+lo\s+hagas|no\s+lo\s+anotes)\s*[.!]*$/i.test(
      t
    )
  ) {
    return 'cancel';
  }

  if (
    /^(si|sí|ok|okay|dale|confirmo|confirmar|yes|y|guardalo|gu[aá]rdalo|hacelo|hacele|guarda|anotalo|correcto|perfecto|mandale|de\s+una|listo|afirmativo|esta\s+bien|est[aá]\s+bien|todo\s+bien)\s*[.!]*$/i.test(
      t
    )
  ) {
    return 'confirm';
  }

  {
    const amend = t.match(
      /^(si|sí|ok|okay|dale|confirmo|confirmar|yes|correcto|perfecto|mandale|listo|est[aá]\s+bien|esta\s+bien)([\s\S]*)$/i
    );
    const rest = String(amend?.[2] ?? '')
      .replace(/^[\s,.!…]+/u, '')
      .trim();
    if (amend && rest) return 'confirm_amend';
  }
  return 'correct';
}

export function extractSpokenColor(text: string): string | null {
  const tokens = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    if (COLOR_WORDS[token]) return COLOR_WORDS[token];
  }
  return null;
}

export function extractSpokenSize(text: string): string | null {
  const match = String(text ?? '').match(SIZE_RE);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function inferLineAttributes(text: string): LineItemAttributes {
  const attributes: LineItemAttributes = {};
  const type = extractSpokenProductType(text);
  const color = extractSpokenColor(text);
  const size = extractSpokenSize(text);
  const fabric = extractSpokenFabric(text);
  if (type) attributes.type = type;
  if (color) attributes.color = color;
  if (size) attributes.size = size;
  if (fabric) attributes.fabric = fabric;
  return attributes;
}

export function fillItemAttributes(item: LineItemIntent): LineItemIntent {
  const inferred = inferLineAttributes([item.rawText, item.productHint, item.productName].filter(Boolean).join(' '));
  return { ...item, attributes: mergeAttributes(inferred, item.attributes) ?? inferred };
}

function itemIndexFromText(text: string, itemCount: number): number | null {
  const raw = String(text ?? '').toLowerCase();
  const ordinal = raw.match(/\b(?:la|el|a\s+la)?\s*(primera|primera|segunda|segundo|tercera|tercero|1|2|3)\b/);
  if (ordinal?.[1] === 'primera' || ordinal?.[1] === '1') return 0;
  if (ordinal?.[1] === 'segunda' || ordinal?.[1] === 'segundo' || ordinal?.[1] === '2') return 1;
  if (ordinal?.[1] === 'tercera' || ordinal?.[1] === 'tercero' || ordinal?.[1] === '3') return 2;
  if (itemCount === 1) return 0;
  return null;
}

function cloneItems(items: LineItemIntent[]): LineItemIntent[] {
  return items.map((item) => ({
    ...item,
    attributes: item.attributes ? { ...item.attributes } : undefined,
  }));
}

function patchItemAttributes(item: LineItemIntent, patch: LineItemAttributes): LineItemIntent {
  const attributes = { ...(item.attributes ?? {}), ...patch };
  const next = { ...item, attributes };
  if (patch.color || patch.size) {
    next.productId = undefined;
    next.productLocked = undefined;
  }
  return next;
}

export function applyItemCorrection(
  items: LineItemIntent[],
  text: string,
  awaiting?: AwaitingSlot | null
): { items: LineItemIntent[]; changed: boolean } {
  const next = cloneItems(items);
  const raw = String(text ?? '').trim();
  if (!raw || !next.length) return { items: next, changed: false };

  if (/^sac[aá]\s+(la|el)\s+(primera|primer|1)\b/i.test(raw) || /^elimin[aá]\s+la\s+primera\b/i.test(raw)) {
    next.splice(0, 1);
    return { items: next, changed: true };
  }
  if (/^sac[aá]\s+(la|el)\s+(segunda|2)\b/i.test(raw)) {
    if (next.length > 1) next.splice(1, 1);
    return { items: next, changed: true };
  }

  const targetFromAwaiting =
    awaiting?.itemIndex != null && awaiting.itemIndex >= 0 && awaiting.itemIndex < next.length
      ? awaiting.itemIndex
      : null;
  const mentioned = itemIndexFromText(raw, next.length);
  const target = mentioned ?? targetFromAwaiting ?? (next.length === 1 ? 0 : null);
  const color = extractSpokenColor(raw);
  const size = extractSpokenSize(raw);
  const qty = raw.match(/\b(?:pon[eé]|dejal[oa]|son|queda[n]?)\s+(\d+)\b/i) || raw.match(/^(\d+)\s+de\s+la\b/i);

  if (target == null) {
    if (color && awaiting?.field === 'itemColor' && next.length) {
      next[next.length - 1] = patchItemAttributes(next[next.length - 1]!, { color });
      return { items: next, changed: true };
    }
    return { items: next, changed: false };
  }

  let changed = false;
  if (color) {
    next[target] = patchItemAttributes(next[target]!, { color });
    changed = true;
  }
  if (size) {
    next[target] = patchItemAttributes(next[target]!, { size });
    changed = true;
  }
  if (qty?.[1]) {
    next[target] = { ...next[target]!, quantity: Math.max(1, Number(qty[1]) || 1), productId: undefined };
    changed = true;
  }
  return { items: next, changed };
}

function foldItemToken(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function quantityFromSpokenText(text: string, fallback = 1): number {
  const raw = String(text ?? '').trim();
  const digits = raw.match(/^\s*(\d+)\s+/);
  if (digits) return Math.max(1, Number(digits[1]) || fallback);
  return Math.max(1, fallback);
}

export function looksLikeAddAnotherItem(text: string): boolean {
  return /(?<![\p{L}])(?:agreg(?:á|a|ale|ále)|sum(?:á|a|ale|ále)|tambi[eé]n|y\s+(?:un[ao]?|otro|otra)\s)/iu.test(
    String(text ?? '')
  );
}

function coreLineSignature(item: LineItemIntent): { type: string; size: string; color: string } {
  const signals = signalsFromItem({
    ...item,
    rawText: [item.rawText, item.productName].filter(Boolean).join(' '),
  });
  return {
    type: foldItemToken(String(signals.type || '')),
    size: foldItemToken(String(signals.size || '')).toUpperCase(),
    color: foldItemToken(String(signals.color || '')),
  };
}

function stableItemKey(item: LineItemIntent): string {
  if (item.itemKey) return item.itemKey;
  if (item.sourceSpan) return `span:${foldItemToken(item.sourceSpan)}`;
  const core = coreLineSignature(item);
  if (core.type && (core.size || core.color)) {
    return `core:${core.type}|${core.size}|${core.color}`;
  }
  return `text:${foldItemToken(item.rawText || item.productHint || item.productName || '').slice(0, 80)}`;
}

function withItemIdentity(item: LineItemIntent): LineItemIntent {
  const filled = fillItemAttributes(item);
  const sourceSpan = filled.sourceSpan || filled.rawText || filled.productHint || filled.productName;
  return {
    ...filled,
    itemKey: stableItemKey({ ...filled, sourceSpan }),
    sourceSpan: sourceSpan || undefined,
  };
}

function significantTokens(item: LineItemIntent): Set<string> {
  const stop = new Set([
    'un',
    'una',
    'unos',
    'unas',
    'el',
    'la',
    'de',
    'con',
    'talle',
    'color',
    'sw',
    'felpa',
  ]);
  const blob = [item.rawText, item.productHint, item.productName, item.attributes?.type, item.attributes?.color, item.attributes?.size]
    .filter(Boolean)
    .join(' ');
  return new Set(
    foldItemToken(blob)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !stop.has(token))
  );
}

function isTokenSubset(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  for (const token of a) {
    if (!b.has(token)) return false;
  }
  return true;
}

/** Mismo SKU: mismo producto resuelto, o mismo tipo+talle+color. */
export function sameSkuItem(a: LineItemIntent, b: LineItemIntent): boolean {
  if (a.itemKey && b.itemKey && a.itemKey === b.itemKey) return true;
  if (a.productId && b.productId && a.productId === b.productId) return true;
  const ca = coreLineSignature(a);
  const cb = coreLineSignature(b);
  if (ca.type && cb.type && ca.type !== cb.type) return false;
  if (ca.size && cb.size && ca.size !== cb.size) return false;
  if (ca.color && cb.color && ca.color !== cb.color) return false;
  if (ca.type && cb.type && ca.size && cb.size && ca.color && cb.color) return true;
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  return isTokenSubset(ta, tb) || isTokenSubset(tb, ta);
}

/** Misma prenda para patch (la resolución o un cambio de color no es un renglón nuevo). */
export function sameLineFamily(a: LineItemIntent, b: LineItemIntent): boolean {
  if (sameSkuItem(a, b)) return true;
  const ca = coreLineSignature(a);
  const cb = coreLineSignature(b);
  if (ca.type && cb.type && ca.type !== cb.type) return false;
  if (ca.size && cb.size && ca.size !== cb.size) return false;
  if (ca.type && cb.type) return true;
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  return isTokenSubset(ta, tb) || isTokenSubset(tb, ta);
}

function countTypeMentions(text: string, type: string): number {
  const foldedType = foldItemToken(type);
  if (!foldedType) return 0;
  const re = new RegExp(`(?<![\\p{L}])${foldedType}s?(?![\\p{L}])`, 'giu');
  return String(text ?? '').match(re)?.length ?? 0;
}

function explicitQuantityForType(text: string, type: string): number | null {
  const foldedType = foldItemToken(type);
  if (!foldedType) return null;
  const re = new RegExp(`(?<![\\p{L}])(\\d+)\\s+${foldedType}s?(?![\\p{L}])`, 'iu');
  const match = String(text ?? '').match(re);
  if (!match?.[1]) return null;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

function resolvedScore(item: LineItemIntent): number {
  return (item.productId ? 8 : 0) + (item.productName ? 4 : 0) + (item.productLocked ? 2 : 0);
}

function patchLine(base: LineItemIntent, patch: LineItemIntent, action: ConversationAction): LineItemIntent {
  const locked = Boolean(base.productLocked && base.productId && action !== 'correct_current');
  return {
    ...base,
    ...patch,
    itemKey: base.itemKey || patch.itemKey,
    sourceSpan: base.sourceSpan || patch.sourceSpan,
    sourceTurnId: base.sourceTurnId || patch.sourceTurnId,
    quantity: patch.quantity || base.quantity,
    rawText: base.rawText || patch.rawText,
    spokenProductName: base.spokenProductName || patch.spokenProductName,
    attributes: { ...(base.attributes ?? {}), ...(patch.attributes ?? {}) },
    productId: locked ? base.productId : patch.productId ?? base.productId,
    productName: locked ? base.productName || patch.productName : patch.productName || base.productName,
    productLocked: locked || patch.productLocked || base.productLocked,
  };
}

function spokenIdentityFrom(group: LineItemIntent[]): LineItemIntent {
  return (
    group.find((item) => !item.productId && (item.sourceSpan || item.rawText)) ||
    group.find((item) => {
      const span = foldItemToken(item.sourceSpan || item.rawText || '');
      const name = foldItemToken(item.productName || '');
      return Boolean(span && name && span !== name);
    }) ||
    group[0]!
  );
}

/**
 * Copia accidental (mención hablada + SKU resuelto) → qtyMax.
 * "2 canguros" → el número explícito.
 * "un canguro y otro canguro" → mención ≥ 2, no suma copias resueltas.
 */
function spokenLeadingQuantity(text: string): number | null {
  const match = String(text ?? '')
    .trim()
    .match(/^(\d{1,2})\s+(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/u);
  if (!match?.[1]) return null;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty >= 2 && qty <= 50 ? qty : null;
}

function quantityForSameSkuGroup(group: LineItemIntent[], sourceText: string): number {
  const qtyMax = Math.max(...group.map((item) => Math.max(1, Number(item.quantity) || 1)));
  const type = coreLineSignature(group[0]!).type;
  const explicit = type ? explicitQuantityForType(sourceText, type) : null;
  if (explicit != null) return explicit;
  const leading = spokenLeadingQuantity(sourceText);
  if (leading != null) return Math.max(leading, qtyMax);
  if (type) {
    const mentionCount = countTypeMentions(sourceText, type);
    if (mentionCount >= 2) return Math.max(qtyMax, mentionCount);
  }
  return qtyMax;
}

function mergeSameSkuGroup(group: LineItemIntent[], sourceText: string): LineItemIntent {
  const ranked = [...group].sort((a, b) => resolvedScore(b) - resolvedScore(a));
  const best = ranked[0]!;
  const spoken = spokenIdentityFrom(group);
  return withItemIdentity({
    ...best,
    quantity: quantityForSameSkuGroup(group, sourceText),
    itemKey: spoken.itemKey || best.itemKey,
    sourceSpan: spoken.sourceSpan || spoken.rawText || best.sourceSpan,
    sourceTurnId: spoken.sourceTurnId || best.sourceTurnId,
    rawText: spoken.rawText || best.rawText,
    spokenProductName: spoken.spokenProductName || spoken.rawText || best.spokenProductName,
    attributes: group.reduce((attrs, item) => ({ ...attrs, ...(item.attributes ?? {}) }), best.attributes ?? {}),
  });
}

/** Colapsa copias accidentales de la misma mención. No pisa un quantity=2 explícito. */
export function normalizeOrderLineItems(
  items: LineItemIntent[] | null | undefined,
  sourceText = ''
): LineItemIntent[] {
  const filled = (items ?? []).filter((item) => !item.skipped).map((item) => withItemIdentity(item));
  const groups: LineItemIntent[][] = [];
  for (const item of filled) {
    const group = groups.find((rows) => rows.some((row) => sameSkuItem(row, item)));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => mergeSameSkuGroup(group, sourceText));
}

export function coalesceOrderItems(
  rulesItems: LineItemIntent[] | null | undefined,
  geminiItems: LineItemIntent[] | null | undefined,
  sourceText = ''
): LineItemIntent[] {
  return normalizeOrderLineItems([...(rulesItems ?? []), ...(geminiItems ?? [])], sourceText);
}

/** Agrega una tanda de ítems al draft. Suma qty del mismo SKU; no reparsea el hilo anterior. */
export function appendOrderItemBatch(
  current: LineItemIntent[] | null | undefined,
  incoming: LineItemIntent[] | null | undefined,
  batchText = ''
): LineItemIntent[] {
  const next = (current ?? []).filter((item) => !item.skipped).map((item) => withItemIdentity(item));
  const batch = normalizeOrderLineItems(incoming, batchText);
  for (const raw of batch) {
    const item = withItemIdentity(raw);
    const idx = next.findIndex((row) => sameSkuItem(row, item));
    if (idx >= 0) {
      const prev = next[idx]!;
      next[idx] = withItemIdentity({
        ...prev,
        quantity: (Number(prev.quantity) || 0) + (Number(item.quantity) || 1),
        itemKey: prev.itemKey || item.itemKey,
        sourceSpan: prev.sourceSpan || item.sourceSpan,
        rawText: prev.rawText || item.rawText,
        attributes: { ...(prev.attributes ?? {}), ...(item.attributes ?? {}) },
      });
      continue;
    }
    next.push(item);
  }
  return next;
}

function mergeIncomingItems(
  current: LineItemIntent[],
  incoming: LineItemIntent[],
  action: ConversationAction,
  text = ''
): LineItemIntent[] {
  const incomingNorm = normalizeOrderLineItems(incoming, text);
  const currentNorm = current.map((item) => withItemIdentity(item));
  if (!incomingNorm.length) return cloneItems(currentNorm);
  if (!currentNorm.length || action === 'new_task') return cloneItems(incomingNorm);

  const adding = looksLikeAddAnotherItem(text);
  const used = new Set<number>();
  const result: LineItemIntent[] = currentNorm.map((cur) => {
    const index = incomingNorm.findIndex((inc, i) => {
      if (used.has(i)) return false;
      return adding ? sameSkuItem(cur, inc) : sameLineFamily(cur, inc);
    });
    if (index < 0) return cur;
    used.add(index);
    return patchLine(cur, incomingNorm[index]!, action);
  });

  for (let i = 0; i < incomingNorm.length; i++) {
    if (used.has(i)) continue;
    const inc = incomingNorm[i]!;
    const dup = result.findIndex((row) => (adding ? sameSkuItem(row, inc) : sameLineFamily(row, inc)));
    if (dup >= 0) {
      result[dup] = patchLine(result[dup]!, inc, action);
      continue;
    }
    result.push(withItemIdentity(inc));
  }
  return normalizeOrderLineItems(result, text);
}

export function applyFollowUpToEntities(
  collected: WhatsappCommandEntities,
  text: string,
  awaiting?: AwaitingSlot | null,
  incoming?: Partial<TurnInterpretation>
): WhatsappCommandEntities {
  const next: WhatsappCommandEntities = { ...collected };
  const items = ensureOrderItems(next);
  const action = incoming?.conversationAction ?? 'answer_current';
  const mergedItems = mergeIncomingItems(items, incoming?.items ?? [], action, text);
  const corrected = applyItemCorrection(mergedItems, text, awaiting);
  next.items = normalizeOrderLineItems(
    corrected.items,
    next.collectingItems ? text : [next.sourceText, text].filter(Boolean).join(' ')
  );
  syncLegacyProductFields(next);
  traceOrderItems('after-merge', next.items);

  const incomingRaw = incoming?.client?.raw?.trim();
  const incomingName = incoming?.client?.name?.trim();
  const clientName = preferCompleteEntityName(incomingRaw, incomingName);
  const clientCorrection = looksLikeClientCorrection(text) || awaiting?.field === 'client' || awaiting?.field === 'clientName';
  if (clientName && (!collected.clientLocked || clientCorrection)) {
    next.clientName = clientName;
    next.spokenClientName = incomingRaw || clientName;
    if (incoming?.client?.phone) next.clientPhone = incoming.client.phone;
    if (incoming?.client?.id) next.clientId = incoming.client.id;
    else if (clientName.toLowerCase() !== String(collected.clientName ?? '').toLowerCase()) {
      next.clientId = undefined;
      next.clientLocked = undefined;
    }
    if (clientCorrection) next.clientLocked = undefined;
  }
  if (incoming?.deliveryDate) {
    next.deliveryDate = incoming.deliveryDate;
    next.deliveryAsked = true;
    next.deliveryDefaulted = undefined;
  } else {
    const date = extractDeliveryDateFromText(text);
    if (date) {
      next.deliveryDate = date;
      next.deliveryAsked = true;
      next.deliveryDefaulted = undefined;
    }
  }
  if (incoming?.notes) next.notes = incoming.notes;
  else {
    const notes = extractNotesHintFromText(text);
    if (notes) {
      next.notes = notes;
      next.notesAsked = true;
    }
  }
  const requested = incoming?.requestedStatus || requestedStatusFromText(text);
  if (requested) {
    next.requestedStatus = requested;
    next.orderStatus = requested;
  }
  if (incoming?.paid != null) next.paid = incoming.paid;
  if (incoming?.amount != null && incoming.amount > 0) next.amount = incoming.amount;
  else if (awaiting?.field === 'amount') {
    const amount = extractAmountFromText(text);
    if (amount) next.amount = amount;
  }
  if (incoming?.seniaAmount != null && incoming.seniaAmount > 0) next.seniaAmount = incoming.seniaAmount;

  if (awaiting?.field === 'itemColor' || awaiting?.type === 'field') {
    const color = extractSpokenColor(text);
    const target = awaiting.itemIndex ?? (next.items.length > 1 ? next.items.length - 1 : 0);
    if (color && next.items[target]) {
      next.items[target] = patchItemAttributes(next.items[target]!, { color });
      syncLegacyProductFields(next);
    }
  }

  if (corrected.changed || next.items.length) syncLegacyProductFields(next);
  return next;
}

export function interpretFollowUp(
  text: string,
  awaiting?: AwaitingSlot | null,
  collected?: WhatsappCommandEntities
): TurnInterpretation {
  const choice = parseChoiceFromText(text);
  const color = extractSpokenColor(text);
  const size = extractSpokenSize(text);
  const date = extractDeliveryDateFromText(text);
  const items = collected ? ensureOrderItems({ ...collected }) : [];
  const patched = applyItemCorrection(items, text, awaiting);
  const providedFields: string[] = [];
  if (color) providedFields.push('color');
  if (size) providedFields.push('size');
  if (date) providedFields.push('deliveryDate');
  if (choice.index || choice.indexes?.length) providedFields.push('choice');

  let conversationAction: ConversationAction = 'answer_current';
  if (/^(no|cancelar)$/i.test(text.trim())) conversationAction = 'cancel_current';
  else if (/^(si|sí|ok|dale|confirmo)$/i.test(text.trim())) conversationAction = 'confirm_current';
  else if (choice.reject) conversationAction = 'correct_current';
  else if (patched.changed || color || size) conversationAction = 'correct_current';

  return {
    intent: (collected && items.length ? 'create_order' : 'unknown') as WhatsappIntent,
    confidence: providedFields.length ? 0.86 : 0.4,
    conversationAction,
    items: patched.items,
    deliveryDate: date,
    providedFields,
    missingFields: [],
    ambiguousFields: [],
    requiresClarification: !providedFields.length && !choice.index && !choice.indexes,
    clarificationReason: !providedFields.length ? 'No entendí a qué se refería.' : null,
    choiceIndex: choice.reject ? undefined : choice.index,
    choiceIndexes: choice.indexes,
  };
}

export function catalogQueriesForEntities(entities: WhatsappCommandEntities): string[] {
  return ensureOrderItems(entities).map((item) => catalogQueryForItem(item));
}

export function neverSearchConcatenatedOrder(entities: WhatsappCommandEntities): boolean {
  const queries = catalogQueriesForEntities(entities);
  return queries.every((query) => !looksLikeTwoProducts(query));
}

function looksLikeTwoProducts(query: string): boolean {
  return /\d+\s+.+\s+y\s+\d+\s+/i.test(query);
}

export function turnFromParsedEntities(
  intent: WhatsappIntent,
  entities: WhatsappCommandEntities,
  extras?: {
    confidence?: number;
    followUpAction?: TurnInterpretation['followUpAction'];
    choiceIndex?: number;
    conversationAction?: ConversationAction;
    items?: unknown;
  }
): TurnInterpretation {
  const fromGemini = parseLineItems(extras?.items);
  const items = fromGemini.length ? fromGemini : ensureOrderItems(entities);
  const action =
    extras?.conversationAction ||
    parseConversationAction(extras?.followUpAction) ||
    followUpToConversationAction(extras?.followUpAction);
  return {
    intent,
    confidence: extras?.confidence ?? 0.7,
    conversationAction: action,
    client: preferCompleteEntityName(entities.spokenClientName, entities.clientName)
      ? {
          name: preferCompleteEntityName(entities.spokenClientName, entities.clientName),
          phone: entities.clientPhone,
          raw: entities.spokenClientName || entities.clientName,
        }
      : undefined,
    items,
    amount: entities.amount,
    seniaAmount: entities.seniaAmount,
    deliveryDate: entities.deliveryDate,
    notes: entities.notes,
    providedFields: [],
    missingFields: [],
    ambiguousFields: [],
    requiresClarification: false,
    choiceIndex: extras?.choiceIndex,
  };
}

export function formatOrderProgressLines(entities: WhatsappCommandEntities): string[] {
  const lines: string[] = [];
  if (entities.clientName) lines.push(`• ${entities.clientName}`);
  for (const item of ensureOrderItems(entities)) {
    const label = item.productName || catalogQueryForItem(item) || item.rawText;
    const missing: string[] = [];
    if (!item.attributes?.color && !/\b(negro|blanco|rojo|azul|verde|rosa|gris)\b/i.test(label)) {
      missing.push('color');
    }
    lines.push(`• ${item.quantity} ${label}${missing.length ? ` (falta ${missing.join(', ')})` : ''}`);
  }
  if (entities.deliveryDate) lines.push(`• Entrega ${entities.deliveryDate}`);
  return lines;
}

export function firstMissingItemField(
  items: LineItemIntent[]
): { field: 'itemColor' | 'itemSize'; itemIndex: number } | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.productId || item.skipped) continue;
    const color = item.attributes?.color;
    const size = item.attributes?.size;
    const text = `${item.rawText} ${item.productHint ?? ''}`.toLowerCase();
    if (!color && !/\b(negro|negra|blanco|blanca|rojo|roja|azul|verde|gris|rosa)\b/i.test(text)) {
      return { field: 'itemColor', itemIndex: i };
    }
    if (!size && !SIZE_RE.test(text)) {
      return { field: 'itemSize', itemIndex: i };
    }
  }
  return null;
}

export function queueFromFreshTask(
  intent: WhatsappIntent,
  entities: WhatsappCommandEntities,
  raw?: string
): QueuedWhatsappTask {
  return { intent, entities, raw };
}

export { splitConcatenatedProductText };
