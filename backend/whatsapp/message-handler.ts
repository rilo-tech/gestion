import { getBusiness } from '../auth/business.ts';
import { assertCanUseAi, formatThrownUsage, isUsageLimitError, resolveBillingMode, assertCanSendWhatsapp, whatsappQuotaNoticeOrSilent, maybeWhatsappQuotaWarning } from '../auth/usage-gates.ts';
import { resolveTenantByPhone, type WhatsappTenantContext } from './tenant-resolver.ts';
import { assertWhatsappFeatures } from './feature-guard.ts';
import {
  clearConversationState,
  getConversationState,
  rememberLastOperation,
  saveConversationState,
  type LastWhatsappOperation,
} from './conversation-state.ts';
import {
  parseWhatsappCommand,
  applyEntityUpdates,
  sanitizeWhatsappEntities,
  looksLikeListOrders,
  looksLikeCashMovement,
  looksLikeOrderStatusUpdate,
  type ParsedWhatsappCommand,
  type WhatsappCommandEntities,
} from './ai-command-parser.ts';
import { executeWhatsappCommand } from './erp-integration.ts';
import {
  beginWelcome,
  handleOnboardingPending,
  isOnboardingIntent,
  isSetupReopenText,
  reopenSetupMenu,
  startSetupStep,
} from './onboarding.ts';
import { downloadWhatsappMedia } from './meta-api.ts';
import { looksLikePendingQuestion, answerWhileWaiting } from './operator-voice.ts';
import {
  doesFillCurrentSlot,
  isFreshTaskUtterance,
  mergeStashIntoPayload,
  reconstructPendingPrompt,
  waitingLabel,
} from './conversation-follow.ts';
import {
  extractAmountFromText,
  extractClientHintFromText,
  extractRegisterClientFromText,
  extractDeliveryDateFromText,
  extractNotesHintFromText,
  extractProductHintFromText,
  extractSpokenCorrections,
  extractExtraCostsFromText,
  mergeExtraCostItems,
  formatExtraCostsHint,
  formatClientChoices,
  formatOperationSummary,
  formatPurchaseConfirmationMessages,
  formatProductChoices,
  formatSupplierChoices,
  formatPurchaseTicketDigest,
  formatPurchaseUnknownsPrompt,
  parsePurchaseUnknownsReply,
  unresolvedPurchaseLineIndexes,
  looksLikeNonCatalogPurchaseLine,
  formatPurchaseNonCatalogChoices,
  formatPurchasePackChoices,
  applyPurchasePackChoice,
  inferPurchasePackUnits,
  parsePurchaseLineDisposition,
  purchaseDispositionChoiceIndexes,
  isGenericWhatsappNotes,
  sanitizeOrderNotes,
  isUnlikelyPersonName,
  looksLikeIterativeCorrection,
  looksLikeNewOrder,
  looksLikeStatusQuery,
  extractQueryClientFromText,
  extractOrderNumberFromText,
  resolveClientMatch,
  resolveProductMatch,
  resolveSupplierMatch,
  todayDateOnly,
  type MatchedClient,
  type MatchedStockItem,
} from './lookups.ts';
import {
  applyOrderDateDefault,
  formatMissingFieldsReply,
  missingRequiredFields,
} from './required-fields.ts';
import {
  createCatalogProductFromWhatsapp,
  createClientFromWhatsapp,
  createSupplierFromWhatsapp,
  fillExtraCostsFromPresets,
  resolveOrderForCost,
} from './erp-writes.ts';
import {
  formatFindOrderGuide,
  formatOpenOrderChoices,
  formatOrderActionAsk,
  formatSettleAsk,
  listOpenOrdersForWhatsapp,
  previewOrderStatusChange,
  resolveOrderForStatus,
  type OrderStatusTarget,
} from './order-status.ts';
import { handleUnregisteredWhatsapp } from './unregistered-signup.ts';
import { askWhatYouMeant } from './clarify.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { handleHelpTurn, HELP_TOPIC_INTENT, isHelpFollowUp, matchSetupLoad } from './help.ts';
import { isThanksText } from '../../shared/whatsapp-copy.ts';
import { splitWaBubbles, waBold, waCard } from '../../shared/whatsapp-format.ts';
import {
  applyCardToEntities,
  applyDraftToEntities,
  applyMedioToEntities,
  cardsForMedio,
  extractPaymentCuotas,
  formatCardChoices,
  formatPaymentChoices,
  isDraftRequest,
  loadPurchasePaymentContext,
  matchMedioFromText,
  paymentNeedsCard,
  SELECT_CARD_INTENT,
  SELECT_PAYMENT_INTENT,
} from './purchase-payment.ts';
import { saveProductAlias, saveInsumoAlias, findProductAlias } from './product-aliases.ts';
import { rememberConfirmedOperation } from './operator-memory.ts';
import {
  SELECT_CASH_AMBITO_INTENT,
  applyCashAmbitoToEntities,
  cleanCashConcept,
  formatCashAmbitoChoices,
  loadWhatsappCajaAmbitos,
  resolveSpokenCashAmbito,
} from './cash-ambito.ts';
import { matchCashAmbitoFromText, type CajaAmbitoConfig } from '../utils/caja-ambitos.ts';

export interface WhatsappInboundMessage {
  from: string;
  text?: string;
  mediaId?: string | null;
  mediaType?: string | null;
}

export interface WhatsappHandlerResult {
  reply: string;
  /** Si hay varios, el webhook los manda en orden (resumen largo de compra). */
  replies?: string[];
  intent: string;
  executed: boolean;
  businessId?: string;
}

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
/** ~60–90 s de nota de voz Opus de WhatsApp. */
const MAX_AUDIO_BYTES = 200 * 1024;
const CONFIRM_NO = /^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i;
const SELECT_CLIENT_INTENT = 'select_client';
const SELECT_PRODUCT_INTENT = 'select_product';
const SELECT_PURCHASE_PACK_INTENT = 'select_purchase_pack';
const SELECT_PURCHASE_UNKNOWNS_INTENT = 'select_purchase_unknowns';
const SELECT_PURCHASE_NON_CATALOG_INTENT = 'select_purchase_non_catalog';
const SELECT_SUPPLIER_INTENT = 'select_supplier';
const CLARIFY_INTENT = 'clarify';
const SELECT_ORDER_INTENT = 'select_order';
const SELECT_PAYMENT_KIND_INTENT = 'select_payment_kind';
const CASH_OUT_HINT = /\b(egreso|gasto|salida)\b/i;
const ORDER_PAY_HINT =
  /(?<![\p{L}])(pag[oó]|cobr|abon|se[nñ]a|sald(?:alo|ar)|pago\s+del\s+total|ya\s+pag[oó])(?![\p{L}])/iu;
const ORDER_ACTION_INTENT = 'order_action';
const SETTLE_ORDER_INTENT = 'settle_order';
const CONFIRM_CREATE_CLIENT = 'confirm_create_client';
const CONFIRM_CREATE_PRODUCT = 'confirm_create_product';
const CONFIRM_CREATE_SUPPLIER = 'confirm_create_supplier';
const CONFIRM_INTENT_PREFIX = 'confirm:';

type NamedCandidate = { id: string; nombre: string; label?: string; score?: number; precioVenta?: number };

function extraCostsDeliveryAsk(entities: WhatsappCommandEntities): string {
  const extra = formatExtraCostsHint(entities);
  return waCard({
    title: 'Fecha de entrega',
    lines: extra ? [`Tengo ${extra}.`] : undefined,
    ask: `Ej: viernes, 28/08.\n${waBold('LISTO')} = la dejo para hoy.`,
  });
}

function lastOperationFromResult(
  result: { data?: Record<string, unknown> },
  entities: WhatsappCommandEntities
): LastWhatsappOperation | null {
  const data = result.data ?? {};
  const kind = data.kind as LastWhatsappOperation['kind'] | undefined;
  const id = String(data.recordId ?? data.orderId ?? data.ventaId ?? data.compraId ?? data.clientId ?? '').trim();
  if (!kind || !id) return null;
  const amount = Number(data.amount ?? entities.amount);
  return {
    kind,
    id,
    label: String(data.label ?? '').trim() || undefined,
    clientName: String(data.clientName ?? entities.clientName ?? '').trim() || undefined,
    amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    at: new Date().toISOString(),
  };
}

function isSubscriptionBlocked(business: Awaited<ReturnType<typeof getBusiness>>): boolean {
  if (!business) return true;
  if (business.estadoSuscripcion !== 'activa') return true;
  return resolveBillingMode(business) === 'blocked';
}

/** Toda operación de negocio pide resumen + SÍ/NO. */
function needsConfirmation(intent: string): boolean {
  return [
    'create_order',
    'create_sale',
    'create_purchase',
    'register_payment',
    'register_cash',
    'create_client',
    'register_cost',
    'update_product_cost',
    'update_order_status',
  ].includes(intent);
}

function needsClient(intent: string): boolean {
  return ['create_order', 'create_sale', 'register_payment', 'query_balance'].includes(intent);
}

function needsSupplier(intent: string): boolean {
  return intent === 'create_purchase';
}

function needsAmount(intent: string): boolean {
  return ['create_order', 'create_sale', 'register_payment', 'register_cash', 'update_product_cost'].includes(intent);
}

function preferCatalogChoices(intent: string): boolean {
  return [
    'create_order',
    'create_sale',
    'create_purchase',
    'update_product_cost',
    'create_client',
    'register_payment',
    'query_balance',
  ].includes(intent);
}

function unitPriceFromEntities(entities: WhatsappCommandEntities): number {
  const qty = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  return amount > 0 ? amount / qty : 0;
}

function entitiesFromParsed(
  parsed: ParsedWhatsappCommand,
  mediaId?: string | null
): WhatsappCommandEntities {
  const entities: WhatsappCommandEntities =
    'entities' in parsed ? { ...(parsed.entities ?? {}) } : {};
  if (mediaId) entities.mediaId = mediaId;
  if (!String(entities.sourceText ?? '').trim() && 'raw' in parsed) {
    entities.sourceText = String(parsed.raw ?? '');
  }
  // En un cobro suelto, la seña ES el monto a cobrar.
  if (parsed.intent === 'register_payment' && !entities.amount && entities.seniaAmount) {
    entities.amount = entities.seniaAmount;
  }
  return entities;
}

function ensurePurchaseLines(entities: WhatsappCommandEntities): void {
  if (Array.isArray(entities.purchaseLines) && entities.purchaseLines.length) {
    entities.purchaseLines = entities.purchaseLines.map((line) => {
      const invoiceName = String(line.invoiceName ?? line.productName ?? '').trim() || undefined;
      const pack =
        Number(line.packUnits) >= 2 ? Number(line.packUnits) : inferPurchasePackUnits(invoiceName || '');
      return {
        ...line,
        invoiceName,
        ...(pack >= 2 ? { packUnits: pack } : {}),
      };
    });
    return;
  }
  const name = String(entities.productName ?? '').trim();
  if (!name) return;
  const quantity = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  entities.purchaseLines = [
    {
      productName: name,
      invoiceName: name,
      productId: entities.productId,
      quantity,
      unitCost: amount > 0 ? amount / quantity : 0,
    },
  ];
}

function purchaseLineIndex(payload: Record<string, unknown>): number | null {
  const raw = Number(payload.lineIndex);
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function purchaseLineCost(
  entities: WhatsappCommandEntities,
  payload: Record<string, unknown>
): number {
  const idx = purchaseLineIndex(payload);
  if (idx == null) return 0;
  return Number(entities.purchaseLines?.[idx]?.unitCost) || 0;
}

function purchaseLineAt(
  entities: WhatsappCommandEntities,
  index: number
): NonNullable<WhatsappCommandEntities['purchaseLines']>[number] | undefined {
  return entities.purchaseLines?.[index];
}

function purchaseChoiceOpts(
  entities: WhatsappCommandEntities,
  index: number
): {
  allowCreate: boolean;
  lineIndex: number;
  lineCount: number;
  unitCost: number;
  unitCostNet?: number;
  quantity?: number;
  packUnits?: number;
  context: 'purchase';
} {
  const line = purchaseLineAt(entities, index);
  return {
    allowCreate: true,
    lineIndex: index,
    lineCount: Array.isArray(entities.purchaseLines) ? entities.purchaseLines.length : 1,
    unitCost: Number(line?.unitCost) || 0,
    unitCostNet: Number(line?.unitCostNet) || undefined,
    quantity: Number(line?.quantity) || undefined,
    packUnits: Number(line?.packUnits) || undefined,
    context: 'purchase',
  };
}

function withPurchaseDigest(entities: WhatsappCommandEntities, body: string): string {
  if (entities.purchaseDigestShown) return body;
  entities.purchaseDigestShown = true;
  return `${formatPurchaseTicketDigest(entities)}\n\n${body}`;
}

function renderPurchaseUnknowns(entities: WhatsappCommandEntities): string {
  return formatPurchaseUnknownsPrompt(entities, {
    followUp: entities.purchaseUnknownsAsked === true,
  });
}

function needsPurchasePackAsk(line: {
  packUnits?: number;
  packResolved?: boolean;
  skipped?: boolean;
  tipoLinea?: string;
  invoiceName?: string;
  productName?: string;
}): boolean {
  if (line.skipped || line.tipoLinea === 'insumo') return false;
  if (line.packResolved) return false;
  const pack =
    Number(line.packUnits) ||
    inferPurchasePackUnits(String(line.invoiceName ?? line.productName ?? ''));
  return pack >= 2;
}

function applyPurchaseLineSkip(
  entities: WhatsappCommandEntities,
  payload: Record<string, unknown>
): boolean {
  const idx = purchaseLineIndex(payload);
  if (idx == null) return false;
  const lines = [...(entities.purchaseLines ?? [])];
  const current = lines[idx];
  if (!current) return false;
  lines[idx] = { ...current, skipped: true, productId: undefined, tipoLinea: undefined };
  entities.purchaseLines = lines;
  return true;
}

function applyPurchaseLineInsumo(
  entities: WhatsappCommandEntities,
  payload: Record<string, unknown>
): boolean {
  const idx = purchaseLineIndex(payload);
  if (idx == null) return false;
  const lines = [...(entities.purchaseLines ?? [])];
  const current = lines[idx];
  if (!current) return false;
  const invoiceName = String(current.invoiceName ?? current.productName ?? '').trim();
  lines[idx] = {
    ...current,
    skipped: false,
    tipoLinea: 'insumo',
    productId: undefined,
    productName: invoiceName || current.productName,
    invoiceName: invoiceName || current.invoiceName,
  };
  entities.purchaseLines = lines;
  return true;
}

function resumePurchaseWithDisposition(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities,
  payload: Record<string, unknown>,
  disposition: 'skip' | 'insumo',
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (disposition === 'skip') applyPurchaseLineSkip(entities, payload);
  else applyPurchaseLineInsumo(entities, payload);
  const idx = purchaseLineIndex(payload);
  const line = idx != null ? purchaseLineAt(entities, idx) : undefined;
  const invoiceName = String(line?.invoiceName ?? line?.productName ?? '').trim();
  if (disposition === 'insumo' && invoiceName) {
    return saveInsumoAlias(businessId, invoiceName).then(() =>
      prepareOperation(businessId, phone, 'create_purchase', entities, rubro)
    );
  }
  return prepareOperation(businessId, phone, 'create_purchase', entities, rubro);
}

async function askPurchaseLineCatalog(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities,
  lineIndex: number
): Promise<WhatsappHandlerResult> {
  const line = purchaseLineAt(entities, lineIndex);
  const productQuery = String(line?.invoiceName ?? line?.productName ?? '').trim();
  if (!line || !productQuery) {
    return prepareOperation(businessId, phone, 'create_purchase', entities);
  }
  entities.purchaseUnknownsAsked = true;
  if (looksLikeNonCatalogPurchaseLine(productQuery)) {
    const discardReply = formatPurchaseNonCatalogChoices(line);
    await saveConversationState(businessId, phone, {
      pendingIntent: SELECT_PURCHASE_NON_CATALOG_INTENT,
      pendingPayload: { originalIntent: 'create_purchase', lineIndex, entities },
      pendingPrompt: discardReply,
    });
    return {
      reply: discardReply,
      intent: SELECT_PURCHASE_NON_CATALOG_INTENT,
      executed: false,
      businessId,
    };
  }
  const resolved = await resolveProductMatch(businessId, productQuery, {
    preferChoices: true,
    utterance: [entities.sourceText, line.invoiceName, productQuery].filter(Boolean).join('\n'),
  });
  const candidates: MatchedStockItem[] =
    resolved.status === 'unique'
      ? [resolved.product]
      : resolved.status === 'ambiguous'
        ? resolved.candidates
        : [];
  const query = resolved.status === 'none' ? productQuery : resolved.query;
  const productReply = formatProductChoices(candidates, query, purchaseChoiceOpts(entities, lineIndex));
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_PRODUCT_INTENT,
    pendingPayload: {
      originalIntent: 'create_purchase',
      query,
      lineIndex,
      entities,
      allowCreate: true,
      candidates: candidates.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        label: c.label,
        score: c.score,
        precioVenta: c.precioVenta,
      })),
    },
    pendingPrompt: productReply,
  });
  return {
    reply: productReply,
    intent: SELECT_PRODUCT_INTENT,
    executed: false,
    businessId,
  };
}

async function applyDispositionToLines(
  businessId: string,
  entities: WhatsappCommandEntities,
  lineIndexes: number[],
  disposition: 'skip' | 'insumo'
): Promise<void> {
  for (const idx of lineIndexes) {
    const payload = { lineIndex: idx };
    if (disposition === 'skip') {
      applyPurchaseLineSkip(entities, payload);
      continue;
    }
    applyPurchaseLineInsumo(entities, payload);
    const line = purchaseLineAt(entities, idx);
    const invoiceName = String(line?.invoiceName ?? line?.productName ?? '').trim();
    if (invoiceName) await saveInsumoAlias(businessId, invoiceName);
  }
}

function applyProductToEntities(
  entities: WhatsappCommandEntities,
  productId: string,
  productName: string,
  payload: Record<string, unknown>
): void {
  const idx = purchaseLineIndex(payload);
  if (idx != null) {
    const lines = [...(entities.purchaseLines ?? [])];
    const current = lines[idx];
    if (current) {
      lines[idx] = {
        ...current,
        productId,
        productName,
        skipped: false,
        tipoLinea: 'stock',
        invoiceName: String(current.invoiceName ?? current.productName ?? '').trim() || undefined,
      };
      entities.purchaseLines = lines;
      return;
    }
  }
  entities.productId = productId;
  entities.productName = productName;
}

function confirmationMessages(intent: string, entities: WhatsappCommandEntities): string[] {
  if (intent === 'create_purchase') return formatPurchaseConfirmationMessages(entities);
  return [formatOperationSummary(intent, entities)];
}

function confirmationReply(intent: string, entities: WhatsappCommandEntities): string {
  const pages = confirmationMessages(intent, entities);
  return pages[pages.length - 1] ?? formatOperationSummary(intent, entities);
}

async function holdPendingAndAnswer(
  businessId: string,
  phone: string,
  text: string,
  pendingIntent: string,
  payload: Record<string, unknown>,
  prompt: string,
  waitingFor: string
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, {
    pendingIntent,
    pendingPayload: payload,
    pendingPrompt: prompt,
  });
  const answer = await answerWhileWaiting({
    businessId,
    userText: text,
    waitingFor,
    options: prompt,
  });
  return {
    reply: answer,
    replies: [answer, prompt],
    intent: pendingIntent,
    executed: false,
    businessId,
  };
}

async function executeReadQuery(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'No encontré tu cuenta. Contactá a soporte.',
      intent: 'error',
      executed: false,
    };
  }
  const parsed = {
    intent,
    confidence: 1,
    entities,
    raw: String(entities.sourceText ?? ''),
  } as ParsedWhatsappCommand;
  const result = await executeWhatsappCommand(tenant, parsed);
  await clearConversationState(businessId, phone);
  if (intent === 'query_cash' || intent === 'query_balance') {
    await saveConversationState(businessId, phone, { setupStatus: 'done' });
  }
  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId,
  };
}

async function askConfirmation(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const pages = confirmationMessages(intent, entities);
  await saveConversationState(businessId, phone, {
    pendingIntent: `${CONFIRM_INTENT_PREFIX}${intent}`,
    pendingPayload: entities as Record<string, unknown>,
    pendingPrompt: pages[pages.length - 1] ?? confirmationReply(intent, entities),
  });
  return {
    reply: pages[0] ?? confirmationReply(intent, entities),
    replies: pages.length > 1 ? pages : undefined,
    intent,
    executed: false,
    businessId,
  };
}

function polishCashConcept(entities: WhatsappCommandEntities, ambitos: CajaAmbitoConfig[]): void {
  const fallback = entities.cashType === 'ingreso' ? 'Ingreso' : 'Egreso';
  entities.cashConcept = cleanCashConcept(
    String(entities.cashConcept ?? entities.notes ?? entities.sourceText ?? ''),
    ambitos,
    fallback
  );
}

async function ensureCashAmbito(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult | null> {
  const { ambitos } = await loadWhatsappCajaAmbitos(businessId);
  if (ambitos.length <= 1) {
    const only = ambitos[0];
    if (only) applyCashAmbitoToEntities(entities, only);
    polishCashConcept(entities, ambitos);
    return null;
  }

  const resolved = resolveSpokenCashAmbito(entities, ambitos);
  if (resolved) {
    applyCashAmbitoToEntities(entities, resolved);
    polishCashConcept(entities, ambitos);
    return null;
  }

  const prompt = formatCashAmbitoChoices(ambitos, entities.cashType);
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_CASH_AMBITO_INTENT,
    pendingPayload: {
      originalIntent: 'register_cash',
      entities,
      candidates: ambitos.map((ambito) => ({
        id: ambito.id,
        nombre: ambito.label,
        label: ambito.label,
      })),
    },
    pendingPrompt: prompt,
  });
  return {
    reply: prompt,
    intent: SELECT_CASH_AMBITO_INTENT,
    executed: false,
    businessId,
  };
}

async function handleSelectCashAmbito(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const { ambitos } = await loadWhatsappCajaAmbitos(businessId);
  const trimmed = text.trim();
  const candidates = (
    Array.isArray(payload.candidates) && payload.candidates.length
      ? payload.candidates
      : ambitos.map((ambito) => ({ id: ambito.id, nombre: ambito.label, label: ambito.label }))
  ) as Array<{ id: string; nombre?: string; label?: string }>;

  let picked: CajaAmbitoConfig | null = null;
  const numbered = trimmed.match(/^(\d{1,2})$/);
  if (numbered) {
    const choice = candidates[Number(numbered[1]) - 1];
    if (choice) {
      picked =
        ambitos.find((ambito) => ambito.id === choice.id) ??
        ({
          id: choice.id,
          label: String(choice.label || choice.nombre || choice.id),
        } satisfies CajaAmbitoConfig);
    }
  }
  if (!picked) {
    picked = matchCashAmbitoFromText(trimmed, ambitos);
  }

  if (!picked) {
    const prompt = formatCashAmbitoChoices(ambitos, entities.cashType);
    return {
      reply: `No reconocí esa caja.\n\n${prompt}`,
      intent: SELECT_CASH_AMBITO_INTENT,
      executed: false,
      businessId,
    };
  }

  applyCashAmbitoToEntities(entities, picked);
  polishCashConcept(entities, ambitos);
  return prepareOperation(businessId, phone, 'register_cash', entities, rubro);
}

async function askPaymentMethod(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const ctx = await loadPurchasePaymentContext(businessId);
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_PAYMENT_INTENT,
    pendingPayload: { originalIntent: 'create_purchase', entities } as Record<string, unknown>,
  });
  return {
    reply: formatPaymentChoices(ctx.medios),
    intent: SELECT_PAYMENT_INTENT,
    executed: false,
    businessId,
  };
}

async function askPaymentCard(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities,
  cards: { id: string; label: string }[]
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_CARD_INTENT,
    pendingPayload: {
      originalIntent: 'create_purchase',
      entities,
      candidates: cards.map((c) => ({ id: c.id, nombre: c.label })),
    } as Record<string, unknown>,
  });
  return {
    reply: formatCardChoices(cards),
    intent: SELECT_CARD_INTENT,
    executed: false,
    businessId,
  };
}

async function ensurePurchasePayment(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  if (entities.saveAsDraft) {
    applyDraftToEntities(entities, entities.paymentIncompleteReason);
  }
  return askConfirmation(businessId, phone, 'create_purchase', entities);
}

async function prepareOperation(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  await saveConversationState(businessId, phone, { setupStatus: 'done' });

  const source = String(entities.sourceText ?? '').trim();
  if (
    intent === 'register_cost' &&
    (looksLikeNewOrder(source) ||
      (!entities.orderNumber &&
        String(entities.productName ?? '').trim() &&
        Number(entities.amount) > 0 &&
        Boolean(entities.clientName)))
  ) {
    intent = 'create_order';
    entities.referToLast = undefined;
    entities.targetOrderId = undefined;
    entities.targetOrderLabel = undefined;
  }

  sanitizeWhatsappEntities(entities);
  applyOrderDateDefault(intent, entities);
  if (
    entities.sourceText &&
    /\bsin\s+(descripci[oó]n|detalle|notas?|observaciones)\b/i.test(entities.sourceText)
  ) {
    entities.notesAsked = true;
    entities.notes = undefined;
  }
  if (!String(entities.notes ?? '').trim() && entities.sourceText) {
    const notes = sanitizeOrderNotes(extractNotesHintFromText(entities.sourceText) ?? undefined);
    if (notes) {
      entities.notes = notes;
      entities.notesAsked = true;
    }
  }
  if (entities.notes) {
    entities.notes = sanitizeOrderNotes(entities.notes);
  }
  if (
    !String(entities.productName ?? '').trim() &&
    entities.sourceText &&
    intent !== 'register_cash' &&
    intent !== 'register_payment' &&
    intent !== 'query_cash' &&
    intent !== 'query_balance'
  ) {
    const product = extractProductHintFromText(entities.sourceText);
    if (product) entities.productName = product;
  }
  if (entities.sourceText && !(entities.extraCosts?.length)) {
    const extras = extractExtraCostsFromText(entities.sourceText);
    if (extras.length) entities.extraCosts = extras;
  }

  if (
    intent === 'register_payment' &&
    !entities.clientId &&
    !String(entities.clientName ?? '').trim() &&
    !String(entities.targetOrderId ?? '').trim() &&
    !String(entities.orderNumber ?? '').trim()
  ) {
    return askPaymentKind(businessId, phone, entities);
  }

  const missing = missingRequiredFields(intent, entities);
  if (missing.length) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'bundle',
        missingKeys: missing.map((field) => field.key),
        entities,
      },
    });
    return {
      reply: formatMissingFieldsReply(intent, missing, entities, rubro),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  // 1) Cliente
  if (needsClient(intent) && !entities.clientId) {
    const query = String(entities.clientName ?? '').trim();
    if (!query) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'client',
          entities,
        },
      });
      return {
        reply: waCard({
          title: 'Cliente',
          ask: `¿Para quién es?\nEscribí el nombre, o ${waBold('NO')} para cancelar.`,
        }),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }

    const resolved = await resolveClientMatch(businessId, query, {
      preferChoices: preferCatalogChoices(intent),
      utterance: entities.sourceText || query,
    });
    if (resolved.status === 'none') {
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_CLIENT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: query,
        },
      });
      return {
        reply: waCard({
          title: 'Cliente nuevo',
          lines: [`No encontré *${query}*.`],
          ask: `${waBold('SÍ')} = lo registro y sigo\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
        }),
        intent: CONFIRM_CREATE_CLIENT,
        executed: false,
        businessId,
      };
    }

    if (resolved.status === 'ambiguous') {
      const candidates: MatchedClient[] = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_CLIENT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: formatClientChoices(candidates, resolved.query, { allowCreate: true }),
        intent: SELECT_CLIENT_INTENT,
        executed: false,
        businessId,
      };
    }

    entities.spokenClientName = entities.spokenClientName || query;
    entities.clientId = resolved.client.id;
    entities.clientName = resolved.client.nombre;
  }

  if (needsSupplier(intent) && !entities.supplierId) {
    if (intent === 'create_purchase') ensurePurchaseLines(entities);
    const query = String(entities.supplierName ?? '').trim();
    if (!query) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'supplier',
          entities,
        },
      });
      return {
        reply:
          intent === 'create_purchase'
            ? withPurchaseDigest(
                entities,
                'No quedó claro el proveedor.\n¿De qué proveedor es la compra?\nEscribí el nombre o NO para cancelar.'
              )
            : 'No quedó claro el proveedor.\n¿De qué proveedor es la compra?\nEscribí el nombre o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }

    const resolved = await resolveSupplierMatch(businessId, query);
    if (resolved.status === 'none') {
      const supplierReply = withPurchaseDigest(
        entities,
        `No encontré el proveedor "${query}".\n¿Lo registro y sigo?\nSÍ = crear · otro nombre = buscar ese · NO = cancelar.`
      );
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_SUPPLIER,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: query,
        },
      });
      return {
        reply: supplierReply,
        intent: CONFIRM_CREATE_SUPPLIER,
        executed: false,
        businessId,
      };
    }

    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates;
      const supplierReply = withPurchaseDigest(
        entities,
        formatSupplierChoices(candidates, resolved.query, { allowCreate: true })
      );
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_SUPPLIER_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: supplierReply,
        intent: SELECT_SUPPLIER_INTENT,
        executed: false,
        businessId,
      };
    }

    entities.supplierId = resolved.supplier.id;
    entities.supplierName = resolved.supplier.nombre;
  }

  if (intent === 'create_purchase') {
    ensurePurchaseLines(entities);
    const lines = [...(entities.purchaseLines ?? [])];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.productId || line.skipped || line.tipoLinea === 'insumo') continue;
      const productQuery = String(line.invoiceName ?? line.productName ?? '').trim();
      if (!productQuery) continue;

      const aliased = await findProductAlias(businessId, productQuery);
      if (aliased?.kind === 'insumo') {
        lines[i] = {
          ...line,
          tipoLinea: 'insumo',
          skipped: false,
          productId: undefined,
          packResolved: true,
          productName: productQuery,
          invoiceName: productQuery,
        };
        continue;
      }

      const resolved = await resolveProductMatch(businessId, productQuery, {
        preferChoices: true,
        utterance: [entities.sourceText, line.invoiceName, productQuery].filter(Boolean).join('\n'),
      });
      if (resolved.status === 'unique') {
        lines[i] = {
          ...line,
          productId: resolved.product.id,
          productName: resolved.product.label || resolved.product.nombre,
          invoiceName: productQuery,
          tipoLinea: 'stock',
          skipped: false,
          packResolved: true,
        };
      }
    }
    entities.purchaseLines = lines.filter(
      (line) => String(line.productName ?? line.invoiceName ?? '').trim() && Number(line.quantity) > 0
    );
    const active = (entities.purchaseLines ?? []).filter((line) => !line.skipped);
    if (!active.length) {
      await clearConversationState(businessId, phone);
      return {
        reply: 'Saltaste todos los ítems de la boleta. No registré la compra. Mandá la foto de nuevo si querés cargar otra.',
        intent: 'cancelled',
        executed: false,
        businessId,
      };
    }
    const unknownIndexes = unresolvedPurchaseLineIndexes(entities.purchaseLines);
    if (unknownIndexes.length) {
      const unknownReply = renderPurchaseUnknowns(entities);
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_PURCHASE_UNKNOWNS_INTENT,
        pendingPayload: { originalIntent: intent, entities, unknownIndexes },
        pendingPrompt: unknownReply,
      });
      return {
        reply: unknownReply,
        intent: SELECT_PURCHASE_UNKNOWNS_INTENT,
        executed: false,
        businessId,
      };
    }
    if (!(entities.purchaseLines ?? []).length) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'bundle',
          missingKeys: ['productName'],
          entities,
        },
      });
      return {
        reply:
          'No pude armar los productos de la compra.\nMandá la foto del remito/factura o el detalle (producto, cantidad y costo), o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    return ensurePurchasePayment(businessId, phone, entities);
  }

  // 2) Producto (si mencionaron uno)
  const productQuery = String(entities.productName ?? '').trim();
  if (
    (intent === 'create_order' || intent === 'create_sale' || intent === 'update_product_cost') &&
    productQuery &&
    !entities.productId &&
    !entities.productAsConcept
  ) {
    const catalogCostOnly = intent === 'update_product_cost';
    const resolved = await resolveProductMatch(businessId, productQuery, {
      preferChoices: preferCatalogChoices(intent),
      utterance: entities.sourceText || productQuery,
    });
    if (resolved.status === 'ambiguous') {
      const candidates: MatchedStockItem[] = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_PRODUCT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: !catalogCostOnly,
          candidates: candidates.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            label: c.label,
            score: c.score,
            precioVenta: c.precioVenta,
          })),
        },
      });
      return {
        reply: formatProductChoices(candidates, resolved.query, {
          allowCreate: !catalogCostOnly,
          context: catalogCostOnly ? 'purchase' : 'order',
        }),
        intent: SELECT_PRODUCT_INTENT,
        executed: false,
        businessId,
      };
    }
    if (resolved.status === 'unique') {
      entities.spokenProductName = entities.spokenProductName || productQuery;
      entities.productId = resolved.product.id;
      entities.productName = resolved.product.label || resolved.product.nombre;
      if (!catalogCostOnly && entities.amount == null && resolved.product.precioVenta > 0) {
        const qty = Math.max(1, Number(entities.quantity) || 1);
        entities.amount = resolved.product.precioVenta * qty;
      }
    }
    if (resolved.status === 'none') {
      if (catalogCostOnly) {
        return {
          reply: `No encontré "${productQuery}" en el catálogo. Decime el nombre como está guardado, o NO para cancelar.`,
          intent: 'error',
          executed: false,
          businessId,
        };
      }
      await saveConversationState(businessId, phone, {
        pendingIntent: CONFIRM_CREATE_PRODUCT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          proposedName: productQuery,
        },
      });
      const unit = unitPriceFromEntities(entities);
      const priceHint = unit > 0 ? ` a $${unit}` : '';
      return {
        reply: waCard({
          title: 'Producto nuevo',
          lines: [
            `No encontré *${productQuery}* en el catálogo.`,
            'Si lo creo, queda solo para pedidos/ventas (sin control de stock).',
          ],
          ask: `${waBold('SÍ')} = crear y usar${priceHint}\nOtro nombre = busco ese\n${waBold('NO')} = cancelar`,
        }),
        intent: CONFIRM_CREATE_PRODUCT,
        executed: false,
        businessId,
      };
    }
  }

  // 3) Monto
  if (needsAmount(intent) && !(Number(entities.amount) > 0) && !entities.mediaId) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'amount',
        entities,
      },
    });
    return {
      reply: waCard({
        title: 'Monto',
        lines: entities.clientName ? [`Para ${entities.clientName}`] : undefined,
        ask: `¿Cuál es el importe?\nEj: 5000\n${waBold('NO')} cancela.`,
      }),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (intent === 'register_cash' && !entities.cashType) {
    entities.cashType = 'egreso';
  }

  if (intent === 'register_cost' || ((intent === 'create_order' || intent === 'create_sale') && entities.extraCosts?.length)) {
    entities.extraCosts = await fillExtraCostsFromPresets(businessId, entities.extraCosts);
  }

  if (intent === 'register_cost') {
    const extras = (entities.extraCosts ?? []).filter((item) => item.nombre.trim());
    if (!extras.length) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'costConcept',
          entities,
        },
      });
      return {
        reply: waCard({
          title: 'Costo extra',
          lines: ['Ej: estampado 200, vinilo 150.'],
          ask: `${waBold('NO')} cancela.`,
        }),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    if (!extras.some((item) => item.costo > 0)) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'costAmount',
          entities: { ...entities, extraCosts: extras },
        },
      });
      return {
        reply: waCard({
          title: 'Costo extra',
          ask: `¿Cuánto es ${extras[0]!.nombre}?\nEj: 200\n${waBold('NO')} cancela.`,
        }),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    entities.extraCosts = extras.filter((item) => item.costo > 0);
    const target = await resolveOrderForCost(businessId, phone, entities);
    if (!target) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'costOrder',
          entities,
        },
      });
      return {
        reply:
          '¿A qué pedido se lo sumo?\nDecime el número (#00223), el cliente, o cargá el pedido primero.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    if (target.blockedEstado) {
      await clearConversationState(businessId, phone);
      return {
        reply: `El pedido #${target.label} ya está ${target.blockedEstado}. No le puedo sumar costos.`,
        intent: 'register_cost',
        executed: false,
        businessId,
      };
    }
    entities.targetOrderId = target.id;
    entities.targetOrderLabel = target.label;
    if (!entities.clientName) entities.clientName = target.clientName;
    return askConfirmation(businessId, phone, intent, entities);
  }

  if (intent === 'update_order_status') {
    const resolution = await resolveOrderForStatus(businessId, phone, entities);
    if (resolution.status === 'none') {
      return offerOpenOrderPick(businessId, phone, {
        originalIntent: 'update_order_status',
        entities,
        withBalance: false,
        ask: '¿Cuál marco? Número de la lista.',
        rubro,
      });
    }
    if (resolution.status === 'ambiguous') {
      const reply = formatOpenOrderChoices(
        resolution.candidates,
        'Tenés más de uno abierto. ¿Cuál?'
      );
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_ORDER_INTENT,
        pendingPayload: {
          originalIntent: intent,
          entities,
          candidates: resolution.candidates,
        },
        pendingPrompt: reply,
      });
      return {
        reply,
        intent: SELECT_ORDER_INTENT,
        executed: false,
        businessId,
      };
    }
    const target = resolution.order;
    const nextEstado = entities.orderStatus ?? 'listo';
    const source = String(entities.sourceText ?? '');
    if (!ORDER_PAY_HINT.test(source)) {
      entities.amount = undefined;
      entities.paid = undefined;
      entities.payFullBalance = undefined;
    }
    const preview = await previewOrderStatusChange(businessId, target, nextEstado);
    entities.targetOrderId = target.id;
    entities.targetOrderLabel = target.label;
    entities.targetOrderSaldo = target.saldo;
    entities.targetOrderEstadoLabel = preview.previousLabel;
    entities.orderStatusLabel = preview.estadoLabel;
    entities.orderStockWillDrop = preview.stockWillDrop;
    entities.orderStockAlreadyDropped = preview.stockAlreadyDropped;
    entities.orderHasStockLines = preview.hasStockLines;
    entities.orderStatusUnchanged = preview.sameEstado;
    entities.orderStatus = nextEstado;
    if (!entities.clientName) entities.clientName = target.clientName;
    if (!entities.clientId) entities.clientId = target.clientId;
    return askConfirmation(businessId, phone, intent, entities);
  }

  if (intent === 'create_client') {
    const query = String(entities.clientName ?? '').trim();
    if (entities.clientId) {
      await clearConversationState(businessId, phone);
      return {
        reply: `${entities.clientName || 'Ese cliente'} ya está en clientes.`,
        intent: 'create_client',
        executed: false,
        businessId,
      };
    }
    const resolved = await resolveClientMatch(businessId, query, {
      preferChoices: true,
      utterance: entities.sourceText || query,
    });
    if (resolved.status === 'unique') {
      await clearConversationState(businessId, phone);
      return {
        reply: `${resolved.client.nombre} ya está registrado.`,
        intent: 'create_client',
        executed: false,
        businessId,
      };
    }
    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates;
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_CLIENT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate: true,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: formatClientChoices(candidates, resolved.query, { allowCreate: true }),
        intent: SELECT_CLIENT_INTENT,
        executed: false,
        businessId,
      };
    }
    return askConfirmation(businessId, phone, intent, entities);
  }

  const remainingMissing = missingRequiredFields(intent, entities);
  if (remainingMissing.length) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'bundle',
        missingKeys: remainingMissing.map((field) => field.key),
        entities,
      },
    });
    return {
      reply: formatMissingFieldsReply(intent, remainingMissing, entities, rubro),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (intent === 'create_order' && !entities.notesAsked) {
    const notes = String(entities.notes ?? '').trim();
    if (!notes || isGenericWhatsappNotes(notes)) {
      entities.notes = undefined;
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'notes',
          entities,
        },
      });
      return {
        reply: waCard({
          title: 'Descripción',
          lines: ['Ubicación del estampado, frase, observaciones.'],
          ask: `${waBold('LISTO')} = sin descripción.`,
        }),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
  }

  if (intent === 'create_order' && !entities.deliveryDate && !entities.deliveryAsked) {
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'deliveryDate',
        entities,
      },
    });
    return {
      reply: extraCostsDeliveryAsk(entities),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (intent === 'create_order' && !entities.deliveryDate) {
    entities.deliveryDate = todayDateOnly();
    entities.deliveryAsked = true;
    entities.deliveryDefaulted = true;
  }

  if (intent === 'register_cash') {
    const asked = await ensureCashAmbito(businessId, phone, entities);
    if (asked) return asked;
  }

  if (intent === 'query_cash' || intent === 'query_balance') {
    return executeReadQuery(businessId, phone, intent, entities);
  }

  // 4) Resumen + confirmación siempre
  return askConfirmation(businessId, phone, intent, entities);
}

async function mergeClarifyIntoEntities(
  text: string,
  entities: WhatsappCommandEntities,
  missingKeys: string[],
  rubro?: string | null,
  businessId?: string,
  originalIntent?: string
): Promise<WhatsappCommandEntities> {
  const parsed = await parseWhatsappCommand({
    text,
    rubro,
    businessId,
    conversation: {
      originalIntent,
      pendingIntent: CLARIFY_INTENT,
      awaiting: missingKeys.join(',') || 'fields',
      knownEntities: entities,
      missingKeys,
    },
  });
  const incoming = 'entities' in parsed ? parsed.entities ?? {} : {};
  const next = applyEntityUpdates(entities, incoming, text);

  if (!next.clientName && missingKeys.includes('clientName') && !isUnlikelyPersonName(text.trim())) {
    const registered = extractRegisterClientFromText(text);
    if (registered?.name) {
      next.clientName = registered.name;
      next.spokenClientName = next.spokenClientName || registered.name;
      next.clientId = undefined;
      if (registered.phone) next.clientPhone = registered.phone;
    } else {
      const withPhone = text
        .trim()
        .match(
          /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{1,60}?)\s+(\+?\d[\d\s\-.]{6,})$/
        );
      if (withPhone) {
        next.clientName = withPhone[1]!.trim();
        next.spokenClientName = next.spokenClientName || withPhone[1]!.trim();
        next.clientPhone = withPhone[2]!.replace(/[\s\-.]/g, '');
        next.clientId = undefined;
      } else {
        const hint = extractClientHintFromText(text);
        if (hint) {
          next.clientName = hint;
          next.spokenClientName = next.spokenClientName || hint;
        } else if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]{1,60}$/.test(text.trim())) {
          next.clientName = text.trim();
          next.spokenClientName = next.spokenClientName || text.trim();
          next.clientId = undefined;
        }
      }
    }
  }
  if (!next.supplierName && missingKeys.includes('supplierName')) {
    const hint = text.trim();
    if (hint.length >= 2 && hint.length <= 80 && !extractDeliveryDateFromText(hint)) {
      next.supplierName = hint;
      next.supplierId = undefined;
    }
  }
  return next;
}

function payloadEntities(payload: Record<string, unknown>): WhatsappCommandEntities {
  if (payload.entities && typeof payload.entities === 'object' && !Array.isArray(payload.entities)) {
    return { ...(payload.entities as WhatsappCommandEntities) };
  }
  return { ...(payload as WhatsappCommandEntities) };
}

function originalIntentFromPayload(payload: Record<string, unknown>, pendingIntent: string): string {
  const fromPayload = String(payload.originalIntent ?? '').trim();
  if (fromPayload) return fromPayload;
  if (pendingIntent.startsWith(CONFIRM_INTENT_PREFIX)) {
    return pendingIntent.slice(CONFIRM_INTENT_PREFIX.length);
  }
  return '';
}

function pendingIntentForKind(kind: 'client' | 'product' | 'supplier'): string {
  if (kind === 'client') return SELECT_CLIENT_INTENT;
  if (kind === 'supplier') return SELECT_SUPPLIER_INTENT;
  return SELECT_PRODUCT_INTENT;
}

async function parsePendingFollowUp(
  businessId: string,
  text: string,
  pendingIntent: string,
  payload: Record<string, unknown>,
  rubro?: string | null
): Promise<ParsedWhatsappCommand> {
  const entities = payloadEntities(payload);
  const originalIntent = originalIntentFromPayload(payload, pendingIntent);
  const missingKeys = Array.isArray(payload.missingKeys)
    ? payload.missingKeys.map((key) => String(key))
    : payload.missingField
      ? [String(payload.missingField)]
      : [];
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as NamedCandidate[];
  return parseWhatsappCommand({
    text,
    rubro,
    businessId,
    conversation: {
      originalIntent,
      pendingIntent,
      awaiting:
        pendingIntent === SELECT_CLIENT_INTENT
          ? 'select_client'
          : pendingIntent === SELECT_PRODUCT_INTENT
            ? 'select_product'
            : pendingIntent === SELECT_PURCHASE_PACK_INTENT
              ? 'select_purchase_pack'
            : pendingIntent === SELECT_SUPPLIER_INTENT
              ? 'select_supplier'
              : pendingIntent === SELECT_CASH_AMBITO_INTENT
                ? 'select_cash_ambito'
              : pendingIntent.startsWith(CONFIRM_INTENT_PREFIX)
                ? 'confirm'
                : String(payload.missingField || 'fields'),
      knownEntities: entities,
      missingKeys,
      candidates: candidates.map((candidate, index) => ({
        index: index + 1,
        label: candidate.label || candidate.nombre,
      })),
    },
  });
}

async function continueFromFollowUp(
  businessId: string,
  phone: string,
  text: string,
  pendingIntent: string,
  payload: Record<string, unknown>,
  rubro?: string | null,
  parsedInput?: ParsedWhatsappCommand
): Promise<WhatsappHandlerResult> {
  const parsed =
    parsedInput ?? (await parsePendingFollowUp(businessId, text, pendingIntent, payload, rubro));
  const known = payloadEntities(payload);
  const originalIntent = originalIntentFromPayload(payload, pendingIntent);
  const incoming = 'entities' in parsed ? parsed.entities ?? {} : {};

  if ((looksLikeListOrders(text) || looksLikeStatusQuery(text)) && !looksLikeOrderStatusUpdate(text)) {
    const fresh = entitiesFromParsed(parsed);
    if (!fresh.sourceText) fresh.sourceText = text;
    return offerOpenOrderPick(businessId, phone, {
      originalIntent: 'query_status',
      entities: mergeOrderSearchHints(fresh, text),
      rubro,
    });
  }
  if (looksLikeCashMovement(text) || parsed.intent === 'register_cash') {
    const fresh = entitiesFromParsed(parsed);
    if (!fresh.cashType) {
      fresh.cashType = CASH_OUT_HINT.test(text) ? 'egreso' : 'ingreso';
    }
    if (!String(fresh.cashConcept ?? '').trim()) {
      fresh.cashConcept = fresh.cashType === 'egreso' ? 'Egreso' : 'Ingreso';
    }
    if (!fresh.sourceText) fresh.sourceText = text;
    return prepareOperation(businessId, phone, 'register_cash', fresh, rubro);
  }
  if (looksLikeOrderStatusUpdate(text) || parsed.intent === 'update_order_status') {
    const fresh = entitiesFromParsed(parsed);
    if (!ORDER_PAY_HINT.test(text)) {
      fresh.amount = undefined;
      fresh.paid = undefined;
      fresh.payFullBalance = undefined;
    }
    return prepareOperation(businessId, phone, 'update_order_status', fresh, rubro);
  }

  if (parsed.followUpAction === 'cancel') {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const purchaseDisposition = parsePurchaseLineDisposition(text);
  if (purchaseDisposition && pendingIntent === SELECT_PURCHASE_UNKNOWNS_INTENT) {
    const entities = { ...known };
    const indexes = unresolvedPurchaseLineIndexes(entities.purchaseLines);
    await applyDispositionToLines(businessId, entities, indexes, purchaseDisposition);
    return prepareOperation(businessId, phone, 'create_purchase', entities, rubro);
  }
  if (
    purchaseDisposition &&
    (      pendingIntent === SELECT_PRODUCT_INTENT ||
      pendingIntent === SELECT_PURCHASE_PACK_INTENT ||
      pendingIntent === SELECT_PURCHASE_NON_CATALOG_INTENT ||
      pendingIntent === CONFIRM_CREATE_PRODUCT)
  ) {
    const entities = { ...known };
    return resumePurchaseWithDisposition(
      businessId,
      phone,
      entities,
      payload,
      purchaseDisposition,
      rubro
    );
  }

  if (parsed.followUpAction === 'ask' || looksLikePendingQuestion(text)) {
    await saveConversationState(businessId, phone, {
      pendingIntent,
      pendingPayload: payload,
    });
    return {
      reply: 'Seguimos con lo de antes. Pasame el número, SÍ/NO, o lo que te pedí.',
      intent: pendingIntent,
      executed: false,
      businessId,
    };
  }

  if (
    parsed.followUpAction === 'new' &&
    parsed.intent !== 'unknown' &&
    parsed.intent !== 'help' &&
    parsed.intent !== 'greeting' &&
    originalIntent &&
    parsed.intent !== originalIntent
  ) {
    const fresh = entitiesFromParsed(parsed);
    return prepareOperation(businessId, phone, parsed.intent, fresh, rubro);
  }

  if (parsed.followUpAction === 'confirm' && originalIntent) {
    const entities = applyEntityUpdates(known, incoming, text);
    if (pendingIntent.startsWith(CONFIRM_INTENT_PREFIX) && CONFIRM_YES.test(text.trim())) {
      return handlePendingConfirmation(businessId, phone, 'si', pendingIntent, entities as Record<string, unknown>, rubro);
    }
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  const entities = applyEntityUpdates(known, incoming, text);
  if (!originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo el pedido o consulta.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }
  return prepareOperation(businessId, phone, originalIntent, entities, rubro);
}

/** «2», «#00223» o «el de Ana» sobre la lista de pedidos abiertos. */
function pickOrderCandidate<T extends { id?: string; label?: string; clientName?: string }>(
  candidates: T[],
  text: string
): T | null {
  const answer = text.trim().toLowerCase();
  if (!candidates.length || !answer) return null;

  const leading = answer.match(/^\s*(\d{1,2})\b/);
  if (leading) {
    const index = Number(leading[1]);
    if (index >= 1 && index <= candidates.length) return candidates[index - 1] ?? null;
  }

  const byLabel = candidates.find((item) => {
    const label = String(item.label ?? '').toLowerCase();
    return label && (answer.includes(label) || answer.replace(/^0+/, '') === label.replace(/^0+/, ''));
  });
  if (byLabel) return byLabel;

  const byClient = candidates.find((item) => {
    const name = String(item.clientName ?? '').toLowerCase();
    return name && answer.includes(name.split(/\s+/)[0]!);
  });
  return byClient ?? null;
}

const LISTO_TURN = /(?<![\p{L}])(listo|pronto|termin[eé]|ya\s+est[aá]\s+(listo|pronto))(?![\p{L}])/iu;
const ENTREGADO_TURN =
  /(?<![\p{L}])(entregu[eé]|entregad[oa]|se\s+lo\s+(di|llev[oó])|ya\s+lo\s+(retir[oó]|llev[oó]))(?![\p{L}])/iu;
const SETTLE_TURN =
  /(?<![\p{L}])(sald(?:alo|ar)|pag[oó]\s+todo|cobr[oó]\s+todo|pago\s+del\s+total|total\s+del\s+saldo|cobra(?:r)?\s+(?:el\s+)?(?:saldo|total)|registr[aeá]\s+(?:el\s+)?pago)(?![\p{L}])/iu;
const PAY_TURN = /(?<![\p{L}])(pag[oó]|cobr|se[nñ]a|abon)(?![\p{L}])/iu;

function entitiesFromPickedOrder(
  entities: WhatsappCommandEntities,
  picked: OrderStatusTarget
): WhatsappCommandEntities {
  return {
    ...entities,
    targetOrderId: picked.id,
    targetOrderLabel: picked.label,
    clientId: picked.clientId || entities.clientId,
    clientName: picked.clientName || entities.clientName,
    spokenClientName: entities.spokenClientName || picked.clientName,
    targetOrderSaldo: picked.saldo,
    listOrders: undefined,
    referToLast: undefined,
  };
}

async function askOrderAction(
  businessId: string,
  phone: string,
  picked: OrderStatusTarget,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const reply = formatOrderActionAsk(picked);
  await saveConversationState(businessId, phone, {
    pendingIntent: ORDER_ACTION_INTENT,
    pendingPayload: { originalIntent: 'query_status', entities, picked },
    pendingPrompt: reply,
    lastOperation: {
      kind: 'order',
      id: picked.id,
      label: picked.label,
      clientName: picked.clientName,
      amount: picked.total,
      at: new Date().toISOString(),
    },
  });
  return {
    reply,
    intent: ORDER_ACTION_INTENT,
    executed: false,
    businessId,
  };
}

async function continueFromPickedOrder(
  businessId: string,
  phone: string,
  picked: OrderStatusTarget,
  originalIntent: string,
  entities: WhatsappCommandEntities,
  text: string,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const next = entitiesFromPickedOrder(entities, picked);
  const amount = extractAmountFromText(text);
  if (amount && amount > 0) next.amount = amount;
  const wantsListo = LISTO_TURN.test(text);
  const wantsEntregado = ENTREGADO_TURN.test(text);
  const wantsSettle = SETTLE_TURN.test(text) || next.payFullBalance === true;
  const wantsPay = PAY_TURN.test(text) || wantsSettle || Boolean(amount && !wantsEntregado);

  if (wantsEntregado) {
    next.orderStatus = 'entregado';
    if (wantsSettle || (wantsPay && !(amount && amount > 0))) {
      next.payFullBalance = true;
      next.paid = true;
    }
    if (!wantsSettle && !PAY_TURN.test(text) && !(amount && amount > 0)) {
      next.amount = undefined;
      next.paid = undefined;
      next.payFullBalance = undefined;
    }
    return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
  }
  if (wantsListo) {
    next.orderStatus = next.orderStatus || 'listo';
    if (wantsSettle || (wantsPay && !(amount && amount > 0))) {
      next.payFullBalance = true;
      next.paid = true;
    }
    return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
  }
  if (originalIntent === 'register_payment' || wantsPay) {
    if ((wantsSettle || next.payFullBalance) && !(Number(next.amount) > 0)) {
      next.payFullBalance = true;
      next.paid = true;
    }
    next.paymentKind = next.paymentKind || 'pago';
    if (!(Number(next.amount) > 0) && !next.payFullBalance) {
      return askOrderAction(businessId, phone, picked, next);
    }
    return prepareOperation(businessId, phone, 'register_payment', next, rubro);
  }
  if (originalIntent === 'update_order_status' || wantsListo || wantsEntregado) {
    next.orderStatus = wantsEntregado ? 'entregado' : next.orderStatus || 'listo';
    return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
  }
  return askOrderAction(businessId, phone, picked, next);
}

function hasOrderSearchHints(entities: WhatsappCommandEntities): boolean {
  return Boolean(
    String(entities.clientName ?? '').trim() ||
      String(entities.productName ?? '').trim() ||
      String(entities.orderNumber ?? '').trim() ||
      String(entities.targetOrderId ?? '').trim() ||
      Number(entities.amount) > 0
  );
}

function leftoverSearchWords(text: string): string {
  return String(text ?? '')
    .replace(/\b(me\s+lleg[oó]\s+(un\s+)?pago|me\s+pagaron|lleg[oó]\s+(una\s+)?transferencia)\b/gi, ' ')
    .replace(/\b(list(?:ame|[áa])?|mostr(?:ame|[áa])|busc(?:ame|[áa]|ar))\b/gi, ' ')
    .replace(/\b(pedidos?|abiertos?|pendientes?|con\s+saldo|sin\s+pagar)\b/gi, ' ')
    .replace(/\$?\s*[\d.]+(?:,\d{2})?/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(el|la|los|las|de|del|un|una|al|es|el\s+de)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseSearchProduct(value: string | undefined): boolean {
  const fold = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!fold) return true;
  if (
    /^(me llego un pago|me llego pago|un pago|pago|pagos|pedido|pedidos|saldo|transferencia|busca|buscar|buscame)$/.test(
      fold
    )
  ) {
    return true;
  }
  const tokens = fold.split(' ').filter(Boolean);
  return tokens.every((token) =>
    [
      'me',
      'llego',
      'un',
      'una',
      'pago',
      'pagos',
      'pedido',
      'pedidos',
      'saldo',
      'busca',
      'buscar',
      'buscame',
      'el',
      'la',
      'de',
      'del',
    ].includes(token)
  );
}

function mergeOrderSearchHints(
  entities: WhatsappCommandEntities,
  text: string
): WhatsappCommandEntities {
  const next: WhatsappCommandEntities = {
    ...entities,
    sourceText: [entities.sourceText, text].filter(Boolean).join('\n'),
  };
  const amount = extractAmountFromText(text);
  if (amount && amount > 0 && !looksLikeCashMovement(text)) next.amount = amount;
  const orderNumber = extractOrderNumberFromText(text);
  if (orderNumber) next.orderNumber = orderNumber;
  const client =
    extractQueryClientFromText(text) || extractClientHintFromText(text) || undefined;
  if (client) {
    next.clientName = client;
    next.spokenClientName = next.spokenClientName || client;
  }
  const product = extractProductHintFromText(text);
  if (
    product &&
    product.length >= 3 &&
    !isNoiseSearchProduct(product) &&
    !/\b(busca|buscar|buscame|pedido|pedidos)\b/i.test(product)
  ) {
    next.productName = product;
  } else if (!next.clientName && (!next.productName || isNoiseSearchProduct(next.productName))) {
    const leftover = leftoverSearchWords(text);
    if (leftover.length >= 3 && leftover.length <= 80 && !isNoiseSearchProduct(leftover)) {
      if (!isUnlikelyPersonName(leftover)) {
        next.clientName = leftover;
        next.spokenClientName = next.spokenClientName || leftover;
      } else {
        next.productName = leftover;
      }
    } else if (isNoiseSearchProduct(next.productName)) {
      next.productName = undefined;
    }
  } else if (isNoiseSearchProduct(next.productName)) {
    next.productName = undefined;
  }
  return next;
}

function wantsListedOrders(entities: WhatsappCommandEntities, originalIntent: string): boolean {
  const source = String(entities.sourceText ?? '');
  return Boolean(entities.listOrders) || (originalIntent === 'query_status' && looksLikeListOrders(source));
}

async function askFindOrderGuide(
  businessId: string,
  phone: string,
  opts: {
    originalIntent: string;
    entities: WhatsappCommandEntities;
    missed?: boolean;
  }
): Promise<WhatsappHandlerResult> {
  const reply = formatFindOrderGuide({
    missed: opts.missed,
    paymentAmount: Number(opts.entities.amount) || undefined,
    triedHint: String(opts.entities.clientName ?? opts.entities.productName ?? '').trim() || undefined,
    forQuery: opts.originalIntent === 'query_status',
  });
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_ORDER_INTENT,
    pendingPayload: {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
      candidates: [],
    },
    pendingPrompt: reply,
  });
  return {
    reply,
    intent: SELECT_ORDER_INTENT,
    executed: false,
    businessId,
  };
}

async function offerOpenOrderPick(
  businessId: string,
  phone: string,
  opts: {
    originalIntent: string;
    entities: WhatsappCommandEntities;
    withBalance?: boolean;
    ask?: string;
    rubro?: string | null;
  }
): Promise<WhatsappHandlerResult> {
  if (isNoiseSearchProduct(opts.entities.productName)) {
    opts.entities = { ...opts.entities, productName: undefined };
  }
  const source = String(opts.entities.sourceText ?? '');
  const withBalance =
    opts.withBalance === true ||
    opts.originalIntent === 'register_payment' ||
    /\b(saldo|sin\s+pagar)\b/i.test(source);
  const listed = wantsListedOrders(opts.entities, opts.originalIntent);
  const forQuery = opts.originalIntent === 'query_status';
  if (!hasOrderSearchHints(opts.entities) && !listed) {
    return askFindOrderGuide(businessId, phone, {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
    });
  }

  const items = await listOpenOrdersForWhatsapp(businessId, {
    clientHint: opts.entities.clientName,
    productHint: opts.entities.productName,
    amountHint: Number(opts.entities.amount) || undefined,
    withBalance,
    includeClosed: forQuery,
  });
  if (!items.length) {
    return askFindOrderGuide(businessId, phone, {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
      missed: true,
    });
  }
  if (items.length === 1) {
    return continueFromPickedOrder(
      businessId,
      phone,
      items[0]!,
      opts.originalIntent,
      opts.entities,
      source,
      opts.rubro
    );
  }
  const ask =
    opts.ask ??
    (opts.originalIntent === 'register_payment' && Number(opts.entities.amount) > 0
      ? `¿A qué pedido le pongo los $${opts.entities.amount}? Número de la lista.\nTambién *listo* o *saldalo*.`
      : '¿Cuál? Número de la lista.\nDespués cobrás, lo asociás o lo marcás *listo*.');
  const reply = formatOpenOrderChoices(items, ask);
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_ORDER_INTENT,
    pendingPayload: {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
      candidates: items,
    },
    pendingPrompt: reply,
  });
  return {
    reply,
    intent: SELECT_ORDER_INTENT,
    executed: false,
    businessId,
  };
}

async function askPaymentKind(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const amount = Number(entities.amount) || 0;
  const reply = waCard({
    title: '¿Cómo lo registro?',
    lines: [
      amount > 0 ? `Tengo $${amount.toLocaleString('es-AR')}.` : 'Llegó plata.',
      '• *1* cobro de un pedido',
      '• *2* ingreso suelto de caja',
    ],
    ask: 'O decime el cliente / el producto. Si es un *egreso*, escribilo así.',
  });
  await saveConversationState(businessId, phone, {
    pendingIntent: SELECT_PAYMENT_KIND_INTENT,
    pendingPayload: {
      originalIntent: 'register_payment',
      entities,
    },
    pendingPrompt: reply,
  });
  return {
    reply,
    intent: SELECT_PAYMENT_KIND_INTENT,
    executed: false,
    businessId,
  };
}

async function handleSelectPaymentKind(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({ title: 'Cancelado', ask: 'Escribime de nuevo cuando quieras.' }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }
  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const folded = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const wantsCashIn =
    /^2\s*$/.test(text.trim()) ||
    /\b(ingreso|suelto|no es de (un )?cliente|caja suelta)\b/i.test(folded);
  if (looksLikeCashMovement(text) || wantsCashIn) {
    await saveConversationState(businessId, phone, {
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
    });
    const cashType = CASH_OUT_HINT.test(folded) && !wantsCashIn ? 'egreso' : 'ingreso';
    return prepareOperation(
      businessId,
      phone,
      'register_cash',
      {
        ...entities,
        cashType,
        cashConcept:
          String(entities.cashConcept ?? '').trim() ||
          (cashType === 'egreso' ? 'Egreso' : 'Ingreso'),
        sourceText: text,
      },
      rubro
    );
  }
  const pickedCobro = /^1\s*$/.test(text.trim()) || /^(cobro|pedido)$/i.test(text.trim());
  return offerOpenOrderPick(businessId, phone, {
    originalIntent: 'register_payment',
    entities: pickedCobro ? entities : mergeOrderSearchHints(entities, text),
    withBalance: true,
    rubro,
  });
}

async function handleSelectOrder(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({ title: 'Cancelado', ask: 'Escribime de nuevo cuando quieras.' }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }
  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const originalIntent = String(payload.originalIntent ?? 'query_status');
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as OrderStatusTarget[];
  const picked = candidates.length ? pickOrderCandidate(candidates, text) : null;
  if (picked?.id) {
    return continueFromPickedOrder(businessId, phone, picked, originalIntent, entities, text, rubro);
  }

  const shortIndex = /^\s*\d{1,2}\s*$/.test(text.trim());
  const looksLikeSearch =
    /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/.test(text) ||
    Boolean(extractOrderNumberFromText(text)) ||
    (Boolean(extractAmountFromText(text)) && !shortIndex);
  if (!candidates.length || looksLikeSearch) {
    if (!candidates.length && shortIndex) {
      return askFindOrderGuide(businessId, phone, {
        originalIntent,
        entities,
      });
    }
    return offerOpenOrderPick(businessId, phone, {
      originalIntent,
      entities: mergeOrderSearchHints(entities, text),
      rubro,
    });
  }

  return {
    reply: 'No me quedó claro cuál. Decime el número de la lista (1, 2, 3) o un dato (cliente, producto, monto).',
    intent: SELECT_ORDER_INTENT,
    executed: false,
    businessId,
  };
}

async function handleOrderAction(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^(despu[eé]s|ahora no)$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({ title: 'Dale', ask: 'Cuando quieras lo marcamos o cobramos.' }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }
  const payload = pendingPayload ?? {};
  const picked = payload.picked as OrderStatusTarget | undefined;
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  if (!picked?.id) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el pedido. Listame de nuevo o decime el número.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }
  const originalIntent = LISTO_TURN.test(text) || ENTREGADO_TURN.test(text)
    ? 'update_order_status'
    : SETTLE_TURN.test(text) || PAY_TURN.test(text) || extractAmountFromText(text)
      ? 'register_payment'
      : CONFIRM_YES.test(text.trim())
        ? picked.saldo > 0
          ? 'register_payment'
          : 'update_order_status'
        : 'query_status';
  if (originalIntent === 'query_status') {
    return {
      reply: formatOrderActionAsk(picked),
      intent: ORDER_ACTION_INTENT,
      executed: false,
      businessId,
    };
  }
  if (originalIntent === 'register_payment' && CONFIRM_YES.test(text.trim()) && !(Number(entities.amount) > 0)) {
    entities.payFullBalance = true;
    entities.paid = true;
  }
  return continueFromPickedOrder(businessId, phone, picked, originalIntent, entities, text, rubro);
}

async function handleSettleOrder(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^(despu[eé]s|ahora no)$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Dale, el saldo queda.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }
  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? payload) as WhatsappCommandEntities) };
  const amount = extractAmountFromText(text);
  if (CONFIRM_YES.test(text.trim()) || SETTLE_TURN.test(text) || /todo/.test(text.toLowerCase())) {
    entities.payFullBalance = true;
    entities.paid = true;
    entities.amount = undefined;
  } else if (amount && amount > 0) {
    entities.amount = amount;
    entities.payFullBalance = undefined;
  } else {
    const ask = formatSettleAsk(
      String(entities.targetOrderLabel ?? ''),
      String(entities.clientName ?? ''),
      Number(entities.targetOrderSaldo) || 0
    );
    return {
      reply: ask,
      intent: SETTLE_ORDER_INTENT,
      executed: false,
      businessId,
    };
  }
  entities.paymentKind = 'pago';
  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return { reply: 'No encontré tu cuenta. Contactá a soporte.', intent: 'error', executed: false };
  }
  const parsed = {
    intent: 'register_payment',
    confidence: 1,
    entities,
    raw: text,
  } as ParsedWhatsappCommand;
  const result = await executeWhatsappCommand(tenant, parsed);
  if (result.executed) {
    const last = lastOperationFromResult(result, entities);
    if (last) await rememberLastOperation(businessId, phone, last);
    else await clearConversationState(businessId, phone);
  } else {
    await clearConversationState(businessId, phone);
  }
  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId,
  };
}

/** No entendió: pregunta qué quiso decir y deja la pregunta abierta. */
async function askUnknownIntent(
  tenant: WhatsappTenantContext,
  phone: string,
  text: string,
  lastOperation: LastWhatsappOperation | null,
  attempt: number
): Promise<WhatsappHandlerResult> {
  const question = await askWhatYouMeant({
    text,
    businessId: tenant.businessId,
    rubro: tenant.rubro,
    lastOperation,
  });
  await saveConversationState(tenant.businessId, phone, {
    pendingIntent: CLARIFY_INTENT,
    pendingPayload: { missingField: 'intent', originalText: text, attempt },
    pendingPrompt: question,
  });
  return {
    reply: question,
    intent: CLARIFY_INTENT,
    executed: false,
    businessId: tenant.businessId,
  };
}

/** La respuesta a «¿qué quisiste decir?»: se relee junto con el mensaje original. */
async function handleClarifiedIntent(
  tenant: WhatsappTenantContext,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const original = String(payload.originalText ?? '').trim();
  const attempt = Number(payload.attempt ?? 1);
  const answer = text.trim();

  if (
    CONFIRM_NO.test(answer) ||
    isThanksText(answer) ||
    /^(nada|olvidalo|dej[aá]lo|despu[eé]s)$/i.test(answer)
  ) {
    await clearConversationState(tenant.businessId, phone);
    return {
      reply: isThanksText(answer) ? 'Dale.' : 'Listo, lo dejo ahí. Cuando quieras me escribís.',
      intent: CLARIFY_INTENT,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const combined =
    original && !answer.toLowerCase().includes(original.toLowerCase())
      ? `${original}. ${answer}`
      : answer;
  const parsed = await parseWhatsappCommand({
    text: combined,
    rubro: tenant.rubro,
    businessId: tenant.businessId,
  });

  if (parsed.intent === 'greeting' || parsed.intent === 'help' || parsed.intent === 'query_status') {
    if (parsed.intent === 'help') {
      return handleHelpTurn(tenant, text);
    }
    await clearConversationState(tenant.businessId, phone);
    const result = await executeWhatsappCommand(tenant, parsed);
    return {
      reply: result.reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  }

  if (parsed.intent !== 'unknown') {
    return prepareOperation(
      tenant.businessId,
      phone,
      parsed.intent,
      entitiesFromParsed(parsed),
      tenant.rubro
    );
  }

  if (attempt >= 2) {
    await clearConversationState(tenant.businessId, phone);
    return {
      reply:
        'Sigo sin agarrarle la vuelta. Escribime la operación completa en un mensaje, ' +
        `por ejemplo «${whatsappCopyForRubro(tenant.rubro).exampleSale}». ` +
        'Si preferís, escribí Consultame y te paso lo que puedo hacer.',
      intent: CLARIFY_INTENT,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  return askUnknownIntent(tenant, phone, combined, null, attempt + 1);
}

async function handlePendingClarify(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const missingField = String(payload.missingField ?? '').trim();
  const skipNotes = /^(listo|nada|no|n|sin descripci[oó]n|sin detalle|ninguna|ninguno|-)$/i.test(
    text.trim()
  );

  if (missingField === 'notes') {
    const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
    if (!originalIntent) {
      await clearConversationState(businessId, phone);
      return {
        reply: 'Se me perdió el contexto. Mandá de nuevo el pedido o consulta.',
        intent: 'error',
        executed: false,
        businessId,
      };
    }
    if (skipNotes) {
      entities.notesAsked = true;
      entities.notes = undefined;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    const merged = await mergeClarifyIntoEntities(
      text,
      entities,
      ['notes'],
      rubro,
      businessId,
      originalIntent
    );
    merged.notesAsked = true;
    const leftover = sanitizeOrderNotes(merged.notes) ?? sanitizeOrderNotes(text);
    const understoodOther =
      Boolean(merged.deliveryDate && merged.deliveryDate !== entities.deliveryDate) ||
      mergeExtraCostItems(merged.extraCosts).length > mergeExtraCostItems(entities.extraCosts).length ||
      (Number(merged.amount) || 0) !== (Number(entities.amount) || 0);
    if (leftover) {
      merged.notes = leftover;
      return prepareOperation(businessId, phone, originalIntent, merged, rubro);
    }
    merged.notes = undefined;
    if (understoodOther) {
      return prepareOperation(businessId, phone, originalIntent, merged, rubro);
    }
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent,
        missingField: 'notes',
        entities: merged,
      },
    });
    return {
      reply:
        'No entendí. Si es la descripción del pedido, escribila (ubicación, frase, observaciones). Si es fecha o costo extra, decime eso.\nLISTO = sin descripción.',
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  const skipDelivery = /^(listo|nada|no|n|sin fecha|sin fecha de entrega|despu[eé]s|despues|ahora no|-)$/i.test(
    text.trim()
  );

  if (missingField === 'deliveryDate') {
    const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
    if (!originalIntent) {
      await clearConversationState(businessId, phone);
      return {
        reply: 'Se me perdió el contexto. Mandá de nuevo el pedido o consulta.',
        intent: 'error',
        executed: false,
        businessId,
      };
    }
    if (skipDelivery) {
      entities.deliveryAsked = true;
      entities.deliveryDate = todayDateOnly();
      entities.deliveryDefaulted = true;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    const parsedDate = extractDeliveryDateFromText(text);
    if (parsedDate) {
      entities.deliveryDate = parsedDate;
      entities.deliveryAsked = true;
      entities.deliveryDefaulted = undefined;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    if (looksLikeIterativeCorrection(text)) {
      return continueFromFollowUp(businessId, phone, text, CLARIFY_INTENT, payload, rubro);
    }
    const merged = await mergeClarifyIntoEntities(
      text,
      entities,
      ['deliveryDate'],
      rubro,
      businessId,
      originalIntent
    );
    const geminiDate = String(merged.deliveryDate ?? '').trim();
    if (geminiDate) {
      entities.deliveryDate = geminiDate;
      entities.deliveryAsked = true;
      entities.deliveryDefaulted = undefined;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent,
        missingField: 'deliveryDate',
        entities,
      },
    });
    return {
      reply:
        'No entendí la fecha. Poné un día (mañana, viernes, 28/08) o LISTO y la dejo para hoy.',
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }
  const missingKeys = Array.isArray(payload.missingKeys)
    ? payload.missingKeys.map((key) => String(key))
    : missingField
      ? [missingField]
      : [];
  let entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };

  if (!originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo el pedido o consulta.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  entities = await mergeClarifyIntoEntities(
    text,
    entities,
    missingKeys,
    rubro,
    businessId,
    originalIntent
  );

  if (missingField === 'client' && !entities.clientName && !isUnlikelyPersonName(text.trim())) {
    entities.clientName = text.trim();
    entities.spokenClientName = entities.spokenClientName || text.trim();
    entities.clientId = undefined;
  } else if (missingField === 'supplier' && !entities.supplierName) {
    entities.supplierName = text.trim();
    entities.supplierId = undefined;
  } else if (missingField === 'amount' && !(Number(entities.amount) > 0)) {
    const amount = extractAmountFromText(text) ?? Number(text.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!(amount > 0)) {
      return {
        reply: 'No entendí el monto. Escribí solo el número (ej. 5000) o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    entities.amount = amount;
  } else if (missingField === 'costConcept') {
    const parsed = extractExtraCostsFromText(text);
    if (parsed.length) {
      entities.extraCosts = parsed;
    } else {
      const named = text
        .trim()
        .match(
          /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,40}?)\s+\$?\s*([\d.]+(?:,\d+)?)\s*$/i
        );
      if (named?.[1] && named[2]) {
        const costo =
          extractAmountFromText(named[2]) ??
          Number(String(named[2]).replace(/\./g, '').replace(',', '.'));
        entities.extraCosts = [
          { nombre: named[1].trim().slice(0, 60), costo: Number(costo) > 0 ? Number(costo) : 0 },
        ];
      } else if (text.trim().length >= 2) {
        const previous = entities.extraCosts?.[0]?.costo || 0;
        entities.extraCosts = [{ nombre: text.trim().slice(0, 60), costo: previous }];
      }
    }
  } else if (missingField === 'costAmount') {
    const amount = extractAmountFromText(text) ?? Number(text.replace(/[^\d.,]/g, '').replace(',', '.'));
    if (!(amount > 0)) {
      return {
        reply: 'No entendí el importe del costo. Escribí solo el número (ej. 200) o NO para cancelar.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    const current = entities.extraCosts?.[0] ?? { nombre: 'Costo extra', costo: 0 };
    entities.extraCosts = [{ ...current, costo: amount }];
  } else if (missingField === 'costOrder') {
    const orderNumber = extractOrderNumberFromText(text);
    if (orderNumber) entities.orderNumber = orderNumber;
    else if (text.trim().length >= 2) {
      entities.clientName = text.trim();
      entities.spokenClientName = entities.spokenClientName || text.trim();
    }
  } else if (missingField === 'statusOrder') {
    const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as Array<{
      id?: string;
      label?: string;
      clientName?: string;
    }>;
    const picked = pickOrderCandidate(candidates, text);
    if (!picked?.id) {
      return {
        reply:
          'No me quedó claro cuál. Decime el número de la lista (1, 2, 3) o el número de pedido.',
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    entities.targetOrderId = picked.id;
    entities.targetOrderLabel = picked.label;
    if (picked.clientName) entities.clientName = picked.clientName;
  }

  return prepareOperation(businessId, phone, originalIntent, entities, rubro);
}

async function handleSelectPurchaseUnknowns(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const unknownIndexes = unresolvedPurchaseLineIndexes(entities.purchaseLines);
  const prompt = formatPurchaseUnknownsPrompt(entities, {
    followUp: entities.purchaseUnknownsAsked === true,
  });

  if (!unknownIndexes.length) {
    return prepareOperation(businessId, phone, 'create_purchase', entities, rubro);
  }

  const parsed =
    parsePurchaseUnknownsReply(text, unknownIndexes.length) ??
    (parsePurchaseLineDisposition(text) === 'insumo'
      ? { action: 'insumo_all' as const }
      : parsePurchaseLineDisposition(text) === 'skip'
        ? { action: 'skip_all' as const }
        : null);

  if (!parsed) {
    if (looksLikePendingQuestion(text)) {
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        SELECT_PURCHASE_UNKNOWNS_INTENT,
        { ...payload, entities, unknownIndexes },
        prompt,
        'que elija un número para vincularlo o descartarlo'
      );
    }
    if (unknownIndexes.length === 1 && text.trim().length >= 2) {
      const lineIndex = unknownIndexes[0]!;
      const line = purchaseLineAt(entities, lineIndex);
      const query = String(line?.invoiceName ?? line?.productName ?? '').trim();
      entities.purchaseUnknownsAsked = true;
      return handlePendingSelection(
        businessId,
        phone,
        text,
        'product',
        {
          originalIntent: 'create_purchase',
          query,
          lineIndex,
          entities,
          allowCreate: true,
          candidates: [],
        },
        rubro
      );
    }
    await saveConversationState(businessId, phone, {
      pendingIntent: SELECT_PURCHASE_UNKNOWNS_INTENT,
      pendingPayload: { ...payload, entities, unknownIndexes },
      pendingPrompt: prompt,
    });
    return {
      reply: `No te seguí.\n\n${prompt}`,
      intent: SELECT_PURCHASE_UNKNOWNS_INTENT,
      executed: false,
      businessId,
    };
  }

  if (parsed.action === 'pick') {
    const lineIndex = unknownIndexes[parsed.index];
    if (lineIndex == null) {
      return {
        reply: prompt,
        intent: SELECT_PURCHASE_UNKNOWNS_INTENT,
        executed: false,
        businessId,
      };
    }
    return askPurchaseLineCatalog(businessId, phone, entities, lineIndex);
  }

  const targetIndexes =
    parsed.action === 'insumo_all' || parsed.action === 'skip_all'
      ? unknownIndexes
      : parsed.indexes
          .map((displayIndex) => unknownIndexes[displayIndex])
          .filter((idx): idx is number => idx != null);
  const disposition =
    parsed.action === 'insumo_all' || parsed.action === 'insumo' ? 'insumo' : 'skip';
  entities.purchaseUnknownsAsked = true;
  await applyDispositionToLines(businessId, entities, targetIndexes, disposition);
  return prepareOperation(businessId, phone, 'create_purchase', entities, rubro);
}

async function handleSelectPurchaseNonCatalog(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const idx = purchaseLineIndex(payload);
  const line = idx != null ? purchaseLineAt(entities, idx) : undefined;
  const prompt = line ? formatPurchaseNonCatalogChoices(line) : '¿Lo descarto o lo cargo como gasto?';

  const raw = text.trim().toLowerCase();
  const skip =
    raw === '1' ||
    parsePurchaseLineDisposition(text) === 'skip' ||
    /^(descartar|sacar|sacalo|sacálo)$/i.test(raw);
  const insumo =
    raw === '2' ||
    parsePurchaseLineDisposition(text) === 'insumo' ||
    /^(gasto|gastos)$/i.test(raw);

  if (idx == null || (!skip && !insumo)) {
    if (looksLikePendingQuestion(text)) {
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        SELECT_PURCHASE_NON_CATALOG_INTENT,
        payload,
        prompt,
        'que elija descartar o cargarlo como gasto'
      );
    }
    await saveConversationState(businessId, phone, {
      pendingIntent: SELECT_PURCHASE_NON_CATALOG_INTENT,
      pendingPayload: payload,
      pendingPrompt: prompt,
    });
    return {
      reply: `No te seguí.\n\n${prompt}`,
      intent: SELECT_PURCHASE_NON_CATALOG_INTENT,
      executed: false,
      businessId,
    };
  }

  return resumePurchaseWithDisposition(
    businessId,
    phone,
    entities,
    payload,
    skip ? 'skip' : 'insumo',
    rubro
  );
}

async function handlePendingPurchasePack(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const idx = purchaseLineIndex(payload);
  const line = idx != null ? purchaseLineAt(entities, idx) : undefined;
  const prompt =
    line && idx != null
      ? formatPurchasePackChoices(line, {
          lineIndex: idx,
          lineCount: entities.purchaseLines?.length,
        })
      : '¿Cómo cargo el pack? 1 = unidades sueltas · 2 = como el renglón.';

  const raw = text.trim().toLowerCase();
  const disposition =
    raw === '3' || raw === '4'
      ? raw === '3'
        ? 'insumo'
        : 'skip'
      : parsePurchaseLineDisposition(text);
  if (disposition && idx != null) {
    return resumePurchaseWithDisposition(businessId, phone, entities, payload, disposition, rubro);
  }

  const expand =
    raw === '1' ||
    raw === 'pack' ||
    /\b(pack|unidades sueltas|4 un)/i.test(raw);
  const keep =
    raw === '2' ||
    /\b(rengl[oó]n|linea|línea|como est[aá])\b/i.test(raw);

  if (idx == null || !line || (!expand && !keep)) {
    return holdPendingAndAnswer(
      businessId,
      phone,
      text,
      SELECT_PURCHASE_PACK_INTENT,
      payload,
      prompt,
      'que elija cómo cargar el pack (1 o 2), INSUMO o SALTAR'
    );
  }

  const lines = [...(entities.purchaseLines ?? [])];
  lines[idx] = applyPurchasePackChoice(line, expand);
  entities.purchaseLines = lines;
  return prepareOperation(businessId, phone, 'create_purchase', entities, rubro);
}

async function handlePendingSelection(
  businessId: string,
  phone: string,
  text: string,
  kind: 'client' | 'product' | 'supplier',
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as NamedCandidate[];
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const query = String(payload.query ?? '');
  const allowCreate = payload.allowCreate === true;

  if (!originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  const rememberProduct = async (productId: string, productName: string) => {
    if (kind !== 'product' || !query.trim()) return;
    await saveProductAlias(businessId, query, { id: productId, nombre: productName });
  };

  const lineIdx = purchaseLineIndex(payload);
  const productChoiceOpts =
    originalIntent === 'create_purchase' && lineIdx != null
      ? purchaseChoiceOpts(entities, lineIdx)
      : {
          allowCreate: true,
          lineIndex: lineIdx ?? undefined,
          lineCount: Array.isArray(entities.purchaseLines) ? entities.purchaseLines.length : undefined,
          unitCost: purchaseLineCost(entities, payload),
          context: originalIntent === 'create_purchase' ? ('purchase' as const) : ('order' as const),
        };

  if (
    kind === 'product' &&
    originalIntent === 'create_purchase' &&
    purchaseLineIndex(payload) != null
  ) {
    const disposition = parsePurchaseLineDisposition(text);
    if (disposition) {
      return resumePurchaseWithDisposition(businessId, phone, entities, payload, disposition, rubro);
    }
  }

  if (/^(crear|nuevo)$/i.test(text.trim()) && allowCreate && query && kind === 'product') {
    try {
      const created = await createCatalogProductFromWhatsapp(businessId, {
        nombre: query,
        precioVenta: unitPriceFromEntities(entities),
        costo: purchaseLineCost(entities, payload),
        controlaStock: originalIntent === 'create_purchase',
      });
      applyProductToEntities(entities, created.id, created.nombre, payload);
      await rememberProduct(created.id, created.nombre);
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    } catch (error) {
      return {
        reply: await formatThrownUsage(error, businessId),
        intent: 'error',
        executed: false,
        businessId,
      };
    }
  }

  let choiceMatch = text.trim().match(/^(\d{1,2})$/);
  if (!choiceMatch) {
    const parsedFollow = await parsePendingFollowUp(businessId, text, pendingIntentForKind(kind), payload, rubro);
    const selectionPrompt =
      kind === 'client'
        ? formatClientChoices(candidates, query, { allowCreate })
        : kind === 'supplier'
          ? formatSupplierChoices(candidates, query, { allowCreate })
          : formatProductChoices(candidates, query, productChoiceOpts);
    const waitingFor =
      kind === 'client'
        ? 'que elija el cliente de la lista (un número)'
        : kind === 'supplier'
          ? 'que elija el proveedor de la lista (un número)'
          : 'que elija el producto de la lista (un número)';
    const isSidebarQuestion =
      parsedFollow.followUpAction === 'ask' ||
      parsedFollow.intent === 'help' ||
      parsedFollow.intent === 'greeting' ||
      looksLikePendingQuestion(text);
    if (isSidebarQuestion) {
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        pendingIntentForKind(kind),
        payload,
        selectionPrompt,
        waitingFor
      );
    }
    if (parsedFollow.followUpAction === 'choose' && parsedFollow.choiceIndex) {
      choiceMatch = String(parsedFollow.choiceIndex).match(/^(\d{1,2})$/);
    } else if (parsedFollow.followUpAction === 'cancel') {
      await clearConversationState(businessId, phone);
      return {
        reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
        intent: 'cancelled',
        executed: false,
        businessId,
      };
    } else if (
      parsedFollow.followUpAction === 'continue' ||
      parsedFollow.followUpAction === 'confirm' ||
      parsedFollow.followUpAction === 'new' ||
      extractDeliveryDateFromText(text) ||
      looksLikeIterativeCorrection(text)
    ) {
      return continueFromFollowUp(
        businessId,
        phone,
        text,
        pendingIntentForKind(kind),
        payload,
        rubro,
        parsedFollow
      );
    } else if (kind === 'client' && text.trim().length >= 2 && !isUnlikelyPersonName(text.trim())) {
      const typed = text.trim();
      const resolved = await resolveClientMatch(businessId, typed, {
        preferChoices: preferCatalogChoices(originalIntent),
        utterance: String(entities.sourceText ?? typed),
      });
      if (resolved.status === 'unique') {
        entities.spokenClientName = entities.spokenClientName || query || typed;
        entities.clientId = resolved.client.id;
        entities.clientName = resolved.client.nombre;
        return prepareOperation(businessId, phone, originalIntent, entities, rubro);
      }
      if (resolved.status === 'ambiguous') {
        await saveConversationState(businessId, phone, {
          pendingIntent: SELECT_CLIENT_INTENT,
          pendingPayload: {
            ...payload,
            query: typed,
            allowCreate: true,
            candidates: resolved.candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
          },
        });
        return {
          reply: formatClientChoices(resolved.candidates, typed, { allowCreate: true }),
          intent: SELECT_CLIENT_INTENT,
          executed: false,
          businessId,
        };
      }
      entities.clientName = typed;
      entities.spokenClientName = entities.spokenClientName || typed;
      entities.clientId = undefined;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    } else if (kind === 'supplier' && text.trim().length >= 2) {
      const typed = text.trim();
      const resolved = await resolveSupplierMatch(businessId, typed);
      if (resolved.status === 'unique') {
        entities.supplierId = resolved.supplier.id;
        entities.supplierName = resolved.supplier.nombre;
        return prepareOperation(businessId, phone, originalIntent, entities, rubro);
      }
      if (resolved.status === 'ambiguous') {
        await saveConversationState(businessId, phone, {
          pendingIntent: SELECT_SUPPLIER_INTENT,
          pendingPayload: {
            ...payload,
            query: typed,
            allowCreate: true,
            candidates: resolved.candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
          },
        });
        return {
          reply: formatSupplierChoices(resolved.candidates, typed, { allowCreate: true }),
          intent: SELECT_SUPPLIER_INTENT,
          executed: false,
          businessId,
        };
      }
      entities.supplierName = typed;
      entities.supplierId = undefined;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    if (!choiceMatch && kind === 'product' && text.trim().length >= 2) {
      const typed = text.trim();
      const resolved = await resolveProductMatch(businessId, typed, {
        preferChoices: preferCatalogChoices(originalIntent),
        utterance: String(entities.sourceText ?? typed),
      });
      if (resolved.status === 'unique') {
        applyProductToEntities(entities, resolved.product.id, resolved.product.label || resolved.product.nombre, payload);
        await rememberProduct(resolved.product.id, resolved.product.nombre);
        if (
          originalIntent !== 'create_purchase' &&
          entities.amount == null &&
          resolved.product.precioVenta > 0
        ) {
          const qty = Math.max(1, Number(entities.quantity) || 1);
          entities.amount = resolved.product.precioVenta * qty;
        }
        return prepareOperation(businessId, phone, originalIntent, entities, rubro);
      }
      if (resolved.status === 'ambiguous') {
        await saveConversationState(businessId, phone, {
          pendingIntent: SELECT_PRODUCT_INTENT,
          pendingPayload: {
            ...payload,
            query: query || typed,
            allowCreate: true,
            candidates: resolved.candidates.map((c) => ({
              id: c.id,
              nombre: c.nombre,
              label: c.label,
              score: c.score,
              precioVenta: c.precioVenta,
            })),
          },
        });
        return {
          reply: formatProductChoices(resolved.candidates, query || typed, productChoiceOpts),
          intent: SELECT_PRODUCT_INTENT,
          executed: false,
          businessId,
        };
      }
      if (originalIntent === 'create_purchase') {
        await saveConversationState(businessId, phone, {
          pendingIntent: CONFIRM_CREATE_PRODUCT,
          pendingPayload: {
            ...payload,
            query: query || typed,
            proposedName: typed,
            originalIntent,
            entities,
          },
        });
        const boleta = query || typed;
        return {
          reply:
            `No encontré "${typed}" en el catálogo.\n` +
            `¿Lo registro con ese nombre${boleta !== typed ? ` y lo vinculo a la boleta "${boleta}"` : ''}?\n` +
    `SÍ = crear (con el costo de la factura) · INSUMO = sin stock · SALTAR · otro nombre = buscar · NO = cancelar todo.`,
          intent: CONFIRM_CREATE_PRODUCT,
          executed: false,
          businessId,
        };
      }
      return {
        reply: `No encontré "${typed}" en el catálogo.\nEscribí otro nombre, un número de la lista, o CREAR.`,
        intent: SELECT_PRODUCT_INTENT,
        executed: false,
        businessId,
      };
    }
    if (!choiceMatch) {
      return {
        reply:
          kind === 'client'
            ? formatClientChoices(candidates, query, { allowCreate })
            : kind === 'supplier'
              ? formatSupplierChoices(candidates, query, { allowCreate })
              : formatProductChoices(candidates, query, productChoiceOpts),
        intent:
          kind === 'client'
            ? SELECT_CLIENT_INTENT
            : kind === 'supplier'
              ? SELECT_SUPPLIER_INTENT
              : SELECT_PRODUCT_INTENT,
        executed: false,
        businessId,
      };
    }
  }

  const index = Number(choiceMatch[1]) - 1;
  const purchaseExtras =
    kind === 'product' && originalIntent === 'create_purchase'
      ? purchaseDispositionChoiceIndexes(candidates.length, allowCreate, query)
      : null;

  if (purchaseExtras && (index === purchaseExtras.insumo || index === purchaseExtras.skip)) {
    return resumePurchaseWithDisposition(
      businessId,
      phone,
      entities,
      payload,
      index === purchaseExtras.skip ? 'skip' : 'insumo',
      rubro
    );
  }

  // Opción "Crear/registrar nuevo" = último número de catálogo (antes de insumo/saltar)
  if (allowCreate && query && index === candidates.length) {
    try {
      if (kind === 'product') {
        const created = await createCatalogProductFromWhatsapp(businessId, {
          nombre: query,
          precioVenta: unitPriceFromEntities(entities),
          costo: purchaseLineCost(entities, payload),
          controlaStock: originalIntent === 'create_purchase',
        });
        applyProductToEntities(entities, created.id, created.nombre, payload);
        await rememberProduct(created.id, created.nombre);
        if (originalIntent !== 'create_purchase' && entities.amount == null && created.precioVenta > 0) {
          const qty = Math.max(1, Number(entities.quantity) || 1);
          entities.amount = created.precioVenta * qty;
        }
      } else if (kind === 'supplier') {
        const created = await createSupplierFromWhatsapp(businessId, query);
        entities.supplierId = created.id;
        entities.supplierName = created.nombre;
      } else if (originalIntent === 'create_client') {
        entities.clientId = undefined;
        entities.clientName = query;
        return prepareOperation(businessId, phone, originalIntent, entities, rubro);
      } else {
        const created = await createClientFromWhatsapp(businessId, query);
        entities.clientId = created.id;
        entities.clientName = created.nombre;
      }
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    } catch (error) {
      return {
        reply: await formatThrownUsage(error, businessId),
        intent: 'error',
        executed: false,
        businessId,
      };
    }
  }

  const chosen = candidates[index];
  if (!chosen) {
    const maxChoice = purchaseExtras
      ? purchaseExtras.max + 1
      : candidates.length + (allowCreate && query ? 1 : 0);
    return {
      reply: `Número inválido. Elegí entre 1 y ${maxChoice}, o NO para cancelar.`,
      intent:
        kind === 'client'
          ? SELECT_CLIENT_INTENT
          : kind === 'supplier'
            ? SELECT_SUPPLIER_INTENT
            : SELECT_PRODUCT_INTENT,
      executed: false,
      businessId,
    };
  }

  if (kind === 'client') {
    entities.spokenClientName = entities.spokenClientName || query;
    entities.clientId = chosen.id;
    entities.clientName = chosen.nombre;
  } else if (kind === 'supplier') {
    entities.supplierId = chosen.id;
    entities.supplierName = chosen.nombre;
  } else {
    entities.spokenProductName = entities.spokenProductName || query;
    applyProductToEntities(entities, chosen.id, chosen.label || chosen.nombre, payload);
    await rememberProduct(chosen.id, chosen.nombre);
    if (
      originalIntent !== 'create_purchase' &&
      entities.amount == null &&
      Number(chosen.precioVenta) > 0
    ) {
      const qty = Math.max(1, Number(entities.quantity) || 1);
      entities.amount = Number(chosen.precioVenta) * qty;
    }
  }

  return prepareOperation(businessId, phone, originalIntent, entities, rubro);
}

async function handleConfirmCreateClient(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.clientName ?? '').trim();

  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    if (looksLikePendingQuestion(text)) {
      const prompt = `No encontré el cliente "${proposedName}".\n¿Lo registro y sigo?\nSÍ = crear · otro nombre = buscar ese · NO = cancelar.`;
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        CONFIRM_CREATE_CLIENT,
        payload,
        prompt,
        'confirmar si crea el cliente'
      );
    }
    const spoken = extractSpokenCorrections(text, entities);
    if (
      spoken.productName ||
      spoken.amount ||
      spoken.deliveryDate ||
      spoken.notes ||
      spoken.clearNotes ||
      looksLikeIterativeCorrection(text)
    ) {
      return continueFromFollowUp(businessId, phone, text, CONFIRM_CREATE_CLIENT, payload, rubro);
    }
    entities.clientName = spoken.clientName || text.trim();
    entities.clientId = undefined;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (!proposedName || !originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  try {
    const created = await createClientFromWhatsapp(businessId, proposedName);
    entities.clientId = created.id;
    entities.clientName = created.nombre;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: await formatThrownUsage(error, businessId),
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleConfirmCreateProduct(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.productName ?? '').trim();

  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!originalIntent || !proposedName) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  if (/^(texto|concepto|solo esta vez)$/i.test(text.trim()) && originalIntent !== 'create_purchase') {
    entities.productId = undefined;
    entities.productName = proposedName;
    entities.productAsConcept = true;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (originalIntent === 'create_purchase') {
    const disposition = parsePurchaseLineDisposition(text);
    if (disposition) {
      return resumePurchaseWithDisposition(businessId, phone, entities, payload, disposition, rubro);
    }
  }

  if (!CONFIRM_YES.test(text.trim())) {
    if (looksLikePendingQuestion(text)) {
      const prompt =
        originalIntent === 'create_purchase'
          ? `No encontré "${proposedName}" en el catálogo.\n` +
            `SÍ = crear (suma stock) · INSUMO = gasto/herramienta sin stock · SALTAR · otro nombre = buscar · NO = cancelar todo.`
          : `No encontré "${proposedName}" en el catálogo.\n` +
            `¿Lo guardo en el catálogo${entities.amount != null ? ` a $${entities.amount}` : ''}? (solo para pedidos/ventas, sin control de stock)\n` +
            `SÍ = crear y usar · otro nombre = buscar ese · NO = cancelar.`;
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        CONFIRM_CREATE_PRODUCT,
        payload,
        prompt,
        'confirmar si crea el producto'
      );
    }
    return continueFromFollowUp(businessId, phone, text, CONFIRM_CREATE_PRODUCT, payload, rubro);
  }

  try {
    const created = await createCatalogProductFromWhatsapp(businessId, {
      nombre: proposedName,
      precioVenta: unitPriceFromEntities(entities),
      costo: purchaseLineCost(entities, payload),
      controlaStock: originalIntent === 'create_purchase',
    });
    applyProductToEntities(entities, created.id, created.nombre, payload);
    const invoiceAlias = String(payload.query ?? '').trim();
    if (invoiceAlias) {
      await saveProductAlias(businessId, invoiceAlias, { id: created.id, nombre: created.nombre });
    }
    if (
      originalIntent !== 'create_purchase' &&
      entities.amount == null &&
      created.precioVenta > 0
    ) {
      const qty = Math.max(1, Number(entities.quantity) || 1);
      entities.amount = created.precioVenta * qty;
    }
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: await formatThrownUsage(error, businessId),
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleConfirmCreateSupplier(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const proposedName = String(payload.proposedName ?? entities.supplierName ?? '').trim();

  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    if (looksLikeIterativeCorrection(text) && !/\bproveedor\b/i.test(text)) {
      return continueFromFollowUp(businessId, phone, text, CONFIRM_CREATE_SUPPLIER, payload, rubro);
    }
    entities.supplierName = text.trim();
    entities.supplierId = undefined;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  if (!proposedName || !originalIntent) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el contexto. Mandá de nuevo la operación.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  try {
    const created = await createSupplierFromWhatsapp(businessId, proposedName);
    entities.supplierId = created.id;
    entities.supplierName = created.nombre;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  } catch (error) {
    return {
      reply: error instanceof Error ? error.message : 'No pude registrar el proveedor.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }
}

async function handleSelectPurchasePayment(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const ctx = await loadPurchasePaymentContext(businessId);
  const trimmed = text.trim();
  const cuotas = extractPaymentCuotas(trimmed);
  if (cuotas) entities.paymentCuotas = cuotas;

  if (isDraftRequest(trimmed)) {
    applyDraftToEntities(entities);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const choiceMatch = trimmed.match(/^(\d{1,2})$/);
  if (choiceMatch) {
    const index = Number(choiceMatch[1]) - 1;
    if (index === ctx.medios.length) {
      applyDraftToEntities(entities);
      return ensurePurchasePayment(businessId, phone, entities);
    }
    const medio = ctx.medios[index];
    if (!medio) {
      return {
        reply: formatPaymentChoices(ctx.medios),
        intent: SELECT_PAYMENT_INTENT,
        executed: false,
        businessId,
      };
    }
    applyMedioToEntities(entities, medio);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const matched = matchMedioFromText(trimmed, ctx.medios);
  if (matched) {
    applyMedioToEntities(entities, matched);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  return {
    reply: `No reconocí ese medio.\n\n${formatPaymentChoices(ctx.medios)}`,
    intent: SELECT_PAYMENT_INTENT,
    executed: false,
    businessId,
  };
}

async function handleSelectPurchaseCard(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim()) || /^cancelar$/i.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const payload = pendingPayload ?? {};
  const entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as Array<{
    id: string;
    nombre: string;
  }>;
  const trimmed = text.trim();

  if (isDraftRequest(trimmed)) {
    applyDraftToEntities(entities);
    return ensurePurchasePayment(businessId, phone, entities);
  }

  const choiceMatch = trimmed.match(/^(\d{1,2})$/);
  if (choiceMatch) {
    const index = Number(choiceMatch[1]) - 1;
    if (index === candidates.length) {
      applyDraftToEntities(entities);
      return ensurePurchasePayment(businessId, phone, entities);
    }
    const chosen = candidates[index];
    if (chosen) {
      applyCardToEntities(entities, { id: chosen.id, label: chosen.nombre, ambitoDefault: 'negocio', activa: true, medioPagoId: entities.paymentMedioId ?? '' });
      return ensurePurchasePayment(businessId, phone, entities);
    }
  }

  const n = trimmed.toLowerCase();
  const byName = candidates.find((c) => c.nombre.toLowerCase() === n || c.nombre.toLowerCase().includes(n));
  if (byName) {
    applyCardToEntities(entities, {
      id: byName.id,
      label: byName.nombre,
      ambitoDefault: 'negocio',
      activa: true,
      medioPagoId: entities.paymentMedioId ?? '',
    });
    return ensurePurchasePayment(businessId, phone, entities);
  }

  return {
    reply: formatCardChoices(
      candidates.map((c) => ({
        id: c.id,
        label: c.nombre,
        ambitoDefault: 'negocio',
        activa: true,
        medioPagoId: entities.paymentMedioId ?? '',
      }))
    ),
    intent: SELECT_CARD_INTENT,
    executed: false,
    businessId,
  };
}

async function handlePendingConfirmation(
  businessId: string,
  phone: string,
  text: string,
  pendingIntent: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const intent = pendingIntent.startsWith(CONFIRM_INTENT_PREFIX)
    ? pendingIntent.slice(CONFIRM_INTENT_PREFIX.length)
    : pendingIntent;

  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: waCard({
        title: 'Cancelado',
        ask: 'Escribime de nuevo cuando quieras.',
      }),
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    const payload = pendingPayload ?? {};
    if (looksLikePendingQuestion(text) || (await parsePendingFollowUp(businessId, text, pendingIntent, payload, rubro)).followUpAction === 'ask') {
      const entities = payloadEntities(payload);
      const prompt = confirmationReply(intent, entities);
      return holdPendingAndAnswer(
        businessId,
        phone,
        text,
        pendingIntent,
        payload,
        prompt,
        'confirmar si guarda (SÍ / NO)'
      );
    }
    return continueFromFollowUp(businessId, phone, text, pendingIntent, payload, rubro);
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'No encontré tu cuenta. Contactá a soporte.',
      intent: 'error',
      executed: false,
    };
  }

  const entities = (pendingPayload ?? {}) as WhatsappCommandEntities;
  const parsed = {
    intent,
    confidence: 1,
    entities,
    raw: String(entities.notes ?? text),
  } as ParsedWhatsappCommand;

  const result = await executeWhatsappCommand(tenant, parsed);
  if (result.executed) {
    try {
      await rememberConfirmedOperation(tenant.businessId, entities);
    } catch (error) {
      console.warn('[whatsapp] operator memory save failed:', error);
    }
    const last = lastOperationFromResult(result, entities);
    if (intent === 'update_order_status' && String(entities.orderStatus) === 'listo') {
      const saldo = Number(entities.targetOrderSaldo) || 0;
      if (saldo > 0 && (entities.paid || entities.payFullBalance || Number(entities.amount) > 0)) {
        const payEntities: WhatsappCommandEntities = {
          ...entities,
          paymentKind: 'pago',
          payFullBalance:
            Boolean(entities.paid || entities.payFullBalance) && !(Number(entities.amount) > 0),
        };
        const pay = await executeWhatsappCommand(tenant, {
          intent: 'register_payment',
          confidence: 1,
          entities: payEntities,
          raw: text,
        } as ParsedWhatsappCommand);
        const payLast = lastOperationFromResult(pay, payEntities) ?? last;
        if (payLast) await rememberLastOperation(businessId, phone, payLast);
        else await clearConversationState(businessId, phone);
        return {
          reply: [result.reply, pay.reply].filter(Boolean).join('\n\n'),
          replies: [result.reply, pay.reply].filter((page) => Boolean(page)),
          intent: pay.executed ? 'register_payment' : result.intent,
          executed: true,
          businessId,
        };
      }
      if (saldo > 0) {
        const ask = formatSettleAsk(
          String(entities.targetOrderLabel ?? ''),
          String(entities.clientName ?? ''),
          saldo
        );
        await saveConversationState(businessId, phone, {
          pendingIntent: SETTLE_ORDER_INTENT,
          pendingPayload: {
            originalIntent: 'register_payment',
            entities: { ...entities, paymentKind: 'pago' },
          },
          pendingPrompt: ask,
          lastOperation: last ?? undefined,
        });
        return {
          reply: result.reply,
          replies: [result.reply, ask],
          intent: SETTLE_ORDER_INTENT,
          executed: true,
          businessId,
        };
      }
    }
    if (last) {
      await rememberLastOperation(businessId, phone, last);
    } else {
      await clearConversationState(businessId, phone);
    }
  } else {
    await clearConversationState(businessId, phone);
  }

  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId,
  };
}

export async function handleWhatsappMessage(
  message: WhatsappInboundMessage
): Promise<WhatsappHandlerResult> {
  const result = await handleWhatsappTurn(message);
  if (!result.reply && !result.replies?.length) return result;
  const pages =
    result.replies && result.replies.length > 1
      ? result.replies
      : splitWaBubbles(result.reply);
  if (!pages.length) return result;
  if (
    result.businessId &&
    result.intent !== 'wa_quota' &&
    result.intent !== 'ai_quota'
  ) {
    try {
      const warn = await maybeWhatsappQuotaWarning(result.businessId);
      if (warn) pages.push(warn);
    } catch (error) {
      console.warn('[whatsapp] quota warning:', error);
    }
  }
  return {
    ...result,
    reply: pages[0] ?? result.reply,
    replies: pages.length > 1 ? pages : undefined,
  };
}

async function handleWhatsappTurn(
  message: WhatsappInboundMessage
): Promise<WhatsappHandlerResult> {
  const phone = message.from.trim();
  let text = String(message.text ?? '').trim();
  const mediaId = message.mediaId?.trim() || null;
  const isAudio = message.mediaType === 'audio';
  const isImage = message.mediaType === 'image' || Boolean(mediaId && !isAudio);

  if (!phone || (!text && !mediaId)) {
    return { reply: '', intent: 'empty', executed: false };
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return handleUnregisteredWhatsapp(phone, text);
  }

  if (tenant.accessRevoked) {
    return {
      reply:
        `Este WhatsApp está dado de baja en la cuenta.\n\n` +
        `Si lo reactivaste desde Superadmin o Planes, escribime de nuevo en un momento. ` +
        `Si sigue sin andar, pedile al admin que vuelva a dar de alta el número en la empresa.`,
      intent: 'account_offboarded',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  try {
    await assertCanSendWhatsapp(tenant.businessId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      const reply =
        error instanceof Error && error.message === 'WA_BUBBLE_QUOTA_EXCEEDED'
          ? await whatsappQuotaNoticeOrSilent(tenant.businessId)
          : await formatThrownUsage(error, tenant.businessId);
      return {
        reply,
        intent: 'wa_quota',
        executed: false,
        businessId: tenant.businessId,
      };
    }
  }

  const business = await getBusiness(tenant.businessId);
  const guard = assertWhatsappFeatures(tenant, {
    subscriptionActive: !isSubscriptionBlocked(business),
  });

  if (!guard.ok) {
    return {
      reply: guard.message,
      intent: guard.reason,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  let image: { buffer: Buffer; contentType: string } | null = null;
  let audio: { buffer: Buffer; contentType: string } | null = null;
  if (mediaId) {
    const media = await downloadWhatsappMedia(mediaId);
    if (isAudio) {
      if (!media) {
        return {
          reply:
            'Recibí el audio pero no pude bajarlo. Probá mandarlo de nuevo, o escribí el mensaje.',
          intent: 'error',
          executed: false,
          businessId: tenant.businessId,
        };
      }
      if (media.buffer.length > MAX_AUDIO_BYTES) {
        return {
          reply: 'Ese audio es largo. Mandame uno de hasta 1 minuto, o escribilo.',
          intent: 'audio_too_long',
          executed: false,
          businessId: tenant.businessId,
        };
      }
      audio = media;
    } else {
      image = media;
      if (!image && !text) {
        return {
          reply:
            'Recibí la imagen pero no pude descargarla. Probá mandarla de nuevo, o escribí “compra” y el detalle del remito.',
          intent: 'error',
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }
  }

  if (image || audio) {
    try {
      await assertCanUseAi(tenant.businessId, 2);
    } catch (error) {
      if (isUsageLimitError(error)) {
        return {
          reply: await formatThrownUsage(error, tenant.businessId),
          intent: 'ai_quota',
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }
  }

  let parsed: ParsedWhatsappCommand | null = null;
  if (audio && !text) {
    parsed = await parseWhatsappCommand({
      text: '',
      audio,
      mediaId: null,
      rubro: tenant.rubro,
      businessId: tenant.businessId,
    });
    const transcript = String(parsed.raw ?? '').trim();
    if (!transcript) {
      return {
        reply: 'No pude entender el audio. Mandalo de nuevo más corto, o escribilo.',
        intent: 'audio_unreadable',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    text = transcript;
  }

  const state = await getConversationState(tenant.businessId, phone);
  if (state?.pendingIntent === HELP_TOPIC_INTENT && text) {
    if (isHelpFollowUp(text) || matchSetupLoad(text)) {
      return handleHelpTurn(
        tenant,
        text,
        state.pendingPayload
      );
    }
    await saveConversationState(tenant.businessId, phone, {
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
    });
  } else if (state?.pendingIntent && text) {
    if (isOnboardingIntent(state.pendingIntent)) {
      const onboarded = await handleOnboardingPending(
        tenant,
        text,
        state.pendingIntent,
        state.pendingPayload
      );
      if (onboarded) return onboarded;
    } else if (isFreshTaskUtterance(text, state.pendingIntent)) {
      await saveConversationState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
      });
    } else {
    if (!doesFillCurrentSlot(text, state.pendingIntent, state.pendingPayload ?? {})) {
      const payload = mergeStashIntoPayload({ ...(state.pendingPayload ?? {}) }, text);
      const prompt =
        String(state.pendingPrompt ?? '').trim() ||
        reconstructPendingPrompt(state.pendingIntent, payload);
      return holdPendingAndAnswer(
        tenant.businessId,
        phone,
        text,
        state.pendingIntent,
        payload,
        prompt,
        waitingLabel(state.pendingIntent, payload)
      );
    }
    if (state.pendingIntent === SELECT_CLIENT_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'client',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_SUPPLIER_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'supplier',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PRODUCT_INTENT) {
      return handlePendingSelection(
        tenant.businessId,
        phone,
        text,
        'product',
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PURCHASE_UNKNOWNS_INTENT) {
      return handleSelectPurchaseUnknowns(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PURCHASE_NON_CATALOG_INTENT) {
      return handleSelectPurchaseNonCatalog(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PURCHASE_PACK_INTENT) {
      return handlePendingPurchasePack(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === CONFIRM_CREATE_CLIENT) {
      return handleConfirmCreateClient(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === CONFIRM_CREATE_SUPPLIER) {
      return handleConfirmCreateSupplier(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PAYMENT_INTENT) {
      return handleSelectPurchasePayment(tenant.businessId, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === SELECT_CARD_INTENT) {
      return handleSelectPurchaseCard(tenant.businessId, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === SELECT_CASH_AMBITO_INTENT) {
      return handleSelectCashAmbito(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_PAYMENT_KIND_INTENT) {
      return handleSelectPaymentKind(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SELECT_ORDER_INTENT) {
      return handleSelectOrder(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === ORDER_ACTION_INTENT) {
      return handleOrderAction(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (state.pendingIntent === SETTLE_ORDER_INTENT) {
      return handleSettleOrder(tenant.businessId, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === CONFIRM_CREATE_PRODUCT) {
      return handleConfirmCreateProduct(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (
      state.pendingIntent === CLARIFY_INTENT &&
      String((state.pendingPayload ?? {}).missingField ?? '') === 'intent'
    ) {
      return handleClarifiedIntent(tenant, phone, text, state.pendingPayload);
    }
    if (state.pendingIntent === CLARIFY_INTENT) {
      return handlePendingClarify(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
    }
    if (
      state.pendingIntent.startsWith(CONFIRM_INTENT_PREFIX) ||
      needsConfirmation(state.pendingIntent)
    ) {
      return handlePendingConfirmation(
        tenant.businessId,
        phone,
        text,
        state.pendingIntent,
        state.pendingPayload,
        tenant.rubro
      );
    }
    }
  }

  if (!parsed) {
    if (text && !mediaId && isThanksText(text)) {
      return {
        reply: 'Dale.',
        intent: 'thanks',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    parsed = await parseWhatsappCommand({
      text,
      image,
      audio,
      mediaId: isImage ? mediaId : null,
      rubro: tenant.rubro,
      businessId: tenant.businessId,
      conversation: state?.lastOperation
        ? { lastOperation: state.lastOperation }
        : undefined,
    });
  } else if (parsed.intent === 'unknown' && state?.lastOperation && looksLikeStatusQuery(text)) {
    const clientName = extractQueryClientFromText(text) || undefined;
    const orderNumber = extractOrderNumberFromText(text) || undefined;
    parsed = {
      intent: 'query_status',
      confidence: 0.85,
      entities: {
        referToLast: !clientName && !orderNumber,
        sourceText: text,
        ...(clientName ? { clientName, spokenClientName: clientName } : {}),
        ...(orderNumber ? { orderNumber } : {}),
      },
      raw: text,
    };
  }

  if (isAudio && parsed.intent === 'unknown' && !String(parsed.raw ?? '').trim()) {
    return {
      reply: 'No pude entender el audio. Mandalo de nuevo más corto, o escribilo.',
      intent: 'audio_unreadable',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (parsed.intent === 'greeting') {
    if (text && isThanksText(text)) {
      return {
        reply: 'Dale.',
        intent: 'thanks',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    return beginWelcome(tenant);
  }

  const setupStep = text && !mediaId ? matchSetupLoad(text) : null;
  if (setupStep) {
    return startSetupStep(tenant, setupStep);
  }

  if (isSetupReopenText(text) && !mediaId) {
    return reopenSetupMenu(tenant);
  }

  if (parsed.intent === 'unknown') {
    return askUnknownIntent(tenant, phone, text, state?.lastOperation ?? null, 1);
  }

  if (parsed.intent === 'help') {
    return handleHelpTurn(tenant, text);
  }

  if (parsed.intent === 'query_status' || parsed.intent === 'query_cash') {
    if (parsed.intent === 'query_status') {
      const entities = entitiesFromParsed(parsed, isImage ? mediaId : null);
      if (entities.listOrders || looksLikeListOrders(text) || entities.clientName || entities.productName) {
        return offerOpenOrderPick(tenant.businessId, phone, {
          originalIntent: 'query_status',
          entities,
          rubro: tenant.rubro,
        });
      }
    }
    const result = await executeWhatsappCommand(tenant, parsed);
    if (parsed.intent === 'query_cash') {
      await saveConversationState(tenant.businessId, phone, { setupStatus: 'done' });
    }
    return {
      reply: result.reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  }

  const entities = entitiesFromParsed(parsed, isImage ? mediaId : null);
  return prepareOperation(tenant.businessId, phone, parsed.intent, entities, tenant.rubro);
}
