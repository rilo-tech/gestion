import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import {
  extractAmountFromText,
  extractDeliveryDateFromText,
  formatClientChoices,
  formatOperationSummary,
  formatProductChoices,
  formatSupplierChoices,
  formatPurchasePackChoices,
  formatPurchaseUnknownsPrompt,
  formatPurchaseNonCatalogChoices,
  formatPurchaseConfirmationMessages,
  isUnlikelyPersonName,
  looksLikeIterativeCorrection,
  looksLikeNewOrder,
  looksLikeStatusQuery,
  looksLikeExistingOrderQuery,
  formatExtraCostItemAsk,
} from './lookups.ts';
import { isTrivialWhatsappTurn, looksLikePendingQuestion } from './operator-voice.ts';
import { formatCashAmbitoChoices } from '../utils/caja-ambitos.ts';
import { isThanksText, riloBotHelpMenu } from '../../shared/whatsapp-copy.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';
import { looksLikeCashMovement, looksLikeOrphanPayment, looksLikeOrderStatusUpdate, looksLikeListOrders } from './ai-command-parser.ts';
import type { ConversationState } from './conversation-state.ts';
import { presentOrderCollecting, presentTransaction } from './whatsapp-present.ts';
import { ORDER_EXTRA_COST_ASK } from './order-finance.ts';
import {
  formatFindOrderGuide,
  formatOpenOrderChoices,
  formatOrderActionAsk,
  formatOrderStatusAsk,
  formatPaymentAmountAsk,
  formatSettleAsk,
  type OrderStatusTarget,
} from './order-status.ts';
import {
  STOCK_RESOLUTION_INTENT,
  formatStockResolutionAsk,
  interpretStockResolutionFromText,
} from './stock-resolution.ts';
import type { StockDiscountAsk } from '../utils/order-config.ts';
import {
  COLLECT_ORDER_ITEMS_INTENT,
  formatCollectOrderItemsAsk,
  isNonProductUtterance,
  looksLikeCollectingDone,
  splitCancelAndRemainder,
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
} from './conversation-speech.ts';

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i;
const CONFIRM_PREFIX = 'confirm:';
const CASH_QUERY_FRESH =
  /\b(cu[aá]nto\s+(hay\s+)?en\s+caja|caja\s+(de\s+)?hoy|saldo\s+neto|cu[aá]nto\s+vend[ií])\b/i;
const PURCHASE_FRESH = /\b(compra|remito|factura)\s+(a|de|del)\b/i;

type PendingPayload = Record<string, unknown>;

function payloadEntities(payload: PendingPayload): WhatsappCommandEntities {
  if (payload.entities && typeof payload.entities === 'object' && !Array.isArray(payload.entities)) {
    return { ...(payload.entities as WhatsappCommandEntities) };
  }
  return { ...(payload as WhatsappCommandEntities) };
}

function missingFieldOf(payload: PendingPayload): string {
  return String(payload.missingField ?? '').trim();
}

export const RESUME_CONTEXT_INTENT = 'resume_context';
/** Silencio a partir del cual preguntamos si seguir o empezar de nuevo. */
export const IDLE_RESUME_MS = 15 * 60 * 1000;

const RESUME_YES = /^(1|si|sí|ok|dale|seguimos|seguir|continuar|continuemos|yes|y)$/i;
const RESUME_NO =
  /^(2|no+|n[oó]|nop|cancelar|de\s+nuevo|empezar(\s+de\s+nuevo)?|empezamos|olv[ií]dalo|nuevo)\s*[.!]*$/i;

export function looksLikeResumeYes(text: string): boolean {
  return RESUME_YES.test(String(text ?? '').trim());
}

export function looksLikeResumeNo(text: string): boolean {
  return RESUME_NO.test(String(text ?? '').trim());
}

function isOnboardingPending(intent?: string | null): boolean {
  return String(intent ?? '').startsWith('onboarding_');
}

export function conversationLastActiveMs(state: ConversationState | null | undefined): number {
  if (!state) return 0;
  const stamps = [
    state.updatedAt,
    state.lastActiveAt,
    state.focusOrder?.at,
    ...(state.turns ?? []).map((turn) => turn.at),
  ];
  const times = stamps.map((stamp) => Date.parse(String(stamp ?? ''))).filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

export function isConversationIdle(
  state: ConversationState | null | undefined,
  now = Date.now()
): boolean {
  const last = conversationLastActiveMs(state);
  if (!last) return false;
  return now - last >= IDLE_RESUME_MS;
}

export function hasResumableContext(state: ConversationState | null | undefined): boolean {
  if (!state) return false;
  const pending = String(state.pendingIntent ?? '').trim();
  if (
    pending &&
    pending !== RESUME_CONTEXT_INTENT &&
    pending !== 'help_topic' &&
    !isOnboardingPending(pending)
  ) {
    return true;
  }
  return Boolean(state.focusOrder?.id);
}

export function looksLikeClearNewTask(text: string): boolean {
  return hasExplicitCompleteIntent(text);
}

/**
 * Intención operativa o de uso completa en ESTE mensaje.
 * Gana a un pending viejo / gate de SÍ-NO de resume_context.
 */
export function hasExplicitCompleteIntent(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return true;
  if (looksLikeOrderStatusUpdate(t)) return true;
  if (looksLikeStatusQuery(t) || looksLikeExistingOrderQuery(t)) return true;
  if (looksLikeNewOrder(t)) return true;
  if (looksLikeCashMovement(t)) return true;
  if (looksLikeListOrders(t)) return true;
  if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
  if (CASH_QUERY_FRESH.test(t)) return true;
  if (/\b(cu[aá]nto\s+debe|saldo\s+de)\b/i.test(t)) return true;
  if (/\b(venta|vend[eé])\b/i.test(t) && /\b(registr|anot|carg|nuev)/i.test(t)) return true;
  return false;
}

export type ClassifiedConversationAction =
  | 'execute_explicit'
  | 'correct_current'
  | 'answer_slot'
  | 'continue_context'
  | 'how_to'
  | 'capability_question'
  | 'new_task'
  | 'cancel'
  | 'unknown';

export function classifyConversationSpeechAct(
  text: string,
  pendingIntent?: string | null
): ClassifiedConversationAction {
  const t = String(text ?? '').trim();
  if (!t) return 'unknown';
  if (utteranceIsHowTo(t)) return 'how_to';
  if (utteranceIsCapabilityQuestion(t)) return 'capability_question';
  const split = splitCancelAndRemainder(t);
  if (looksLikeResumeNo(t) || (split.cancel && !split.remainder)) return 'cancel';
  if (looksLikeOrderStatusUpdate(t) || looksLikeCashMovement(t) || looksLikeNewOrder(t) || looksLikeListOrders(t)) {
    return 'execute_explicit';
  }
  if (looksLikeStatusQuery(t) || looksLikeExistingOrderQuery(t) || CASH_QUERY_FRESH.test(t)) {
    return 'execute_explicit';
  }
  if (/\b(cu[aá]nto\s+debe|saldo\s+de)\b/i.test(t)) return 'execute_explicit';
  if (looksLikeIterativeCorrection(t) && pendingIntent) return 'correct_current';
  if (looksLikeResumeYes(t)) return 'continue_context';
  if (
    pendingIntent &&
    pendingIntent !== RESUME_CONTEXT_INTENT &&
    doesFillCurrentSlot(t, pendingIntent, {})
  ) {
    return 'answer_slot';
  }
  if (split.cancel && split.remainder) return 'new_task';
  if (hasExplicitCompleteIntent(t)) return 'new_task';
  return 'unknown';
}

export type ResumeRoute =
  | { kind: 'resume_yes' }
  | { kind: 'resume_no' }
  | { kind: 'run_new'; text: string }
  | { kind: 'help_keep_pending'; intent: 'how_to' | 'capability_question' }
  | { kind: 'continue_previous'; text: string };

/**
 * Qué hacer con el mensaje cuando el bot preguntó si seguimos.
 * Nunca asume que el texto es respuesta al slot anterior.
 */
export function routeResumeUtterance(
  text: string,
  parsed: { intent: string; confidence?: number }
): ResumeRoute {
  const t = String(text ?? '').trim();
  const split = splitCancelAndRemainder(t);
  if (looksLikeResumeYes(t)) return { kind: 'resume_yes' };
  if (looksLikeResumeNo(t)) return { kind: 'resume_no' };
  if (split.cancel && split.remainder) return { kind: 'run_new', text: split.remainder };
  if (parsed.intent === 'how_to' || parsed.intent === 'capability_question') {
    return { kind: 'help_keep_pending', intent: parsed.intent };
  }
  if (hasExplicitCompleteIntent(t)) return { kind: 'run_new', text: t };
  if (
    parsed.intent !== 'unknown' &&
    parsed.intent !== 'greeting' &&
    parsed.intent !== 'help' &&
    (parsed.confidence ?? 0) >= 0.7
  ) {
    return { kind: 'run_new', text: t };
  }
  if (isNonProductUtterance(t)) return { kind: 'run_new', text: t };
  return { kind: 'continue_previous', text: t };
}

function focusOrderLine(focus?: { id?: string; label?: string; clientName?: string } | null): string {
  if (!focus) return '';
  const num = String(focus.label ?? '').trim().replace(/^#/, '');
  const who = String(focus.clientName ?? '').trim();
  if (num && who) return `pedido *#${num}* de ${who}`;
  if (num) return `pedido *#${num}*`;
  if (who) return `pedido de ${who}`;
  return '';
}

export function formatResumeAsk(state: {
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
  focusOrder?: { id?: string; label?: string; clientName?: string } | null;
}): string {
  const pending = String(state.pendingIntent ?? '').trim();
  const waiting =
    pending && pending !== RESUME_CONTEXT_INTENT
      ? waitingLabel(pending, state.pendingPayload ?? {})
      : '';
  const order = focusOrderLine(state.focusOrder);
  const lines = [
    order ? `Quedó el ${order}.` : waiting ? 'Habíamos dejado algo a medias.' : '',
    waiting ? `Te pedía ${waiting}.` : '',
  ].filter(Boolean);
  return waCard({
    title: '¿Seguimos?',
    lines,
    ask: `Pasó un rato. ¿Seguimos con eso o empezamos de nuevo?\n${waBold('SÍ')} / ${waBold('NO')}`,
  });
}

export function parsedIntentSkipsIdleResume(intent?: string | null, confidence = 0): boolean {
  const value = String(intent ?? '').trim();
  if (!value || value === 'unknown' || value === 'greeting' || value === 'help') return false;
  if (confidence >= 0.7) return true;
  return [
    'how_to',
    'capability_question',
    'query_status',
    'query_balance',
    'query_cash',
    'query_stock',
    'update_order_status',
    'create_order',
    'create_sale',
    'create_purchase',
    'register_cash',
    'register_payment',
    'create_client',
  ].includes(value);
}

/**
 * Si hay un paso o un pedido a medias y pasó un rato, preguntar antes de
 * aplicar el mensaje al contexto viejo. Un trabajo claramente nuevo no se
 * interrumpe. resume_context es fallback: si el mensaje ya es una intención
 * completa, no preguntar SÍ/NO.
 */
export function shouldAskIdleResume(
  text: string,
  state: ConversationState | null | undefined,
  parsed?: { intent?: string | null; confidence?: number } | null
): boolean {
  if (!state || !hasResumableContext(state)) return false;
  const pending = String(state.pendingIntent ?? '').trim();
  if (pending === RESUME_CONTEXT_INTENT) return false;
  if (isOnboardingPending(pending) || pending === 'help_topic') return false;
  const t = String(text ?? '').trim();
  if (looksLikeClearNewTask(t)) return false;
  if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return false;
  if (parsedIntentSkipsIdleResume(parsed?.intent, parsed?.confidence ?? 0)) return false;
  if (pending) return true;
  if (!state.focusOrder?.id) return false;
  if (!t || isTrivialWhatsappTurn(t) || isThanksText(t)) return false;
  return true;
}

export function waitingLabel(pendingIntent: string, payload: PendingPayload = {}): string {
  if (pendingIntent === RESUME_CONTEXT_INTENT) {
    return 'si seguimos con lo anterior o empezamos de nuevo (SÍ / NO)';
  }
  if (pendingIntent === 'select_client') return 'que elija el cliente de la lista (un número)';
  if (pendingIntent === 'select_product') return 'que elija el producto de la lista (un número)';
  if (pendingIntent === 'select_purchase_pack') return 'que elija cómo cargar el pack (1 o 2)';
  if (pendingIntent === 'select_purchase_unknowns') {
    return 'que elija un número para vincularlo o descartarlo';
  }
  if (pendingIntent === 'select_purchase_non_catalog') {
    return 'que elija descartar o cargarlo como gasto';
  }
  if (pendingIntent === 'select_supplier') return 'que elija el proveedor de la lista (un número)';
  if (pendingIntent === 'select_payment' || pendingIntent === 'select_card') {
    return 'que elija cómo paga';
  }
  if (pendingIntent === 'select_cash_ambito') {
    return 'que elija la caja (un número o el nombre: negocio, personal)';
  }
  if (pendingIntent === 'select_order') {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    return candidates.length
      ? 'que elija el pedido de la lista (un número)'
      : 'un dato para encontrar el pedido (cliente, producto, monto o número)';
  }
  if (pendingIntent === 'select_payment_kind') {
    return 'si es cobro de un pedido o un movimiento suelto de caja';
  }
  if (pendingIntent === 'order_action') {
    return 'qué hacer con el pedido (1 pago, 2 estado)';
  }
  if (pendingIntent === 'settle_order') {
    return 'si cobra el saldo (SÍ, un monto, o NO)';
  }
  if (pendingIntent === STOCK_RESOLUTION_INTENT) {
    return 'cómo descontar el stock (todo el pedido, o NO)';
  }
  if (pendingIntent === 'help_topic') {
    return 'que elija un número del listado, o cómo hacer algo';
  }
  if (pendingIntent === COLLECT_ORDER_ITEMS_INTENT) {
    return 'los productos del pedido (por tandas) y LISTO cuando termine';
  }
  if (pendingIntent === 'confirm_create_client') return 'confirmar si crea el cliente (SÍ / NO)';
  if (pendingIntent === 'confirm_create_product') return 'confirmar si crea el producto (SÍ / NO)';
  if (pendingIntent === 'confirm_create_supplier') return 'confirmar si crea el proveedor (SÍ / NO)';
  if (pendingIntent === 'clarify') {
    const missing = missingFieldOf(payload);
    if (missing === 'deliveryDate') return 'la fecha de entrega (mañana, viernes, 28/08)';
    if (missing === 'extraCosts') {
      return 'el costo extra y el importe, o NO';
    }
    if (missing === 'extraCostsItem') {
      return 'a qué producto corresponde el costo extra';
    }
    if (missing === 'notes') return 'la descripción del pedido, o LISTO';
    if (missing === 'client' || missing === 'clientName') return 'el nombre del cliente';
    if (missing === 'productName') return 'el producto';
    if (missing === 'amount') return 'el precio';
    return 'el dato que faltaba';
  }
  if (pendingIntent.startsWith(CONFIRM_PREFIX)) return 'confirmar si guarda (SÍ / NO)';
  return 'seguir con lo que estábamos haciendo';
}

export function reconstructPendingPrompt(
  pendingIntent: string,
  payload: PendingPayload
): string {
  const entities = payloadEntities(payload);
  const query = String(payload.query ?? '').trim();
  const allowCreate = payload.allowCreate !== false;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

  if (pendingIntent === RESUME_CONTEXT_INTENT) {
    return formatResumeAsk({
      pendingIntent: String(payload.previousIntent ?? ''),
      pendingPayload:
        payload.previousPayload && typeof payload.previousPayload === 'object'
          ? (payload.previousPayload as PendingPayload)
          : {},
      focusOrder:
        payload.previousFocus && typeof payload.previousFocus === 'object'
          ? (payload.previousFocus as { id?: string; label?: string; clientName?: string })
          : null,
    });
  }
  if (pendingIntent === COLLECT_ORDER_ITEMS_INTENT) {
    return formatCollectOrderItemsAsk({
      clientName: entities.clientName,
      expectedCount: entities.expectedItemCount,
      itemCount: entities.items?.length,
    });
  }
  if (pendingIntent === 'select_client') {
    return formatClientChoices(
      candidates as Array<{ nombre: string }>,
      query || entities.clientName,
      { allowCreate }
    );
  }
  if (pendingIntent === 'select_supplier') {
    return formatSupplierChoices(candidates as Array<{ nombre: string }>, query, { allowCreate });
  }
  if (pendingIntent === 'select_product') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    return formatProductChoices(
      candidates as Array<{ nombre: string; label?: string; precioVenta?: number }>,
      query || line?.invoiceName || entities.productName,
      {
        allowCreate,
        context: String(payload.originalIntent ?? '') === 'create_purchase' ? 'purchase' : 'order',
        lineIndex: Number.isInteger(lineIdx) ? lineIdx : undefined,
        lineCount: Array.isArray(entities.purchaseLines) ? entities.purchaseLines.length : undefined,
        unitCost: line ? Number(line.unitCost) || 0 : undefined,
        unitCostNet: line ? Number(line.unitCostNet) || undefined : undefined,
        quantity: line ? Number(line.quantity) || undefined : undefined,
        packUnits: line ? Number(line.packUnits) || undefined : undefined,
        hasMore: Array.isArray(payload.hiddenCandidates) && payload.hiddenCandidates.length > 0,
        morePage: Number(payload.choicePage) > 1,
      }
    );
  }
  if (pendingIntent === 'select_purchase_unknowns') {
    return formatPurchaseUnknownsPrompt(entities, {
      followUp: entities.purchaseUnknownsAsked === true,
    });
  }
  if (pendingIntent === 'select_purchase_non_catalog') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    return line
      ? formatPurchaseNonCatalogChoices(line)
      : '¿Lo descarto o lo cargo como gasto?';
  }
  if (pendingIntent === 'select_purchase_pack') {
    const lineIdx = Number(payload.lineIndex);
    const line =
      Number.isInteger(lineIdx) && lineIdx >= 0 ? entities.purchaseLines?.[lineIdx] : undefined;
    if (!line) return '¿Cómo cargo el pack? 1 = unidades sueltas · 2 = como el renglón.';
    return formatPurchasePackChoices(line, {
      lineIndex: lineIdx,
      lineCount: entities.purchaseLines?.length,
    });
  }
  if (pendingIntent === 'select_cash_ambito') {
    const ambitos = candidates.map((candidate) => {
      const row = candidate as { id?: string; nombre?: string; label?: string };
      return {
        id: String(row.id ?? ''),
        label: String(row.label || row.nombre || row.id || ''),
      };
    });
    return formatCashAmbitoChoices(ambitos, entities.cashType);
  }
  if (pendingIntent === 'select_order') {
    const orders = candidates as OrderStatusTarget[];
    const clientHint = String(entities.clientName ?? payload.query ?? '').trim();
    return orders.length
      ? formatOpenOrderChoices(orders, '¿Cuál? Número de la lista.\nDespués cobrás, lo asociás o le cambiás el *estado*.')
      : formatFindOrderGuide({
          paymentAmount: Number(entities.amount) || undefined,
          triedHint: clientHint || undefined,
          forQuery: String(payload.originalIntent ?? '') === 'query_status',
        });
  }
  if (pendingIntent === 'select_payment_kind') {
    const amount = Number(entities.amount) || 0;
    return waCard({
      title: '¿Cómo lo registro?',
      lines: [
        amount > 0 ? `Tengo $${amount.toLocaleString('es-AR')}.` : 'Llegó plata.',
        '• *1* cobro de un pedido',
        '• *2* ingreso suelto de caja',
      ],
      ask: 'O decime el cliente / el producto. Si es un *egreso*, escribilo así.',
    });
  }
  if (pendingIntent === 'order_action') {
    const picked = payload.picked as OrderStatusTarget | undefined;
    const step = String(payload.step ?? 'action');
    if (picked?.id && step === 'status') return formatOrderStatusAsk(picked);
    if (picked?.id && step === 'amount') return formatPaymentAmountAsk(picked);
    if (picked?.id) return formatOrderActionAsk(picked);
    return '¿Registro un pago o le cambio el estado?';
  }
  if (pendingIntent === 'settle_order') {
    const label = String(entities.targetOrderLabel ?? '').trim();
    const saldo = Number(entities.targetOrderSaldo) || 0;
    return formatSettleAsk(label, String(entities.clientName ?? ''), saldo);
  }
  if (pendingIntent === STOCK_RESOLUTION_INTENT) {
    const ask = payload.stockAsk as StockDiscountAsk | undefined;
    if (ask?.options?.length) return formatStockResolutionAsk(ask);
    return String(payload.pendingPrompt ?? '¿Descuento el stock de todo el pedido? SÍ / NO');
  }
  if (pendingIntent === 'help_topic') {
    return riloBotHelpMenu();
  }
  if (pendingIntent === 'confirm_create_client') {
    const name = String(payload.proposedName ?? entities.clientName ?? query).trim();
    return waCard({
      title: 'Cliente nuevo',
      lines: [`No encontré *${name}*.`],
      ask: `${waBold('SÍ')} = lo registro y sigo\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'confirm_create_product') {
    const name = String(payload.proposedName ?? entities.productName ?? query).trim();
    if (String(payload.originalIntent ?? '') === 'create_purchase') {
      return waCard({
        title: 'Este ítem',
        lines: [`No encontré *${name}* en el catálogo.`],
        ask:
          `${waBold('SÍ')} = crear (suma stock)\n` +
          `${waBold('INSUMO')} = gasto sin stock\n` +
          `${waBold('SALTAR')} · otro nombre = busco\n` +
          `${waBold('NO')} = cancelar todo`,
      });
    }
    const unit = Number(entities.amount) || 0;
    const priceHint = unit > 0 ? ` a $${unit}` : '';
    return waCard({
      title: 'Producto nuevo',
      lines: [
        `No encontré *${name}* en el catálogo.`,
        'Si lo creo, queda para pedidos/ventas (sin control de stock).',
      ],
      ask: `${waBold('SÍ')} = crear y usar${priceHint}\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'confirm_create_supplier') {
    const name = String(payload.proposedName ?? entities.supplierName ?? query).trim();
    return waCard({
      title: 'Proveedor nuevo',
      lines: [`No encontré *${name}*.`],
      ask: `${waBold('SÍ')} = lo registro y sigo\nOtro nombre · ${waBold('NO')} = cancelar`,
    });
  }
  if (pendingIntent === 'clarify') {
    const missing = missingFieldOf(payload);
    if (missing === 'deliveryDate') {
      return presentOrderCollecting(entities, '📅 ¿Para qué fecha es la entrega?');
    }
    if (missing === 'extraCosts') {
      return presentOrderCollecting(entities, ORDER_EXTRA_COST_ASK);
    }
    if (missing === 'extraCostsItem') {
      return formatExtraCostItemAsk(entities.extraCosts ?? [], entities);
    }
    if (missing === 'notes') {
      return waCard({
        title: 'Descripción',
        lines: ['Ubicación del estampado, frase, observaciones.'],
        ask: `${waBold('LISTO')} = sin descripción.`,
      });
    }
    return waCard({
      title: 'Seguimos',
      ask: `Pasame lo que te pedí, o ${waBold('NO')} para cancelar.`,
    });
  }
  if (pendingIntent.startsWith(CONFIRM_PREFIX)) {
    const intent = pendingIntent.slice(CONFIRM_PREFIX.length);
    if (intent === 'create_purchase') {
      const pages = formatPurchaseConfirmationMessages(entities);
      return pages[pages.length - 1] ?? formatOperationSummary(intent, entities);
    }
    const pages = presentTransaction(intent, entities);
    return pages[pages.length - 1] ?? formatOperationSummary(intent, entities);
  }
  return 'Seguimos con lo de antes. Pasame el número, SÍ/NO, o lo que te pedí.';
}

/** Guarda fecha/precio si los tiró al pasar, sin cambiar de paso. */
export function stashAsideFacts(
  text: string,
  entities: WhatsappCommandEntities
): WhatsappCommandEntities {
  const next = { ...entities };
  if (!next.deliveryDate) {
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) {
      next.deliveryDate = delivery;
      next.deliveryAsked = true;
      next.deliveryDefaulted = undefined;
    }
  }
  if (next.amount == null && !looksLikeCashMovement(text)) {
    const amount = extractAmountFromText(text);
    if (amount != null) next.amount = amount;
  }
  return next;
}

export function mergeStashIntoPayload(payload: PendingPayload, text: string): PendingPayload {
  const next = { ...payload };
  if (next.entities && typeof next.entities === 'object' && !Array.isArray(next.entities)) {
    next.entities = stashAsideFacts(text, { ...(next.entities as WhatsappCommandEntities) });
    return next;
  }
  return stashAsideFacts(text, next as WhatsappCommandEntities) as PendingPayload;
}

function isDateOnlyUtterance(text: string): boolean {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 4) return false;
  return Boolean(extractDeliveryDateFromText(t));
}

/** El mensaje resuelve el paso actual (número, SÍ/NO, fecha, nombre). Si no, hay que volver al contexto. */
export function doesFillCurrentSlot(
  text: string,
  pendingIntent: string,
  payload: PendingPayload
): boolean {
  const t = String(text ?? '').trim();
  if (!t || !pendingIntent) return true;
  if (pendingIntent === RESUME_CONTEXT_INTENT) {
    return looksLikeResumeYes(t) || looksLikeResumeNo(t);
  }
  if (CONFIRM_NO.test(t) || /^cancelar$/i.test(t)) return true;
  if (looksLikePendingQuestion(t)) return false;
  if (looksLikeIterativeCorrection(t)) return true;

  if (/^\d{1,2}$/.test(t)) return true;
  if (/^(crear|nuevo)$/i.test(t)) return true;

  const missing = missingFieldOf(payload);

  if (pendingIntent === 'clarify' && missing === 'deliveryDate') {
    if (/^(listo|nada|sin fecha|sin fecha de entrega|despu[eé]s|despues|ahora no|-)$/i.test(t)) {
      return true;
    }
    return Boolean(extractDeliveryDateFromText(t));
  }

  if (pendingIntent === 'clarify' && (missing === 'extraCosts' || missing === 'extraCostsItem')) {
    if (/^(si|sí|no|n|ok|dale)$/i.test(t)) return true;
    return t.length >= 1;
  }

  if (pendingIntent === 'clarify' && (missing === 'itemColor' || missing === 'itemSize')) {
    return t.length >= 1;
  }

  if (pendingIntent === 'select_client' || pendingIntent === 'select_supplier') {
    if (isDateOnlyUtterance(t) || isUnlikelyPersonName(t)) return false;
    return t.length >= 2 && t.length <= 80;
  }

  if (pendingIntent === 'select_product') {
    if (isDateOnlyUtterance(t)) return false;
    return t.length >= 2;
  }

  if (pendingIntent === 'select_purchase_unknowns') {
    if (looksLikePendingQuestion(t)) return false;
    return t.length >= 1;
  }

  if (pendingIntent === 'select_purchase_non_catalog') {
    if (looksLikePendingQuestion(t)) return false;
    return /^(1|2|descartar|saltar|omitir|insumo|gasto|sacar|sacalo|sacálo)$/i.test(t) || t.length <= 40;
  }

  if (pendingIntent === 'select_purchase_pack') {
    if (looksLikePendingQuestion(t)) return false;
    return /^(1|2|3|4|pack|rengl[oó]n|linea|línea|insumo|herramienta|saltar)$/i.test(t) || t.length <= 40;
  }

  if (
    pendingIntent === 'confirm_create_client' ||
    pendingIntent === 'confirm_create_product' ||
    pendingIntent === 'confirm_create_supplier'
  ) {
    return CONFIRM_YES.test(t) || t.length >= 2;
  }

  if (pendingIntent.startsWith(CONFIRM_PREFIX)) {
    if (CONFIRM_YES.test(t)) return true;
    if (looksLikePendingQuestion(t) || looksLikeNewOrder(t) || looksLikeCashMovement(t)) return false;
    return (
      looksLikeOrderStatusUpdate(t) ||
      looksLikeIterativeCorrection(t) ||
      /(?<![\p{L}])(sald|pag[oó]|cobr|se[nñ]a|estado|entregad|listo)(?![\p{L}])/iu.test(t) ||
      Boolean(extractAmountFromText(t))
    );
  }

  if (pendingIntent === 'select_payment' || pendingIntent === 'select_card') {
    return t.length >= 1;
  }

  if (pendingIntent === 'select_cash_ambito') {
    if (looksLikePendingQuestion(t)) return false;
    return /^\d{1,2}$/.test(t) || (t.length >= 2 && t.length <= 80);
  }

  if (pendingIntent === 'select_order') {
    if (looksLikePendingQuestion(t) || looksLikeNewOrder(t)) return false;
    return (
      /^\d{1,2}\b/.test(t) ||
      /#?\d{3,}/.test(t) ||
      /(?<![\p{L}])(listo|sald|pag[oó]|cobr)(?![\p{L}])/iu.test(t) ||
      (t.length >= 2 && t.length <= 80)
    );
  }

  if (pendingIntent === 'select_payment_kind') {
    if (looksLikePendingQuestion(t)) return false;
    return t.length >= 1;
  }

  if (pendingIntent === 'order_action' || pendingIntent === 'settle_order') {
    if (looksLikePendingQuestion(t) || looksLikeNewOrder(t)) return false;
    return (
      CONFIRM_YES.test(t) ||
      CONFIRM_NO.test(t) ||
      /(?<![\p{L}])(listo|pronto|termin|sald|pag[oó]|cobr|se[nñ]a|estado|despu[eé]s)(?![\p{L}])/iu.test(t) ||
      Boolean(extractAmountFromText(t)) ||
      /^\d/.test(t)
    );
  }

  if (pendingIntent === STOCK_RESOLUTION_INTENT) {
    if (looksLikePendingQuestion(t)) return false;
    if (looksLikeNewOrder(t) || looksLikeCashMovement(t)) return false;
    const choice = interpretStockResolutionFromText(t);
    if (choice.action) return true;
    if (looksLikeStatusQuery(t) && !choice.leftover) return false;
    return true;
  }

  if (pendingIntent === COLLECT_ORDER_ITEMS_INTENT) {
    if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return false;
    if (looksLikePendingQuestion(t)) return false;
    if (looksLikeCollectingDone(t)) return true;
    return t.length >= 2;
  }

  if (pendingIntent === 'help_topic') {
    return true;
  }

  return true;
}

/**
 * El último mensaje es otra operación (egreso, pedido nuevo, compra), no una
 * respuesta al paso pendiente. Hay que soltar el contexto anterior.
 */
export function isFreshTaskUtterance(text: string, pendingIntent: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || !pendingIntent) return false;
  if (pendingIntent === RESUME_CONTEXT_INTENT) return hasExplicitCompleteIntent(t);
  if (pendingIntent === COLLECT_ORDER_ITEMS_INTENT) {
    if (utteranceIsHowTo(t) || utteranceIsCapabilityQuestion(t)) return false;
    if (looksLikeCashMovement(t) || looksLikeOrderStatusUpdate(t) || looksLikeStatusQuery(t)) return true;
    if (looksLikeNewOrder(t) && !looksLikeCollectingDone(t)) return true;
    return false;
  }
  if (/^\d{1,2}$/.test(t)) return false;
  if (/^(si|sí|ok|dale|confirmo|yes|y|no+|nop|cancelar|n)$/i.test(t)) return false;
  if (pendingIntent === 'select_cash_ambito') return false;
  if (pendingIntent === STOCK_RESOLUTION_INTENT) {
    if (looksLikeCashMovement(t) || looksLikeNewOrder(t)) return true;
    if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
    return false;
  }
  if (pendingIntent === 'clarify') {
    if (looksLikeCashMovement(t)) return true;
    if (looksLikeNewOrder(t)) return true;
    if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
    return false;
  }
  const confirming = pendingIntent.startsWith(CONFIRM_PREFIX);
  const onThisOrder =
    confirming ||
    pendingIntent === 'select_order' ||
    pendingIntent === 'order_action' ||
    pendingIntent === 'settle_order';
  if (onThisOrder && looksLikeOrderStatusUpdate(t)) return false;
  if (confirming) {
    if (looksLikeCashMovement(t)) return true;
    if (looksLikeNewOrder(t)) return true;
    if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
    return false;
  }
  if (looksLikeCashMovement(t)) return true;
  if (looksLikeOrderStatusUpdate(t)) return true;
  if (
    (looksLikeListOrders(t) || looksLikeStatusQuery(t)) &&
    pendingIntent !== 'select_order' &&
    pendingIntent !== 'order_action'
  ) {
    return true;
  }
  if (CASH_QUERY_FRESH.test(t)) return true;
  if (PURCHASE_FRESH.test(t) && !/\bpedido\b/i.test(t)) return true;
  if (
    looksLikeOrphanPayment(t) &&
    pendingIntent !== 'select_order' &&
    pendingIntent !== 'select_payment_kind' &&
    pendingIntent !== 'order_action' &&
    pendingIntent !== 'settle_order'
  ) {
    return true;
  }
  if (
    looksLikeNewOrder(t) &&
    (pendingIntent === 'select_order' ||
      pendingIntent === 'select_payment_kind' ||
      pendingIntent === 'order_action' ||
      pendingIntent === 'settle_order')
  ) {
    return true;
  }
  return false;
}
