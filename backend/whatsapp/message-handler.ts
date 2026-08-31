import { getBusiness } from '../auth/business.ts';
import { assertCanUseAi, formatThrownUsage, isUsageLimitError, resolveBillingMode, assertCanSendWhatsapp, whatsappQuotaNoticeOrSilent, maybeWhatsappQuotaWarning } from '../auth/usage-gates.ts';
import { resolveTenantByPhone, type WhatsappTenantContext } from './tenant-resolver.ts';
import { assertWhatsappFeatures } from './feature-guard.ts';
import {
  clearConversationState,
  clearConversationTask,
  dropConversationContext,
  getConversationState,
  rememberFocusOrder,
  rememberLastOperation,
  rememberLastQuery,
  saveConversationState,
  activeTaskFromPending,
  type ConversationState,
  type ConversationListContext,
  type LastWhatsappOperation,
} from './conversation-state.ts';
import { interpretTurn } from './conversation-engine.ts';
import { buildOperationPlan } from './operation-plan.ts';
import { isLlmFirstEngine, isV3Engine, isV4Engine } from './engine-version.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { interpretLlmFirstTurn, matchDeterministicBypass, isUnequivocalUiReply } from './conversation-orchestrator-v2.ts';
import { executeV3QueryTurn } from './conversation-orchestrator-v3.ts';
import type { TurnInterpretation } from './turn-interpretation.ts';
import { capabilityNotEnabledReply } from './capability-registry.ts';
import {
  INTERPRETER_UNAVAILABLE_REPLY,
  isInterpreterTechnicalFailure,
} from './interpreter-availability.ts';
import {
  applyEntityUpdates,
  sanitizeWhatsappEntities,
  looksLikeListOrders,
  looksLikeCashMovement,
  looksLikeOrderStatusUpdate,
  parseWithRules,
  type ParsedWhatsappCommand,
  type WhatsappCommandEntities,
  type WhatsappParseConversation,
  type WhatsappIntent,
} from './ai-command-parser.ts';
import { catalogQueryForItem } from './conversation-contract.ts';
import {
  applyFollowUpToEntities,
  appendOrderItemBatch,
  classifyConfirmReply,
  ensureOrderItems,
  parseChoiceFromText,
  syncLegacyProductFields,
  normalizeOrderLineItems,
} from './turn-interpreter.ts';
import { logWhatsappTurn, traceOrderItems } from './conversation-log.ts';
import {
  applyLanguageMemory,
  loadUserLanguageMemory,
  rememberSpokenProductTerms,
} from './language-memory.ts';
import { executeWhatsappCommand } from './erp-integration.ts';
import { presentOrderCollecting, presentTransaction } from './whatsapp-present.ts';
import { shouldAskOrderExtraCosts, ORDER_EXTRA_COST_ASK } from './order-finance.ts';
import { clientLookupQuery } from './entity-name.ts';
import {
  applyQueryFollowUp,
  entitiesFromLastQuery,
  isQueryIntent,
  lastQueryFromEntities,
  looksLikeListContinue,
  looksLikeQueryFollowUp,
  looksLikeWantAll,
} from './query-follow.ts';
import { takeDualIntent } from './task-queue.ts';
import {
  beginWelcome,
  handleOnboardingPending,
  isOnboardingIntent,
  isSetupReopenText,
  reopenSetupMenu,
  startSetupStep,
} from './onboarding.ts';
import { downloadWhatsappMedia } from './meta-api.ts';
import { looksLikePendingQuestion, answerWhileWaiting, isTrivialWhatsappTurn } from './operator-voice.ts';
import {
  RESUME_CONTEXT_INTENT,
  classifyConversationSpeechAct,
  doesFillCurrentSlot,
  formatResumeAsk,
  isConversationIdle,
  isFreshTaskUtterance,
  looksLikeResumeNo,
  looksLikeResumeYes,
  mergeStashIntoPayload,
  parsedIntentSkipsIdleResume,
  reconstructPendingPrompt,
  routeResumeUtterance,
  shouldAskIdleResume,
  waitingLabel,
} from './conversation-follow.ts';
import {
  STOCK_RESOLUTION_INTENT,
  formatStockResolutionAsk,
  interpretStockResolutionFromText,
  parseRequestedStockScope,
  scopeFromStockResolution,
  splitCompoundStockUtterance,
} from './stock-resolution.ts';
import {
  COLLECT_ORDER_ITEMS_INTENT,
  formatCapabilityOrderReply,
  formatCollectOrderItemsAsk,
  formatHowToReply,
  hasRealOrderItems,
  howToTopicFromText,
  isPlaceholderProductLabel,
  looksLikeCollectingDone,
  productParserAllowed,
  shouldOpenItemCollection,
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
} from './conversation-speech.ts';
import type { StockDiscountAsk } from '../utils/order-config.ts';
import {
  extractAmountFromText,
  extractClientHintFromText,
  extractRegisterClientFromText,
  extractDeliveryDateFromText,
  extractNotesHintFromText,
  extractProductHintFromText,
  extractSpokenCorrections,
  extractExtraCostsFromText,
  extractExtraCostProductHint,
  mergeExtraCostItems,
  parseSpokenExtraCostAnswer,
  needsExtraCostItemAsk,
  resolveExtraCostTargetIndex,
  formatExtraCostItemAsk,
  extraCostItemLabels,
  looksLikePayEverythingNow,
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
  sanitizeOrderNotes,
  isUnlikelyPersonName,
  looksLikeIterativeCorrection,
  looksLikeNewOrder,
  looksLikeCollectFullBalance,
  looksLikeExistingOrderQuery,
  looksLikeStatusQuery,
  extractQueryClientFromText,
  extractOrderNumberFromText,
  resolveClientMatch,
  resolveProductMatch,
  resolveSupplierMatch,
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
  loadBusinessOrderExtraCostsEnabled,
  resolveOrderForCost,
} from './erp-writes.ts';
import {
  closedOrderReason,
  formatFindOrderGuide,
  formatOpenOrderChoices,
  formatOrderActionAsk,
  formatOrderStatusAsk,
  formatPaymentAmountAsk,
  formatSettleAsk,
  listWhatsappOrdersWithFallback,
  previewOrderStatusChange,
  resolveOrderForStatus,
  type OrderStatusTarget,
  type WhatsappOrderStatus,
} from './order-status.ts';
import { handleUnregisteredWhatsapp } from './unregistered-signup.ts';
import { askWhatYouMeant } from './clarify.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { handleHelpTurn, HELP_TOPIC_INTENT, isHelpFollowUp, matchSetupLoad } from './help.ts';
import { isThanksText } from '../../shared/whatsapp-copy.ts';
import { splitWaBubbles, waBold, waCard, renderListPage, WA_PRESENT } from '../../shared/whatsapp-format.ts';
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
  /** Id del mensaje inbound de Meta; se usa como idempotencyKey de caja. */
  messageId?: string | null;
  /** Evita repreguntar “¿seguimos?” al retomar el mismo turno. */
  skipIdleResume?: boolean;
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
  /(?<![\p{L}])(pag[oó]|cobr(?:ar|[aeéoó])|abon|se[nñ]a|sald(?:alo|ar)|pago\s+del\s+total|todo\s+el\s+saldo|ya\s+pag[oó])(?![\p{L}])/iu;
const ORDER_ACTION_INTENT = 'order_action';
const SETTLE_ORDER_INTENT = 'settle_order';
const CONFIRM_CREATE_CLIENT = 'confirm_create_client';
const CONFIRM_CREATE_PRODUCT = 'confirm_create_product';
const CONFIRM_CREATE_SUPPLIER = 'confirm_create_supplier';
const CONFIRM_INTENT_PREFIX = 'confirm:';

type NamedCandidate = { id: string; nombre: string; label?: string; score?: number; precioVenta?: number };

function extraCostsDeliveryAsk(entities: WhatsappCommandEntities): string {
  return presentOrderCollecting(entities, '📅 ¿Para qué fecha es la entrega?');
}

function extraCostsDirectAsk(entities: WhatsappCommandEntities): string {
  return presentOrderCollecting(entities, ORDER_EXTRA_COST_ASK);
}

async function ensureOrderExtraCostsConfig(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappCommandEntities> {
  if (entities.extraCostsEnabled != null) return entities;
  entities.extraCostsEnabled = await loadBusinessOrderExtraCostsEnabled(businessId);
  return entities;
}

function applyDisabledExtraCosts(entities: WhatsappCommandEntities): string | null {
  const extras = (entities.extraCosts ?? []).filter((item) => Number(item.costo) > 0);
  if (entities.extraCostsEnabled !== false || !extras.length) return null;
  entities.extraCosts = [];
  entities.extraCostsAsked = true;
  entities.extraCostsNotice =
    '⚠️ Este negocio no tiene habilitados costos extra en pedidos.';
  return entities.extraCostsNotice;
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
  const status = String(data.status ?? data.estado ?? entities.orderStatus ?? '').trim() || undefined;
  const clientId = String(data.clientId ?? entities.clientId ?? '').trim() || undefined;
  const item = entities.items?.[0];
  const productId = String(data.productId ?? entities.productId ?? item?.productId ?? '').trim() || undefined;
  const productName =
    String(data.productName ?? entities.productName ?? item?.productName ?? item?.productHint ?? '').trim() ||
    undefined;
  return {
    kind,
    id,
    label: String(data.label ?? '').trim() || undefined,
    clientName: String(data.clientName ?? entities.clientName ?? '').trim() || undefined,
    clientId,
    status,
    amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    productId,
    productName,
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

function stampInboundIdempotency(
  entities: WhatsappCommandEntities,
  messageId?: string | null
): void {
  const id = String(messageId ?? '').trim();
  if (id && !entities.idempotencyKey) {
    entities.idempotencyKey = `wa:${id}`;
  }
}

function parseConversationFromState(
  state: ConversationState | null | undefined,
  extra?: WhatsappParseConversation
): WhatsappParseConversation | undefined {
  if (!state && !extra) return undefined;
  const payload = (state?.pendingPayload ?? {}) as Record<string, unknown>;
  const fromPayload =
    payload.entities && typeof payload.entities === 'object' && !Array.isArray(payload.entities)
      ? (payload.entities as WhatsappCommandEntities)
      : ((payload.clientName || payload.targetOrderId || payload.cashType || payload.amount) && !payload.candidates
          ? (payload as WhatsappCommandEntities)
          : undefined);
  return {
    lastOperation: extra?.lastOperation ?? state?.lastCompletedOperation ?? state?.lastOperation ?? null,
    focusOrder: extra?.focusOrder ?? state?.focusOrder ?? null,
    focusEntities: extra?.focusEntities ?? state?.focusEntities ?? null,
    lastQuery: extra?.lastQuery ?? state?.lastQuery ?? null,
    pendingIntent: extra?.pendingIntent ?? state?.pendingIntent ?? undefined,
    pendingPrompt: extra?.pendingPrompt ?? state?.pendingPrompt ?? undefined,
    turns: extra?.turns ?? state?.turns ?? undefined,
    originalIntent:
      extra?.originalIntent ||
      (typeof payload.originalIntent === 'string' ? payload.originalIntent : undefined),
    awaiting:
      extra?.awaiting ??
      (String(extra?.pendingIntent ?? state?.pendingIntent ?? '') === STOCK_RESOLUTION_INTENT
        ? STOCK_RESOLUTION_INTENT
        : state?.activeTask?.awaiting?.field ||
          (String(state?.pendingIntent ?? '').startsWith('confirm:') ? 'confirmation' : undefined) ||
          String(state?.pendingIntent ?? '').trim() ||
          undefined),
    knownEntities: extra?.knownEntities ?? fromPayload,
    missingKeys: extra?.missingKeys,
    candidates: extra?.candidates,
    languageMemory: extra?.languageMemory,
  };
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
  const query = resolved.status === 'unique' ? productQuery : resolved.query;
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
  const itemIndex = Number.isInteger(Number(payload.itemIndex)) ? Number(payload.itemIndex) : null;
  ensureOrderItems(entities);
  if (itemIndex != null && entities.items?.[itemIndex]) {
    entities.items[itemIndex] = {
      ...entities.items[itemIndex]!,
      productId,
      productName,
      skipped: false,
      productLocked: true,
    };
    syncLegacyProductFields(entities);
    return;
  }
  entities.productId = productId;
  entities.productName = productName;
}

function confirmationMessages(intent: string, entities: WhatsappCommandEntities): string[] {
  if (intent === 'create_purchase') return formatPurchaseConfirmationMessages(entities);
  const presented = presentTransaction(intent, entities);
  if (presented.length) return presented;
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

async function continueQueryOrList(
  tenant: WhatsappTenantContext,
  phone: string,
  text: string,
  state: ConversationState | null
): Promise<WhatsappHandlerResult | null> {
  const list = state?.listContext;
  if (list?.hasMore && looksLikeListContinue(text) && state?.lastQuery) {
    const offset = (Number(list.offset) || 0) + (Number(list.pageSize) || 10);
    const last = state.lastQuery;
    const entities = {
      ...entitiesFromLastQuery({ intent: last.intent as WhatsappIntent, slots: last.slots }),
      sourceText: text,
      queryOffset: offset,
      queryPage: 'next' as const,
      listOrders: true,
    };
    return executeReadQuery(tenant.businessId, phone, last.intent, entities);
  }
  if (list?.items?.length && (looksLikeListContinue(text) || looksLikeWantAll(text))) {
    const wantAll = looksLikeWantAll(text) || list.wantAll === true;
    const page = looksLikeListContinue(text) ? (list.currentPage || 1) + 1 : list.currentPage || 1;
    const pages = renderListPage({
      title: list.title || 'Resultados',
      items: list.items,
      currentPage: wantAll ? 1 : page,
      pageSize: list.pageSize || WA_PRESENT.explorePageSize,
      wantAll,
    });
    await saveConversationState(tenant.businessId, phone, {
      listContext: {
        ...list,
        currentPage: wantAll ? Math.max(1, Math.ceil(list.items.length / (list.pageSize || WA_PRESENT.explorePageSize))) : page,
        wantAll,
      },
    });
    return {
      reply: pages[0] ?? '',
      replies: pages.length > 1 ? pages : undefined,
      intent: String(state?.lastQuery?.intent ?? 'query_status'),
      executed: true,
      businessId: tenant.businessId,
    };
  }

  const last = state?.lastQuery;
  if (last && looksLikeQueryFollowUp(text, { intent: last.intent as WhatsappIntent, slots: last.slots })) {
    const next = applyQueryFollowUp(text, {
      intent: last.intent as WhatsappIntent,
      slots: last.slots,
    });
    const entities = {
      ...entitiesFromLastQuery(next),
      sourceText: text,
      listWantAll: looksLikeWantAll(text) || undefined,
    };
    return executeReadQuery(tenant.businessId, phone, next.intent, entities);
  }
  return null;
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
  const listItems = Array.isArray(result.data?.listItems)
    ? result.data.listItems.map((item) => String(item))
    : undefined;
  const listContext: ConversationListContext | null =
    listItems && listItems.length
      ? {
          type: intent === 'query_stock' ? 'stock' : 'orders',
          items: listItems,
          currentPage: 1,
          pageSize: Number(result.data?.pageSize ?? WA_PRESENT.explorePageSize) || WA_PRESENT.explorePageSize,
          totalResults: Number(result.data?.total ?? listItems.length) || listItems.length,
          title: String(result.data?.title ?? ''),
          wantAll: entities.listWantAll === true,
          hasMore: result.data?.hasMore === true,
          offset: Number(result.data?.offset ?? 0) || 0,
          filters: lastQueryFromEntities(intent as WhatsappIntent, entities).slots,
        }
      : null;
  if (isQueryIntent(intent)) {
    await rememberLastQuery(
      businessId,
      phone,
      lastQueryFromEntities(intent as WhatsappIntent, entities),
      listContext
    );
  } else {
    await clearConversationState(businessId, phone);
  }
  const pages =
    listItems && listItems.length
      ? renderListPage({
          title: String(result.data?.title ?? ''),
          items: listItems,
          currentPage: 1,
          pageSize: WA_PRESENT.explorePageSize,
          wantAll: entities.listWantAll === true,
        })
      : [result.reply];
  return {
    reply: pages[0] ?? result.reply,
    replies: pages.length > 1 ? pages : undefined,
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
  const targetId = String(entities.targetOrderId ?? '').trim();
  const operationPlan = buildOperationPlan(intent, entities);
  await saveConversationState(businessId, phone, {
    pendingIntent: `${CONFIRM_INTENT_PREFIX}${intent}`,
    pendingPayload: entities as Record<string, unknown>,
    pendingPrompt: pages[pages.length - 1] ?? confirmationReply(intent, entities),
    operationPlan: operationPlan as unknown as Record<string, unknown>,
    activeTask: {
      intent,
      collected: {
        client: entities.clientName,
        amount: entities.amount,
        extraCostsEnabled: entities.extraCostsEnabled,
      },
      awaiting: { field: 'confirmation', type: 'confirmation' },
    },
    ...(targetId
      ? {
          focusOrder: {
            id: targetId,
            label: entities.targetOrderLabel,
            clientName: entities.clientName,
            at: new Date().toISOString(),
          },
        }
      : {}),
  });
  const notice = entities.extraCostsNotice ? `${entities.extraCostsNotice}\n` : '';
  return {
    reply: `${notice}${pages[0] ?? confirmationReply(intent, entities)}`.trim(),
    replies: pages.length > 1 ? pages : undefined,
    intent,
    executed: false,
    businessId,
  };
}

function polishCashConcept(entities: WhatsappCommandEntities, ambitos: CajaAmbitoConfig[]): void {
  const fallback = entities.cashType === 'ingreso' ? 'Ingreso' : 'Egreso';
  if (entities.semanticCommand || isLlmFirstEngine()) {
    const concept = String(entities.cashConcept ?? entities.notes ?? '').replace(/\s+/g, ' ').trim();
    entities.cashConcept = concept.slice(0, 80) || fallback;
    return;
  }
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
    !isLlmFirstEngine() &&
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
    !isLlmFirstEngine() &&
    entities.sourceText &&
    /\bsin\s+(descripci[oó]n|detalle|notas?|observaciones)\b/i.test(entities.sourceText)
  ) {
    entities.notesAsked = true;
    entities.notes = undefined;
  }
  if (
    !isLlmFirstEngine() &&
    !String(entities.notes ?? '').trim() &&
    entities.sourceText
  ) {
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
    !isLlmFirstEngine() &&
    !String(entities.productName ?? '').trim() &&
    entities.sourceText &&
    productParserAllowed(intent)
  ) {
    const product = extractProductHintFromText(entities.sourceText);
    if (product && !isPlaceholderProductLabel(product)) entities.productName = product;
  }
  if (!isLlmFirstEngine() && entities.sourceText) {
    if (!(entities.extraCosts?.length)) {
      const extras = extractExtraCostsFromText(entities.sourceText);
      if (extras.length) entities.extraCosts = extras;
    }
    if (!entities.extraCostsProductHint) {
      const hint = extractExtraCostProductHint(entities.sourceText);
      if (hint) entities.extraCostsProductHint = hint;
    }
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

  if (
    (intent === 'create_order' || intent === 'create_sale') &&
    shouldOpenItemCollection(isLlmFirstEngine() ? '' : source || String(entities.sourceText ?? ''), entities)
  ) {
    return askCollectOrderItems(businessId, phone, intent, entities);
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
    const query = clientLookupQuery(entities);
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
      const allowCreate = !candidates.some((row) => (Number(row.score) || 0) >= 70);
      await saveConversationState(businessId, phone, {
        pendingIntent: SELECT_CLIENT_INTENT,
        pendingPayload: {
          originalIntent: intent,
          query: resolved.query,
          entities,
          allowCreate,
          candidates: candidates.map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
          hiddenCandidates: (resolved.rest ?? []).map((c) => ({ id: c.id, nombre: c.nombre, score: c.score })),
        },
      });
      return {
        reply: formatClientChoices(candidates, resolved.query, {
          allowCreate,
          hasMore: Boolean(resolved.rest?.length),
        }),
        intent: SELECT_CLIENT_INTENT,
        executed: false,
        businessId,
      };
    }

    entities.spokenClientName = entities.spokenClientName || query;
    entities.clientId = resolved.client.id;
    entities.clientName = resolved.client.nombre;
    entities.clientLocked = true;
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

  // 2) Productos (cada ítem se resuelve por separado)
  if (intent === 'create_order' || intent === 'create_sale' || intent === 'update_product_cost') {
    const catalogCostOnly = intent === 'update_product_cost';
    ensureOrderItems(entities);
    const items = [...(entities.items ?? [])];
    if (!items.length && String(entities.productName ?? '').trim() && !entities.productId && !entities.productAsConcept) {
      items.push({
        quantity: Math.max(1, Number(entities.quantity) || 1),
        rawText: String(entities.productName),
        productHint: String(entities.productName),
      });
    }
    const languageMemory = await loadUserLanguageMemory(businessId, phone).catch(() => ({ aliases: [] }));
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.productId || item.skipped || item.tipoLinea === 'concepto' || entities.productAsConcept) continue;
      const spoken = String(item.rawText || item.productHint || item.productName || '').trim();
      if (!spoken) continue;
      const hinted = applyLanguageMemory(catalogQueryForItem(item) || spoken, languageMemory);
      const resolved = await resolveProductMatch(businessId, hinted, {
        preferChoices: preferCatalogChoices(intent),
        utterance: spoken,
        messageContext: entities.sourceText,
        attributes: item.attributes,
      });
      if (resolved.status === 'ambiguous') {
        const candidates: MatchedStockItem[] = resolved.candidates;
        const allowCreate =
          !catalogCostOnly && !candidates.some((row) => (Number(row.score) || 0) >= 70);
        await saveConversationState(businessId, phone, {
          pendingIntent: SELECT_PRODUCT_INTENT,
          pendingPayload: {
            originalIntent: intent,
            query: resolved.query,
            itemIndex: i,
            entities: { ...entities, items },
            allowCreate,
            candidates: candidates.map((c) => ({
              id: c.id,
              nombre: c.nombre,
              label: c.label,
              score: c.score,
              precioVenta: c.precioVenta,
            })),
            hiddenCandidates: (resolved.rest ?? []).map((c) => ({
              id: c.id,
              nombre: c.nombre,
              label: c.label,
              score: c.score,
              precioVenta: c.precioVenta,
            })),
          },
        });
        logWhatsappTurn({
          rawMessage: entities.sourceText,
          activeTask: intent,
          parsedIntent: intent,
          itemQueries: items.map((row) => catalogQueryForItem(row)),
          ambiguities: [`item[${i}] ${resolved.query}`],
          question: 'product_choice',
        });
        return {
          reply: formatProductChoices(candidates, resolved.query, {
            allowCreate,
            context: catalogCostOnly ? 'purchase' : 'order',
            lineIndex: i,
            lineCount: items.length,
            hasMore: Boolean(resolved.rest?.length),
          }),
          intent: SELECT_PRODUCT_INTENT,
          executed: false,
          businessId,
        };
      }
      if (resolved.status === 'unique') {
        items[i] = {
          ...item,
          productId: resolved.product.id,
          productName: resolved.product.label || resolved.product.nombre,
          spokenProductName: item.spokenProductName || spoken,
          productLocked: true,
          resolvedEntity: {
            id: resolved.product.id,
            name: resolved.product.label || resolved.product.nombre,
          },
        };
        if (!catalogCostOnly && items[i]!.unitPrice == null && resolved.product.precioVenta > 0) {
          items[i]!.unitPrice = resolved.product.precioVenta;
        }
      }
      if (resolved.status === 'none') {
        if (catalogCostOnly) {
          return {
            reply: `No encontré "${spoken}" en el catálogo. Decime el nombre como está guardado, o NO para cancelar.`,
            intent: 'error',
            executed: false,
            businessId,
          };
        }
        await saveConversationState(businessId, phone, {
          pendingIntent: CONFIRM_CREATE_PRODUCT,
          pendingPayload: {
            originalIntent: intent,
            entities: { ...entities, items },
            proposedName: spoken,
            itemIndex: i,
          },
        });
        const unit = unitPriceFromEntities(entities);
        const priceHint = unit > 0 ? ` a $${unit}` : '';
        return {
          reply: waCard({
            title: 'Producto nuevo',
            lines: [
              `No encontré *${spoken}* en el catálogo.`,
              'Si lo creo, queda solo para pedidos/ventas (sin control de stock).',
            ],
            ask: `¿Lo creo${priceHint}?\n${waBold('SÍ')} / ${waBold('NO')}`,
          }),
          intent: CONFIRM_CREATE_PRODUCT,
          executed: false,
          businessId,
        };
      }
    }
    entities.items = normalizeOrderLineItems(items, entities.sourceText);
    traceOrderItems('after-resolveProductMatch', entities.items);
    syncLegacyProductFields(entities);
    const priced = items.filter((item) => !item.skipped && Number(item.unitPrice) > 0);
    if (!catalogCostOnly && entities.amount == null && priced.length === items.filter((item) => !item.skipped).length) {
      entities.amount = priced.reduce((sum, item) => sum + Number(item.unitPrice) * Math.max(1, item.quantity), 0);
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

  if (intent === 'register_cash' && !entities.cashType && !isLlmFirstEngine()) {
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
    await rememberFocusOrder(businessId, phone, {
      id: target.id,
      label: target.label,
      clientName: target.clientName,
    });
    const closed = closedOrderReason(target.estado);
    if (closed) {
      const source = String(entities.sourceText ?? '');
      const wantsPay = isLlmFirstEngine()
        ? entities.paid === true ||
          entities.payFullBalance === true ||
          Number(entities.collectionAmount) > 0 ||
          Number(entities.amount) > 0
        : ORDER_PAY_HINT.test(source) ||
          SETTLE_TURN.test(source) ||
          looksLikeCollectFullBalance(source) ||
          entities.paid === true ||
          entities.payFullBalance === true ||
          Number(entities.amount) > 0;
      const saldo = Number(target.saldo) || 0;
      const money = saldo.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      if (closed === 'entregado' && wantsPay && saldo > 0) {
        entities.targetOrderId = target.id;
        entities.targetOrderLabel = target.label;
        entities.targetOrderSaldo = saldo;
        entities.clientName = entities.clientName || target.clientName;
        entities.clientId = entities.clientId || target.clientId;
        if (!(Number(entities.amount) > 0)) {
          entities.payFullBalance = true;
          entities.paid = true;
        }
        return askConfirmation(businessId, phone, 'register_payment', entities);
      }
      await saveConversationState(businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
      });
      if (closed === 'cancelado') {
        return {
          reply: `El pedido #${target.label} está cancelado.`,
          intent: 'update_order_status',
          executed: false,
          businessId,
        };
      }
      return {
        reply: waCard({
          title: `Pedido #${target.label}`,
          lines: [
            target.clientName ? `• ${target.clientName}` : '',
            '• Ya está entregado',
            `• Saldo: $${money}`,
          ].filter(Boolean),
          ask: undefined,
        }),
        intent: 'update_order_status',
        executed: false,
        businessId,
      };
    }
    const nextEstado = entities.orderStatus ?? 'listo';
    const source = String(entities.sourceText ?? '');
    const wantsPay = isLlmFirstEngine()
      ? entities.paid === true ||
        entities.payFullBalance === true ||
        Number(entities.collectionAmount) > 0 ||
        Number(entities.amount) > 0
      : ORDER_PAY_HINT.test(source) ||
        SETTLE_TURN.test(source) ||
        looksLikeCollectFullBalance(source) ||
        entities.paid === true ||
        entities.payFullBalance === true ||
        Number(entities.amount) > 0;
    if (!wantsPay) {
      entities.amount = undefined;
      entities.paid = undefined;
      entities.payFullBalance = undefined;
    } else if (!isLlmFirstEngine() && looksLikeCollectFullBalance(source) && !(Number(entities.amount) > 0)) {
      entities.payFullBalance = true;
      entities.paid = true;
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

  if (intent === 'create_order' && !entities.deliveryDate) {
    await ensureOrderExtraCostsConfig(businessId, entities);
    applyDisabledExtraCosts(entities);
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent: intent,
        missingField: 'deliveryDate',
        entities,
      },
      activeTask: {
        intent,
        collected: {
          client: entities.clientName,
          amount: entities.amount,
          extraCostsEnabled: entities.extraCostsEnabled,
        },
        awaiting: { field: 'deliveryDate', type: 'field' },
      },
    });
    const notice = entities.extraCostsNotice ? `${entities.extraCostsNotice}\n` : '';
    return {
      reply: `${notice}${extraCostsDeliveryAsk(entities)}`.trim(),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  if (intent === 'create_order') {
    await ensureOrderExtraCostsConfig(businessId, entities);
    const disabledNotice = applyDisabledExtraCosts(entities);
    if (shouldAskOrderExtraCosts(entities)) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'extraCosts',
          entities,
        },
        activeTask: {
          intent,
          collected: {
            client: entities.clientName,
            amount: entities.amount,
            extraCostsEnabled: entities.extraCostsEnabled,
          },
          awaiting: { field: 'extraCosts', type: 'field' },
        },
      });
      return {
        reply: extraCostsDirectAsk(entities),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    if (needsExtraCostItemAsk(entities)) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent: intent,
          missingField: 'extraCostsItem',
          entities,
        },
        activeTask: {
          intent,
          collected: {
            client: entities.clientName,
            amount: entities.amount,
            extraCostsEnabled: entities.extraCostsEnabled,
          },
          awaiting: { field: 'extraCostsItem', type: 'field' },
        },
      });
      return {
        reply: formatExtraCostItemAsk(entities.extraCosts ?? [], entities),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }
    if (disabledNotice && !entities.extraCostsAsked) {
      entities.extraCostsAsked = true;
    }
  }

  if (intent === 'register_cash') {
    const asked = await ensureCashAmbito(businessId, phone, entities);
    if (asked) return asked;
  }

  if (intent === 'query_cash' || intent === 'query_balance' || intent === 'query_stock') {
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
  const parsed = await interpretTurn({
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

function pinKnownOrder(
  known: WhatsappCommandEntities,
  incoming: WhatsappCommandEntities
): WhatsappCommandEntities {
  const next = { ...known, ...incoming };
  const orderId = String(known.targetOrderId ?? '').trim();
  if (orderId) {
    next.targetOrderId = orderId;
    next.targetOrderLabel = known.targetOrderLabel || next.targetOrderLabel;
    next.clientId = known.clientId || next.clientId;
    next.clientName = known.clientName || next.clientName;
    next.spokenClientName = known.spokenClientName || next.spokenClientName;
    if (known.targetOrderSaldo != null) next.targetOrderSaldo = known.targetOrderSaldo;
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
  phone: string,
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
  const state = await getConversationState(businessId, phone);
  return interpretTurn({
    text,
    rubro,
    businessId,
    conversation: parseConversationFromState(state, {
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
              : pendingIntent === STOCK_RESOLUTION_INTENT
                ? STOCK_RESOLUTION_INTENT
              : pendingIntent.startsWith(CONFIRM_INTENT_PREFIX)
                ? 'confirm'
                : String(payload.missingField || 'fields'),
      knownEntities: entities,
      missingKeys,
      candidates: candidates.map((candidate, index) => ({
        index: index + 1,
        label: candidate.label || candidate.nombre,
      })),
    }),
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
    parsedInput ?? (await parsePendingFollowUp(businessId, phone, text, pendingIntent, payload, rubro));
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
    const fresh = pinKnownOrder(known, entitiesFromParsed(parsed));
    const amount = extractAmountFromText(text);
    if (amount && amount > 0) fresh.amount = amount;
    const wantsPay =
      ORDER_PAY_HINT.test(text) ||
      SETTLE_TURN.test(text) ||
      looksLikeCollectFullBalance(text) ||
      fresh.paid === true ||
      fresh.payFullBalance === true ||
      Number(fresh.amount) > 0;
    if (!wantsPay) {
      fresh.amount = undefined;
      fresh.paid = undefined;
      fresh.payFullBalance = undefined;
    } else if (looksLikeCollectFullBalance(text) && !(Number(fresh.amount) > 0)) {
      fresh.payFullBalance = true;
      fresh.paid = true;
    }
    if (!fresh.orderStatus && ENTREGADO_TURN.test(text)) fresh.orderStatus = 'entregado';
    if (!fresh.orderStatus && LISTO_TURN.test(text)) fresh.orderStatus = 'listo';
    if (!fresh.sourceText) fresh.sourceText = text;
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
    const keepOrder =
      Boolean(known.targetOrderId) &&
      ['update_order_status', 'register_payment'].includes(String(parsed.intent));
    return prepareOperation(
      businessId,
      phone,
      parsed.intent,
      keepOrder ? pinKnownOrder(known, fresh) : fresh,
      rubro
    );
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
  return prepareOperation(
    businessId,
    phone,
    originalIntent === 'register_payment' &&
      (looksLikeOrderStatusUpdate(text) || incoming.orderStatus)
      ? 'update_order_status'
      : originalIntent,
    pinKnownOrder(known, entities),
    rubro
  );
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
  /(?<![\p{L}])(sald(?:alo|ar)|pag[oó]\s+todo|cobr[aeéoó]\s+todo|pago\s+del\s+total|total\s+del\s+saldo|cobra(?:r)?\s+(?:todo\s+)?(?:el\s+)?(?:saldo|total|resto)|todo\s+el\s+saldo|el\s+saldo\s+(?:entero|completo)|registr[aeá]\s+(?:el\s+)?pago)(?![\p{L}])/iu;
const PAY_TURN = /(?<![\p{L}])(pag[oó]|cobr(?:ar|[aeéoó])|se[nñ]a|abon)(?![\p{L}])/iu;

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
  entities: WhatsappCommandEntities,
  step: 'action' | 'status' | 'amount' = 'action'
): Promise<WhatsappHandlerResult> {
  const reply =
    step === 'status'
      ? formatOrderStatusAsk(picked)
      : step === 'amount'
        ? formatPaymentAmountAsk(picked)
        : formatOrderActionAsk(picked);
  await saveConversationState(businessId, phone, {
    pendingIntent: ORDER_ACTION_INTENT,
    pendingPayload: { originalIntent: 'query_status', entities, picked, step },
    pendingPrompt: reply,
    lastOperation: {
      kind: 'order',
      id: picked.id,
      label: picked.label,
      clientName: picked.clientName,
      amount: picked.total,
      at: new Date().toISOString(),
    },
    focusOrder: {
      id: picked.id,
      label: picked.label,
      clientName: picked.clientName,
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

function menuIndex(text: string, max: number): number | null {
  const match = String(text ?? '').trim().match(/^\s*(\d{1,2})\s*$/);
  if (!match) return null;
  const index = Number(match[1]);
  if (index >= 1 && index <= max) return index;
  return null;
}

function orderStatusFromMenu(text: string): WhatsappOrderStatus | null {
  const index = menuIndex(text, 4);
  if (index === 1) return 'pendiente';
  if (index === 2) return 'en_produccion';
  if (index === 3) return 'listo';
  if (index === 4) return 'entregado';
  const fold = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\bpendiente\b/.test(fold)) return 'pendiente';
  if (/\bproduccion\b|\ben proceso\b/.test(fold)) return 'en_produccion';
  if (/\blisto\b|\bpronto\b|\bterminad/.test(fold)) return 'listo';
  if (/\bentregad/.test(fold)) return 'entregado';
  return null;
}

async function continueFromPickedOrder(
  businessId: string,
  phone: string,
  picked: OrderStatusTarget,
  originalIntent: string,
  entities: WhatsappCommandEntities,
  text: string,
  rubro?: string | null,
  fromListPick = false
): Promise<WhatsappHandlerResult> {
  await rememberFocusOrder(businessId, phone, {
    id: picked.id,
    label: picked.label,
    clientName: picked.clientName,
  });
  const next = entitiesFromPickedOrder(entities, picked);
  const indexOnly = fromListPick && /^\s*\d{1,2}\s*$/.test(text.trim());
  const pickedIndex = indexOnly ? Number(text.trim()) : null;
  const amountFromText = indexOnly
    ? null
    : extractAmountFromText(text.replace(/^\s*\d{1,2}\b/, ' '));
  if (amountFromText && amountFromText > 0) next.amount = amountFromText;
  if (pickedIndex != null && Number(next.amount) === pickedIndex) {
    next.amount = undefined;
  }
  const wantsListo = !indexOnly && LISTO_TURN.test(text);
  const wantsEntregado = !indexOnly && ENTREGADO_TURN.test(text);
  const wantsSettle =
    !indexOnly &&
    (SETTLE_TURN.test(text) || looksLikeCollectFullBalance(text) || next.payFullBalance === true);
  const wantsPay =
    !indexOnly && (PAY_TURN.test(text) || wantsSettle || Boolean(amountFromText && !wantsEntregado));

  if (indexOnly) {
    const hasRealAmount = Number(next.amount) > 0;
    if (originalIntent === 'register_payment' && (hasRealAmount || next.payFullBalance)) {
      next.paymentKind = next.paymentKind || 'pago';
      return prepareOperation(businessId, phone, 'register_payment', next, rubro);
    }
    if (originalIntent === 'update_order_status' && next.orderStatus) {
      return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
    }
    return askOrderAction(businessId, phone, picked, next);
  }

  if (originalIntent === 'update_order_status' && next.orderStatus) {
    return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
  }

  if (wantsEntregado) {
    next.orderStatus = 'entregado';
    if (wantsSettle || (wantsPay && !(amountFromText && amountFromText > 0))) {
      next.payFullBalance = true;
      next.paid = true;
    }
    if (!wantsSettle && !PAY_TURN.test(text) && !(amountFromText && amountFromText > 0)) {
      next.amount = undefined;
      next.paid = undefined;
      next.payFullBalance = undefined;
    }
    return prepareOperation(businessId, phone, 'update_order_status', next, rubro);
  }
  if (wantsListo) {
    next.orderStatus = next.orderStatus || 'listo';
    if (wantsSettle || (wantsPay && !(amountFromText && amountFromText > 0))) {
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
      return askOrderAction(businessId, phone, picked, next, 'amount');
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
    .replace(/\b(pedidos?|abiertos?|pendientes?|con\s+saldo|sin\s+pagar|entregad[oa]s?|cerrad[oa]s?)\b/gi, ' ')
    .replace(/\b(que\s+no\s+(est[aáeé]n?\s+)?(en\s+(estado\s+)?)?entregad[oa]s?|no\s+est[aáeé]n?\s+(en\s+(estado\s+)?)?entregad[oa]s?|en\s+estado\s+\w+)\b/gi, ' ')
    .replace(/\$?\s*[\d.]+(?:,\d{2})?/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b(el|la|los|las|de|del|un|una|al|es|el\s+de|que|no|este|esta|estado)\b/gi, ' ')
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
    /^(me llego un pago|me llego pago|un pago|pago|pagos|pedido|pedidos|saldo|transferencia|busca|buscar|buscame|entregado|entregados|entregada|abierto|abiertos|pendiente|pendientes|estado|en estado|que no|no este|no esta)$/.test(
      fold
    )
  ) {
    return true;
  }
  const tokens = fold.split(' ').filter(Boolean);
  const noiseTokens = new Set([
    'me',
    'llego',
    'un',
    'una',
    'pago',
    'pagos',
    'pedido',
    'pedidos',
    'saldo',
    'entregado',
    'entregados',
    'entregada',
    'estado',
    'abierto',
    'abiertos',
    'pendiente',
    'pendientes',
    'cerrado',
    'cerrados',
    'busca',
    'buscar',
    'buscame',
    'el',
    'la',
    'de',
    'del',
    'que',
    'no',
    'en',
    'este',
    'esta',
    'esten',
    'mostrame',
    'listame',
  ]);
  if (tokens.every((token) => noiseTokens.has(token))) return true;
  const leftover = tokens.filter((token) => !noiseTokens.has(token)).join(' ');
  if (!leftover && /\b(entregad|estado|abierto|pendiente)\b/.test(fold)) return true;
  return false;
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
  opts.entities = mergeOrderSearchHints(opts.entities, source);
  const withBalance =
    opts.withBalance === true ||
    opts.originalIntent === 'register_payment' ||
    /\b(saldo|sin\s+pagar)\b/i.test(source);
  const listed = wantsListedOrders(opts.entities, opts.originalIntent);
  if (!hasOrderSearchHints(opts.entities) && !listed) {
    return askFindOrderGuide(businessId, phone, {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
    });
  }

  const { items, closedFallback } = await listWhatsappOrdersWithFallback(businessId, {
    clientHint: opts.entities.clientName,
    productHint: opts.entities.productName,
    amountHint: Number(opts.entities.amount) || undefined,
    withBalance,
    sourceText: source,
  });
  if (!items.length) {
    return askFindOrderGuide(businessId, phone, {
      originalIntent: opts.originalIntent,
      entities: opts.entities,
      missed: true,
    });
  }
  if (items.length === 1 && !closedFallback) {
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
  const who = String(opts.entities.clientName ?? '').trim();
  const closedAsk = who
    ? `No hay abiertos de *${who}*.\nEstos ya están entregados. ¿Cuál miro? Número de la lista.`
    : 'No hay abiertos.\nEstos ya están entregados. ¿Cuál miro? Número de la lista.';
  const ask =
    opts.ask ??
    (closedFallback
      ? closedAsk
      : opts.originalIntent === 'register_payment' && Number(opts.entities.amount) > 0
        ? `¿A qué pedido le pongo los $${opts.entities.amount}? Número de la lista.\nTambién *listo* o *saldalo*.`
        : '¿Cuál? Número de la lista.\nDespués cobrás, lo asociás o le cambiás el *estado*.');
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
    return continueFromPickedOrder(businessId, phone, picked, originalIntent, entities, text, rubro, true);
  }

  const wantsAction =
    LISTO_TURN.test(text) ||
    ENTREGADO_TURN.test(text) ||
    SETTLE_TURN.test(text) ||
    PAY_TURN.test(text);
  if (wantsAction) {
    if (candidates.length === 1) {
      return continueFromPickedOrder(
        businessId,
        phone,
        candidates[0]!,
        originalIntent,
        entities,
        text,
        rubro
      );
    }
    return {
      reply: '¿A cuál? Número de la lista.',
      intent: SELECT_ORDER_INTENT,
      executed: false,
      businessId,
    };
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
  const step = String(payload.step ?? 'action');
  if (!picked?.id) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Se me perdió el pedido. Listame de nuevo o decime el número.',
      intent: 'error',
      executed: false,
      businessId,
    };
  }

  if (step === 'status') {
    const status = orderStatusFromMenu(text);
    if (!status) {
      return askOrderAction(businessId, phone, picked, entities, 'status');
    }
    entities.orderStatus = status;
    return continueFromPickedOrder(
      businessId,
      phone,
      picked,
      'update_order_status',
      entities,
      text,
      rubro
    );
  }

  if (step === 'amount') {
    const amount = extractAmountFromText(text);
    if (SETTLE_TURN.test(text) || /todo/.test(text.toLowerCase()) || CONFIRM_YES.test(text.trim())) {
      entities.payFullBalance = true;
      entities.paid = true;
      entities.amount = undefined;
      return continueFromPickedOrder(
        businessId,
        phone,
        picked,
        'register_payment',
        entities,
        text,
        rubro
      );
    }
    if (amount && amount > 0) {
      entities.amount = amount;
      return continueFromPickedOrder(
        businessId,
        phone,
        picked,
        'register_payment',
        entities,
        text,
        rubro
      );
    }
    return askOrderAction(businessId, phone, picked, entities, 'amount');
  }

  const actionChoice = menuIndex(text, 2);
  const wantsPayMenu =
    actionChoice === 1 ||
    /^(pago|cobro|se[nñ]a|registrar\s+(un\s+)?pago)$/i.test(text.trim()) ||
    PAY_TURN.test(text) ||
    SETTLE_TURN.test(text);
  const wantsStatusMenu =
    actionChoice === 2 ||
    /^(estado|cambiar(?:le)?(?:\s+el)?\s+estado)$/i.test(text.trim()) ||
    /\bcambi(?:ar|[aá])\s+(el\s+)?estado\b/i.test(text);

  if (wantsStatusMenu && actionChoice !== 1) {
    const named = orderStatusFromMenu(text);
    if (named && actionChoice !== 2) {
      entities.orderStatus = named;
      return continueFromPickedOrder(
        businessId,
        phone,
        picked,
        'update_order_status',
        entities,
        text,
        rubro
      );
    }
    return askOrderAction(businessId, phone, picked, entities, 'status');
  }

  if (LISTO_TURN.test(text) || ENTREGADO_TURN.test(text)) {
    return continueFromPickedOrder(
      businessId,
      phone,
      picked,
      'update_order_status',
      entities,
      text,
      rubro
    );
  }

  if (wantsPayMenu) {
    const amount = actionChoice === 1 ? null : extractAmountFromText(text);
    if (amount && amount > 0) entities.amount = amount;
    if (SETTLE_TURN.test(text)) {
      entities.payFullBalance = true;
      entities.paid = true;
    }
    if (Number(entities.amount) > 0 || entities.payFullBalance) {
      return continueFromPickedOrder(
        businessId,
        phone,
        picked,
        'register_payment',
        entities,
        text,
        rubro
      );
    }
    return askOrderAction(businessId, phone, picked, entities, 'amount');
  }

  const namedStatus = orderStatusFromMenu(text);
  if (namedStatus && !menuIndex(text, 2)) {
    entities.orderStatus = namedStatus;
    return continueFromPickedOrder(
      businessId,
      phone,
      picked,
      'update_order_status',
      entities,
      text,
      rubro
    );
  }

  return askOrderAction(businessId, phone, picked, entities);
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
  const parsed = await interpretTurn({
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
  const dual = takeDualIntent(text);
  text = dual.currentText;
  if (dual.queued) {
    await saveConversationState(businessId, phone, {
      queuedTasks: [dual.queued],
      activeTask: activeTaskFromPending({
        pendingIntent: String(pendingPayload?.originalIntent ?? ''),
        pendingPayload,
      }),
    });
  }
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? '').trim();
  const missingField = String(payload.missingField ?? '').trim();
  if (missingField === 'itemColor' || missingField === 'itemSize') {
    const originalIntent = String(payload.originalIntent ?? '').trim();
    let entities = { ...((payload.entities ?? {}) as WhatsappCommandEntities) };
    const itemIndex = Number.isInteger(Number(payload.itemIndex)) ? Number(payload.itemIndex) : undefined;
    entities = applyFollowUpToEntities(entities, text, {
      type: 'field',
      field: missingField,
      itemIndex,
    });
    if (!originalIntent) {
      await clearConversationState(businessId, phone);
      return { reply: 'Se me perdió el contexto. Mandá de nuevo el pedido.', intent: 'error', executed: false, businessId };
    }
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }
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
    const extras = extractExtraCostsFromText(text);
    if (extras.length) {
      entities.extraCosts = mergeExtraCostItems(entities.extraCosts, extras);
    }
    const delivery = extractDeliveryDateFromText(text);
    if (delivery) {
      entities.deliveryDate = delivery;
      entities.deliveryAsked = true;
      entities.deliveryDefaulted = undefined;
    }
    const notes = sanitizeOrderNotes(text) || String(text).trim().slice(0, 240);
    if (notes.length >= 2) {
      entities.notes = notes;
      entities.notesAsked = true;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent,
        missingField: 'notes',
        entities,
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

  if (missingField === 'extraCosts' || missingField === 'extraCostsItem') {
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
    const kind = classifyConfirmReply(text);
    if ((missingField === 'extraCosts' || missingField === 'extraCostsItem') && kind === 'cancel') {
      entities.extraCosts = [];
      entities.extraCostsAsked = true;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }
    if (missingField === 'extraCosts' && kind === 'confirm') {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent,
          missingField: 'extraCosts',
          entities,
        },
        activeTask: {
          intent: originalIntent,
          collected: { extraCostsEnabled: entities.extraCostsEnabled },
          awaiting: { field: 'extraCosts', type: 'field' },
        },
      });
      return {
        reply: extraCostsDirectAsk(entities),
        intent: CLARIFY_INTENT,
        executed: false,
        businessId,
      };
    }

    if (missingField === 'extraCostsItem') {
      const labels = extraCostItemLabels(entities);
      const asNumber = Number(String(text).trim());
      const fromNumber =
        Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= labels.length ? asNumber - 1 : null;
      const index = fromNumber ?? resolveExtraCostTargetIndex(entities, text);
      if (index == null) {
        await saveConversationState(businessId, phone, {
          pendingIntent: CLARIFY_INTENT,
          pendingPayload: {
            originalIntent,
            missingField: 'extraCostsItem',
            entities,
          },
          activeTask: {
            intent: originalIntent,
            collected: { extraCostsEnabled: entities.extraCostsEnabled },
            awaiting: { field: 'extraCostsItem', type: 'field' },
          },
        });
        return {
          reply: formatExtraCostItemAsk(entities.extraCosts ?? [], entities),
          intent: CLARIFY_INTENT,
          executed: false,
          businessId,
        };
      }
      entities.extraCostsTargetItemIndex = index;
      entities.extraCostsAsked = true;
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }

    const parsed = parseSpokenExtraCostAnswer(text);
    if (parsed.length) {
      entities.extraCosts = mergeExtraCostItems(entities.extraCosts, parsed);
      const hint = extractExtraCostProductHint(text);
      if (hint) entities.extraCostsProductHint = hint;
      const target = resolveExtraCostTargetIndex(entities, hint);
      if (target == null) {
        await saveConversationState(businessId, phone, {
          pendingIntent: CLARIFY_INTENT,
          pendingPayload: {
            originalIntent,
            missingField: 'extraCostsItem',
            entities,
          },
          activeTask: {
            intent: originalIntent,
            collected: { extraCostsEnabled: entities.extraCostsEnabled },
            awaiting: { field: 'extraCostsItem', type: 'field' },
          },
        });
        return {
          reply: formatExtraCostItemAsk(entities.extraCosts ?? [], entities),
          intent: CLARIFY_INTENT,
          executed: false,
          businessId,
        };
      }
      entities.extraCostsTargetItemIndex = target;
      entities.extraCostsAsked = true;
      if (looksLikePayEverythingNow(text)) {
        entities.payFullBalance = true;
        entities.paid = true;
        entities.collectionAmount = undefined;
      }
      return prepareOperation(businessId, phone, originalIntent, entities, rubro);
    }

    await saveConversationState(businessId, phone, {
      pendingIntent: CLARIFY_INTENT,
      pendingPayload: {
        originalIntent,
        missingField: 'extraCosts',
        entities,
      },
      activeTask: {
        intent: originalIntent,
        collected: { extraCostsEnabled: entities.extraCostsEnabled },
        awaiting: { field: 'extraCosts', type: 'field' },
      },
    });
    return {
      reply: extraCostsDirectAsk(entities),
      intent: CLARIFY_INTENT,
      executed: false,
      businessId,
    };
  }

  const skipDelivery = /^(listo|nada|no|n|sin fecha|sin fecha de entrega|despu[eé]s|despues|ahora no|-)$/i.test(
    text.trim()
  );

  if (missingField === 'deliveryDate') {
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
    if (skipDelivery) {
      await saveConversationState(businessId, phone, {
        pendingIntent: CLARIFY_INTENT,
        pendingPayload: {
          originalIntent,
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
    entities = applyFollowUpToEntities(entities, text, { type: 'field', field: 'deliveryDate' });
    const merged = await mergeClarifyIntoEntities(
      text,
      entities,
      ['deliveryDate', 'notes', 'requestedStatus'],
      rubro,
      businessId,
      originalIntent
    );
    entities = applyFollowUpToEntities(merged, text, { type: 'field', field: 'deliveryDate' });
    if (entities.deliveryDate) {
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
      reply: extraCostsDeliveryAsk(entities),
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

  const rejectedCurrent = parseChoiceFromText(text);
  const hiddenCandidates = (
    Array.isArray(payload.hiddenCandidates) ? payload.hiddenCandidates : []
  ) as NamedCandidate[];
  if (rejectedCurrent.reject) {
    const rest = candidates.slice(1);
    if (rest.length) {
      await saveConversationState(businessId, phone, {
        pendingIntent: pendingIntentForKind(kind),
        pendingPayload: {
          ...payload,
          candidates: rest.map((c) => ({ id: c.id, nombre: c.nombre, label: c.label, score: c.score })),
        },
      });
      const prompt =
        kind === 'product'
          ? formatProductChoices(rest, query, { allowCreate, context: originalIntent === 'create_purchase' ? 'purchase' : 'order' })
          : kind === 'client'
            ? formatClientChoices(rest, query, { allowCreate })
            : formatSupplierChoices(rest, query, { allowCreate });
      return {
        reply: prompt,
        intent: pendingIntentForKind(kind),
        executed: false,
        businessId,
      };
    }
  }

  const noneIndex =
    kind === 'product' && originalIntent !== 'create_purchase' ? candidates.length : -1;
  const pickedNoneNumber =
    /^\d{1,2}$/.test(text.trim()) && noneIndex >= 0 && Number(text.trim()) - 1 === noneIndex;
  const wantsMoreChoices =
    kind === 'product' &&
    originalIntent !== 'create_purchase' &&
    (rejectedCurrent.none === true ||
      rejectedCurrent.more === true ||
      pickedNoneNumber ||
      looksLikeListContinue(text));
  if (wantsMoreChoices) {
    if (!hiddenCandidates.length) {
      return {
        reply: waCard({
          title: 'No hay más opciones',
          ask: '¿Lo escribís de otra forma?',
        }),
        intent: pendingIntentForKind(kind),
        executed: false,
        businessId,
      };
    }
    const nextShown = hiddenCandidates.slice(0, 3);
    const nextHidden = hiddenCandidates.slice(3);
    await saveConversationState(businessId, phone, {
      pendingIntent: pendingIntentForKind(kind),
      pendingPayload: {
        ...payload,
        candidates: nextShown.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          label: c.label,
          score: c.score,
          precioVenta: c.precioVenta,
        })),
        hiddenCandidates: nextHidden.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          label: c.label,
          score: c.score,
          precioVenta: c.precioVenta,
        })),
        choicePage: (Number(payload.choicePage) || 1) + 1,
      },
    });
    return {
      reply: formatProductChoices(nextShown, query, {
        allowCreate: false,
        hasMore: nextHidden.length > 0,
        morePage: true,
        context: 'order',
      }),
      intent: pendingIntentForKind(kind),
      executed: false,
      businessId,
    };
  }

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
    await rememberSpokenProductTerms({
      businessId,
      phone,
      spoken: query,
      resolvedName: productName,
      productId,
    });
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
    const parsedFollow = await parsePendingFollowUp(businessId, phone, text, pendingIntentForKind(kind), payload, rubro);
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

async function persistStockResolution(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities,
  ask: StockDiscountAsk,
  prompt: string,
  previous?: ConversationState | null
): Promise<WhatsappHandlerResult> {
  const targetId = String(entities.targetOrderId ?? previous?.focusOrder?.id ?? '').trim();
  await saveConversationState(businessId, phone, {
    pendingIntent: STOCK_RESOLUTION_INTENT,
    pendingPayload: {
      originalIntent: 'update_order_status',
      entities,
      stockAsk: ask,
    },
    pendingPrompt: prompt,
    operationPlan: previous?.operationPlan ?? undefined,
    activeTask: {
      intent: 'update_order_status',
      collected: {
        client: entities.clientName,
        targetOrderId: entities.targetOrderId,
        orderStatus: entities.orderStatus,
      },
      awaiting: {
        type: STOCK_RESOLUTION_INTENT,
        reason: ask.reason,
        allowedActions: [...ask.options, 'cancel'],
      },
    },
    ...(targetId
      ? {
          focusOrder: {
            id: targetId,
            label: entities.targetOrderLabel ?? previous?.focusOrder?.label,
            clientName: entities.clientName ?? previous?.focusOrder?.clientName,
            clientId: entities.clientId ?? previous?.focusOrder?.clientId,
            status: previous?.focusOrder?.status,
            at: new Date().toISOString(),
          },
        }
      : {}),
  });
  return {
    reply: prompt,
    intent: STOCK_RESOLUTION_INTENT,
    executed: false,
    businessId,
  };
}

async function handleStockResolution(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null,
  parsedOverride?: ParsedWhatsappCommand | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const entities = { ...payloadEntities(payload) };
  const ask = (payload.stockAsk ?? {}) as StockDiscountAsk;
  const allowed = Array.isArray(ask.options) && ask.options.length ? ask.options : ['pedido_completo'];
  const parsed =
    parsedOverride ??
    (await parsePendingFollowUp(
      businessId,
      phone,
      text,
      STOCK_RESOLUTION_INTENT,
      payload,
      rubro
    ));
  const fromParsed =
    'entities' in parsed
      ? parsed.entities?.stockResolution ||
        (parsed.conversationAction === 'cancel_current' ? 'cancel' : undefined)
      : parsed.conversationAction === 'cancel_current'
        ? 'cancel'
        : undefined;
  const choice = interpretStockResolutionFromText(text, allowed);
  const leftover =
    choice.leftover ||
    splitCompoundStockUtterance(text).leftover;
  let action = fromParsed || (parsedOverride ? undefined : choice.action);

  if (
    !action &&
    allowed.length === 1 &&
    allowed[0] === 'pedido_completo' &&
    parsed.conversationAction !== 'new_task'
  ) {
    action = 'discount_full_order';
  }

  if (!action) {
    const prompt =
      ask.options?.length ? formatStockResolutionAsk(ask) : String(payload.pendingPrompt ?? '');
    return {
      reply: prompt || '¿Descuento el stock de todo el pedido? SÍ / NO',
      intent: STOCK_RESOLUTION_INTENT,
      executed: false,
      businessId,
    };
  }

  if (action === 'cancel') {
    await clearConversationState(businessId, phone);
    const cancelReply = 'Dale, el pedido queda como estaba.';
    if (leftover) {
      const tenant = await resolveTenantByPhone(phone);
      if (tenant) {
        const follow = await executeWhatsappCommand(tenant, {
          intent: 'query_status',
          confidence: 1,
          entities: {
            ...entities,
            referToLast: true,
            targetOrderId: entities.targetOrderId,
            sourceText: leftover,
          },
          raw: leftover,
        } as ParsedWhatsappCommand);
        const pages = [cancelReply, follow.reply].filter(Boolean);
        return {
          reply: pages[0] ?? cancelReply,
          replies: pages.length > 1 ? pages : undefined,
          intent: follow.intent,
          executed: follow.executed,
          businessId,
        };
      }
    }
    return {
      reply: cancelReply,
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  const scope = parseRequestedStockScope(action) ?? scopeFromStockResolution(action);
  entities.descuentoFisicoAlcance = scope;
  entities.stockResolution = action;
  entities.productName = undefined;
  entities.spokenProductName = undefined;
  entities.items = undefined;

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'No encontré tu cuenta. Contactá a soporte.',
      intent: 'error',
      executed: false,
    };
  }

  const stored = await getConversationState(businessId, phone);
  const result = await executeWhatsappCommand(tenant, {
    intent: 'update_order_status',
    confidence: 1,
    entities,
    raw: text,
  } as ParsedWhatsappCommand);

  if (result.data && (result.data as { needsStockDecision?: StockDiscountAsk }).needsStockDecision) {
    const nextAsk = (result.data as { needsStockDecision: StockDiscountAsk }).needsStockDecision;
    return persistStockResolution(businessId, phone, entities, nextAsk, result.reply, stored);
  }

  if (result.executed) {
    const last = lastOperationFromResult(result, entities);
    if (last) await rememberLastOperation(businessId, phone, last);
    else await clearConversationState(businessId, phone);
  } else {
    await clearConversationState(businessId, phone);
  }

  if (leftover && result.executed) {
    const follow = await executeWhatsappCommand(tenant, {
      intent: 'query_status',
      confidence: 1,
      entities: {
        ...entities,
        referToLast: true,
        targetOrderId: entities.targetOrderId,
        sourceText: leftover,
      },
      raw: leftover,
    } as ParsedWhatsappCommand);
    const pages = [result.reply, follow.reply].filter(Boolean);
    return {
      reply: pages[0] ?? result.reply,
      replies: pages.length > 1 ? pages : undefined,
      intent: follow.intent,
      executed: true,
      businessId,
    };
  }

  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
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

  const kind = classifyConfirmReply(text);
  if (kind === 'cancel') {
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

  if (kind !== 'confirm') {
    const payload = pendingPayload ?? {};
    if (looksLikePendingQuestion(text) || (await parsePendingFollowUp(businessId, phone, text, pendingIntent, payload, rubro)).followUpAction === 'ask') {
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
  const stored = await getConversationState(businessId, phone);
  const plan = stored?.operationPlan ?? (buildOperationPlan(intent, entities) as unknown as Record<string, unknown>);
  console.info(
    '[whatsapp:plan]',
    JSON.stringify({
      execute: true,
      rawUserMessage: String(entities.rawUserMessage || entities.sourceText || '').slice(0, 180),
      operations: Array.isArray((plan as { operations?: Array<{ intent?: string }> }).operations)
        ? (plan as { operations: Array<{ intent?: string }> }).operations.map((row) => row.intent)
        : [intent],
    })
  );
  const parsed = {
    intent,
    confidence: 1,
    entities,
    raw: String(entities.rawUserMessage || entities.sourceText || text),
  } as ParsedWhatsappCommand;

  const priorQueued = [...(stored?.queuedTasks ?? [])];
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
    const queued = priorQueued;
    if (queued.length) {
      const [next, ...rest] = queued;
      await saveConversationState(businessId, phone, { queuedTasks: rest.length ? rest : null });
      const follow = await prepareOperation(
        businessId,
        phone,
        String(next?.intent ?? 'create_order'),
        {
          ...((next?.entities ?? {}) as WhatsappCommandEntities),
          sourceText: String(next?.raw ?? ''),
        },
        rubro
      );
      const pages = [result.reply, ...(follow.replies ?? (follow.reply ? [follow.reply] : []))].filter(Boolean);
      return {
        reply: pages[0] ?? result.reply,
        replies: pages.length > 1 ? pages : undefined,
        intent: follow.intent,
        executed: result.executed,
        businessId,
      };
    }
  } else if (result.data && (result.data as { needsStockDecision?: StockDiscountAsk }).needsStockDecision) {
    const ask = (result.data as { needsStockDecision: StockDiscountAsk }).needsStockDecision;
    return persistStockResolution(businessId, phone, entities, ask, result.reply, stored);
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

async function askCollectOrderItems(
  businessId: string,
  phone: string,
  intent: string,
  entities: WhatsappCommandEntities
): Promise<WhatsappHandlerResult> {
  const next: WhatsappCommandEntities = {
    ...entities,
    collectingItems: true,
    productName: hasRealOrderItems(entities) ? entities.productName : undefined,
    items: (entities.items ?? []).filter(
      (item) => !isPlaceholderProductLabel(item.rawText || item.productHint || item.productName)
    ),
  };
  const reply = formatCollectOrderItemsAsk({
    clientName: next.clientName,
    expectedCount: next.expectedItemCount,
    itemCount: next.items?.length,
  });
  await saveConversationState(businessId, phone, {
    pendingIntent: COLLECT_ORDER_ITEMS_INTENT,
    pendingPayload: { originalIntent: intent, entities: next },
    pendingPrompt: reply,
    activeTask: {
      intent,
      collected: next,
      awaiting: { field: 'items', type: 'collect' },
    },
  });
  return {
    reply,
    intent: COLLECT_ORDER_ITEMS_INTENT,
    executed: false,
    businessId,
  };
}

async function handleCollectOrderItems(
  businessId: string,
  phone: string,
  text: string,
  pendingPayload: Record<string, unknown> | null | undefined,
  rubro?: string | null
): Promise<WhatsappHandlerResult> {
  const payload = pendingPayload ?? {};
  const originalIntent = String(payload.originalIntent ?? 'create_order');
  const entities: WhatsappCommandEntities = {
    ...((payload.entities && typeof payload.entities === 'object'
      ? payload.entities
      : {}) as WhatsappCommandEntities),
    collectingItems: true,
  };

  if (looksLikeCollectingDone(text)) {
    if (!hasRealOrderItems(entities)) {
      const ask = formatCollectOrderItemsAsk({
        clientName: entities.clientName,
        expectedCount: entities.expectedItemCount,
        itemCount: 0,
      });
      await saveConversationState(businessId, phone, {
        pendingIntent: COLLECT_ORDER_ITEMS_INTENT,
        pendingPayload: { originalIntent, entities },
        pendingPrompt: ask,
      });
      return { reply: ask, intent: COLLECT_ORDER_ITEMS_INTENT, executed: false, businessId };
    }
    entities.collectingItems = false;
    return prepareOperation(businessId, phone, originalIntent, entities, rubro);
  }

  const parsed = parseWithRules(text);
  const incoming = 'entities' in parsed ? { ...(parsed.entities ?? {}) } : {};
  incoming.sourceText = text;
  ensureOrderItems(incoming);
  const batch = (incoming.items ?? []).filter(
    (item) => !isPlaceholderProductLabel(item.rawText || item.productHint || item.productName)
  );
  entities.items = appendOrderItemBatch(entities.items, batch, text);
  syncLegacyProductFields(entities);
  const ask = formatCollectOrderItemsAsk({
    clientName: entities.clientName,
    expectedCount: entities.expectedItemCount,
    itemCount: entities.items?.length,
  });
  await saveConversationState(businessId, phone, {
    pendingIntent: COLLECT_ORDER_ITEMS_INTENT,
    pendingPayload: { originalIntent, entities },
    pendingPrompt: ask,
    activeTask: {
      intent: originalIntent,
      collected: entities,
      awaiting: { field: 'items', type: 'collect' },
    },
  });
  return { reply: ask, intent: COLLECT_ORDER_ITEMS_INTENT, executed: false, businessId };
}

function usageQuestionReply(text: string, parsed?: ParsedWhatsappCommand | null): string {
  const entities = parsed && 'entities' in parsed ? parsed.entities ?? {} : {};
  const topic = (entities.helpTopic as ReturnType<typeof howToTopicFromText> | undefined) || howToTopicFromText(text);
  if (parsed?.intent === 'capability_question' || utteranceIsCapabilityQuestion(text)) {
    return formatCapabilityOrderReply();
  }
  return formatHowToReply(topic, entities.expectedItemCount);
}

async function answerUsageQuestion(
  tenant: WhatsappTenantContext,
  phone: string,
  text: string,
  state: ConversationState | null,
  parsed?: ParsedWhatsappCommand | null
): Promise<WhatsappHandlerResult> {
  const reply = usageQuestionReply(text, parsed);
  const pending = String(state?.pendingIntent ?? '').trim();
  if (pending && pending !== RESUME_CONTEXT_INTENT) {
    const prompt =
      String(state?.pendingPrompt ?? '').trim() ||
      reconstructPendingPrompt(pending, state?.pendingPayload ?? {});
    await saveConversationState(tenant.businessId, phone, {
      pendingIntent: pending,
      pendingPayload: state?.pendingPayload ?? null,
      pendingPrompt: prompt || state?.pendingPrompt,
    });
    return {
      reply,
      replies: prompt ? [reply, prompt] : [reply],
      intent: parsed?.intent === 'capability_question' ? 'capability_question' : 'how_to',
      executed: false,
      businessId: tenant.businessId,
    };
  }
  return {
    reply,
    intent: parsed?.intent === 'capability_question' ? 'capability_question' : 'how_to',
    executed: false,
    businessId: tenant.businessId,
  };
}

async function askIdleResume(
  businessId: string,
  phone: string,
  text: string,
  mediaId: string | null,
  mediaType: string | null | undefined,
  state: ConversationState
): Promise<WhatsappHandlerResult> {
  const reply = formatResumeAsk(state);
  await saveConversationState(businessId, phone, {
    pendingIntent: RESUME_CONTEXT_INTENT,
    pendingPayload: {
      previousIntent: state.pendingIntent ?? null,
      previousPayload: state.pendingPayload ?? null,
      previousPrompt: state.pendingPrompt ?? null,
      previousFocus: state.focusOrder ?? null,
      resumeUtterance: text,
      resumeMediaId: mediaId,
      resumeMediaType: mediaType ?? null,
    },
    pendingPrompt: reply,
    suspendedTask:
      state.activeTask ??
      (state.pendingIntent
        ? { intent: state.pendingIntent, collected: state.pendingPayload ?? {} }
        : null),
  });
  return {
    reply,
    intent: RESUME_CONTEXT_INTENT,
    executed: false,
    businessId,
  };
}

async function handleResumeContext(
  tenant: WhatsappTenantContext,
  phone: string,
  text: string,
  mediaId: string | null,
  mediaType: string | null | undefined,
  state: ConversationState
): Promise<WhatsappHandlerResult> {
  const payload = (state.pendingPayload ?? {}) as Record<string, unknown>;
  const previousIntent = String(payload.previousIntent ?? '').trim() || null;
  const previousPayload =
    payload.previousPayload && typeof payload.previousPayload === 'object'
      ? (payload.previousPayload as Record<string, unknown>)
      : null;
  const previousPrompt = String(payload.previousPrompt ?? '').trim() || null;
  const previousFocus =
    payload.previousFocus && typeof payload.previousFocus === 'object'
      ? (payload.previousFocus as ConversationState['focusOrder'])
      : state.focusOrder ?? null;
  const stashed = String(payload.resumeUtterance ?? '').trim();
  const stashedMediaId = String(payload.resumeMediaId ?? '').trim() || null;
  const stashedMediaType = String(payload.resumeMediaType ?? '').trim() || null;
  const t = String(text ?? '').trim();
  const businessId = tenant.businessId;
  const classified = classifyConversationSpeechAct(t, RESUME_CONTEXT_INTENT);

  const restore = async () => {
    await saveConversationState(businessId, phone, {
      pendingIntent: previousIntent,
      pendingPayload: previousPayload,
      pendingPrompt: previousPrompt,
      focusOrder: previousFocus ?? state.focusOrder ?? null,
      suspendedTask: null,
    });
  };

  const parsed = t
    ? parseWithRules(t, {
        pendingIntent: RESUME_CONTEXT_INTENT,
        awaiting: 'resume_context',
        originalIntent: previousIntent || undefined,
        focusOrder: previousFocus ?? state.focusOrder ?? null,
        lastOperation: state.lastOperation ?? null,
        knownEntities:
          previousPayload?.entities && typeof previousPayload.entities === 'object'
            ? (previousPayload.entities as WhatsappCommandEntities)
            : undefined,
      })
    : null;
  const route = routeResumeUtterance(t, {
    intent: parsed?.intent ?? 'unknown',
    confidence: parsed?.confidence ?? 0,
  });

  logWhatsappTurn({
    rawMessage: t,
    stalePending: previousIntent,
    focusEntities: [
      previousFocus?.label ? `#${previousFocus.label}` : previousFocus?.id,
      previousFocus?.clientName,
    ].filter(Boolean) as string[],
    classifiedConversationAction: classified,
    intent: parsed?.intent,
    parsedIntent: parsed?.intent,
    productParserExecuted: Boolean(
      parsed && 'entities' in parsed && (parsed.entities?.productName || parsed.entities?.items?.length)
    ),
    whyFallbackWasUsed: parsed?.intent === 'unknown' ? 'no_confident_intent' : null,
    finalOperationPlan: route.kind,
  });

  if (route.kind === 'resume_no') {
    await clearConversationTask(businessId, phone);
    return {
      reply: waCard({ title: 'De nuevo', ask: '¿Qué anotamos?' }),
      intent: RESUME_CONTEXT_INTENT,
      executed: false,
      businessId,
    };
  }

  if (route.kind === 'help_keep_pending') {
    await restore();
    const restored = await getConversationState(businessId, phone);
    return answerUsageQuestion(tenant, phone, t, restored, parsed);
  }

  if (route.kind === 'run_new') {
    await clearConversationTask(businessId, phone);
    return handleWhatsappTurn({
      from: phone,
      text: route.text,
      skipIdleResume: true,
    });
  }

  await restore();

  const continueWithStash = route.kind === 'resume_yes';
  const nextText = continueWithStash ? stashed : t;
  const nextMediaId = continueWithStash ? stashedMediaId : mediaId || stashedMediaId;
  const nextMediaType = continueWithStash ? stashedMediaType : mediaType || stashedMediaType;

  if (!nextText && !nextMediaId && previousPrompt && previousIntent) {
    return {
      reply: previousPrompt,
      intent: previousIntent,
      executed: false,
      businessId,
    };
  }

  if (
    !nextMediaId &&
    (!nextText || isTrivialWhatsappTurn(nextText) || isThanksText(nextText) || looksLikeResumeYes(nextText))
  ) {
    if (previousPrompt && previousIntent) {
      return {
        reply: previousPrompt,
        intent: previousIntent,
        executed: false,
        businessId,
      };
    }
    if (previousFocus?.id) {
      const who = previousFocus.clientName ? ` de ${previousFocus.clientName}` : '';
      const num = previousFocus.label
        ? ` *#${String(previousFocus.label).replace(/^#/, '')}*`
        : '';
      return {
        reply: waCard({
          title: 'Seguimos',
          lines: [`El pedido${num}${who}.`],
          ask: '¿Qué hacemos con ese pedido?',
        }),
        intent: RESUME_CONTEXT_INTENT,
        executed: false,
        businessId,
      };
    }
    return {
      reply: waCard({ title: 'Seguimos', ask: '¿Qué anotamos?' }),
      intent: RESUME_CONTEXT_INTENT,
      executed: false,
      businessId,
    };
  }

  return handleWhatsappTurn({
    from: phone,
    text: nextText || undefined,
    mediaId: nextMediaId,
    mediaType: nextMediaType,
    skipIdleResume: true,
  });
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

  if (guard.ok === false) {
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
  let llmInterpretation: TurnInterpretation | null = null;
  let llmConversation: WhatsappParseConversation | undefined;
  if (audio && !text && !isLlmFirstEngine()) {
    parsed = await interpretTurn({
      text: '',
      audio,
      mediaId: null,
      rubro: tenant.rubro,
      businessId: tenant.businessId,
    });
    const transcript = String('raw' in parsed ? parsed.raw ?? '' : '').trim();
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

  let state = await getConversationState(tenant.businessId, phone);
  if (state?.pendingIntent === HELP_TOPIC_INTENT && text && isUnequivocalUiReply(text)) {
    return handleHelpTurn(
      tenant,
      text,
      state.pendingPayload
    );
  }
  if (state?.pendingIntent === HELP_TOPIC_INTENT && text && /^(consultame|consultáme|ayuda|help|comandos|menu|menú)[\s?¿!.]*$/i.test(text.trim())) {
    return handleHelpTurn(tenant, text, state.pendingPayload);
  }

  if (state?.pendingIntent && text && isOnboardingIntent(state.pendingIntent) && isUnequivocalUiReply(text)) {
    const onboarded = await handleOnboardingPending(
      tenant,
      text,
      state.pendingIntent,
      state.pendingPayload
    );
    if (onboarded) return onboarded;
  }

  if (isV4Engine(tenant.businessId)) {
    if (audio && !text) {
      const transcriptParsed = await interpretLlmFirstTurn({
        text: '',
        audio,
        mediaId: null,
        rubro: tenant.rubro,
        businessId: tenant.businessId,
        conversation: parseConversationFromState(state),
      });
      const transcript = String(transcriptParsed.interpretation.rawMessage ?? '').trim();
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
    return handleV4WhatsappTurn({ tenant, phone, message, text, state });
  }

  let skipPendingGates = false;
  if (isLlmFirstEngine() && (text || image || audio)) {
    const bypass = text ? matchDeterministicBypass(text, state) : null;
    if (!bypass) {
      llmConversation = parseConversationFromState(state, {
        languageMemory: await loadUserLanguageMemory(tenant.businessId, phone).catch(() => ({
          aliases: [],
        })),
      });
      const v2 = await interpretLlmFirstTurn({
        text,
        image,
        audio,
        mediaId: isImage ? mediaId : null,
        rubro: tenant.rubro,
        businessId: tenant.businessId,
        conversation: llmConversation,
      });
      llmInterpretation = v2.interpretation;
      if (v2.clearPending && state?.pendingIntent) {
        await clearConversationTask(tenant.businessId, phone);
        state = await getConversationState(tenant.businessId, phone);
      }
      parsed = v2.parsed;
      skipPendingGates = true;
      if (isInterpreterTechnicalFailure(v2.interpretation.interpreterFailure)) {
        return {
          reply: INTERPRETER_UNAVAILABLE_REPLY,
          intent: 'interpreter_unavailable',
          executed: false,
          businessId: tenant.businessId,
        };
      }
      if (parsed && 'entities' in parsed && parsed.entities) {
        stampInboundIdempotency(parsed.entities, message.messageId);
      }
      if (
        !v2.clearPending &&
        state?.pendingIntent === STOCK_RESOLUTION_INTENT &&
        v2.interpretation.stockResolution
      ) {
        return handleStockResolution(
          tenant.businessId,
          phone,
          text,
          state.pendingPayload,
          tenant.rubro,
          v2.parsed
        );
      }
      const pendingNow = String(state?.pendingIntent ?? '');
      if (
        !v2.clearPending &&
        v2.parsed.choiceIndex &&
        (pendingNow.startsWith('select_') ||
          pendingNow === 'order_action' ||
          pendingNow === 'select_payment_kind' ||
          pendingNow === 'select_order')
      ) {
        text = String(v2.parsed.choiceIndex);
        skipPendingGates = false;
        parsed = null;
        llmInterpretation = null;
      }
    }
  }

  if (!skipPendingGates) {
  const earlyParsed = text ? parseWithRules(text, parseConversationFromState(state)) : null;

  if (
    state?.pendingIntent &&
    state.pendingIntent !== RESUME_CONTEXT_INTENT &&
    text &&
    (utteranceIsHowTo(text) ||
      utteranceIsCapabilityQuestion(text) ||
      earlyParsed?.intent === 'how_to' ||
      earlyParsed?.intent === 'capability_question')
  ) {
    return answerUsageQuestion(tenant, phone, text, state, earlyParsed);
  }

  if (state?.pendingIntent === RESUME_CONTEXT_INTENT && (text || mediaId)) {
    const skipResumeGate =
      parsedIntentSkipsIdleResume(earlyParsed?.intent, earlyParsed?.confidence ?? 0) &&
      earlyParsed?.intent !== 'how_to' &&
      earlyParsed?.intent !== 'capability_question';
    if (skipResumeGate) {
      await clearConversationTask(tenant.businessId, phone);
      state = await getConversationState(tenant.businessId, phone);
    } else {
      return handleResumeContext(tenant, phone, text, mediaId, message.mediaType, state);
    }
  }

  if (
    !message.skipIdleResume &&
    state &&
    (text || mediaId) &&
    isConversationIdle(state) &&
    shouldAskIdleResume(text, state, earlyParsed)
  ) {
    return askIdleResume(tenant.businessId, phone, text, mediaId, message.mediaType, state);
  }

  if (text && !state?.pendingIntent) {
    const continued = await continueQueryOrList(tenant, phone, text, state);
    if (continued) return continued;
  }

  if (state?.pendingIntent && text) {
    if (isFreshTaskUtterance(text, state.pendingIntent)) {
      await saveConversationState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        suspendedTask: null,
      });
      state = await getConversationState(tenant.businessId, phone);
    } else if (!isOnboardingIntent(state.pendingIntent)) {
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
    if (state.pendingIntent === COLLECT_ORDER_ITEMS_INTENT) {
      return handleCollectOrderItems(
        tenant.businessId,
        phone,
        text,
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
    if (state.pendingIntent === STOCK_RESOLUTION_INTENT) {
      return handleStockResolution(
        tenant.businessId,
        phone,
        text,
        state.pendingPayload,
        tenant.rubro
      );
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
    parsed = await interpretTurn({
      text,
      image,
      audio,
      mediaId: isImage ? mediaId : null,
      rubro: tenant.rubro,
      businessId: tenant.businessId,
      conversation: parseConversationFromState(state, {
        languageMemory: await loadUserLanguageMemory(tenant.businessId, phone).catch(() => ({ aliases: [] })),
      }),
    });
    logWhatsappTurn({
      rawMessage: text,
      stalePending: state?.pendingIntent ?? state?.suspendedTask?.intent ?? null,
      focusEntities: [
        state?.focusOrder?.label ? `#${state.focusOrder.label}` : state?.focusOrder?.id,
        state?.focusOrder?.clientName,
        state?.focusEntities?.order?.id,
      ].filter(Boolean) as string[],
      classifiedConversationAction: classifyConversationSpeechAct(text, state?.pendingIntent),
      intent: parsed.intent,
      parsedIntent: parsed.intent,
      productParserExecuted: productParserAllowed(parsed.intent),
      whyFallbackWasUsed: parsed.intent === 'unknown' ? 'no_confident_intent' : null,
      finalOperationPlan: parsed.intent,
      confidence: parsed.confidence,
    });
  } else if (
    !isLlmFirstEngine() &&
    parsed.intent === 'unknown' &&
    (state?.focusOrder?.id || state?.lastOperation) &&
    looksLikeStatusQuery(text)
  ) {
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

  if (parsed.intent === 'interpreter_unavailable') {
    return {
      reply: INTERPRETER_UNAVAILABLE_REPLY,
      intent: 'interpreter_unavailable',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (parsed.intent === 'unknown') {
    const cap = 'entities' in parsed ? parsed.entities?.requestedCapability : undefined;
    if ('entities' in parsed && parsed.entities?.capabilityUnwired && cap) {
      return {
        reply: capabilityNotEnabledReply(cap),
        intent: 'capability_question',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    return askUnknownIntent(tenant, phone, text, state?.lastOperation ?? null, 1);
  }

  if (parsed.intent === 'help') {
    return handleHelpTurn(tenant, text);
  }

  if (parsed.intent === 'how_to' || parsed.intent === 'capability_question') {
    return answerUsageQuestion(tenant, phone, text, state, parsed);
  }

  if (parsed.intent === 'query_status' || parsed.intent === 'query_cash' || parsed.intent === 'query_stock') {
    if (isV3Engine(tenant.businessId) && llmInterpretation && parsed.intent === 'query_status') {
      const v3 = await executeV3QueryTurn({
        tenant,
        interpretation: llmInterpretation,
        conversation: llmConversation ?? parseConversationFromState(state),
      });
      if (v3) {
        return {
          reply: v3.reply,
          intent: v3.intent,
          executed: v3.executed,
          businessId: v3.businessId,
        };
      }
    }
    if (parsed.intent === 'query_status' && !isLlmFirstEngine()) {
      const base = entitiesFromParsed(parsed, isImage ? mediaId : null);
      const thisOrder =
        looksLikeExistingOrderQuery(text) ||
        Boolean(base.targetOrderId || base.orderNumber || base.referToLast);
      if (thisOrder) {
        parsed = {
          ...parsed,
          entities: { ...base, productName: undefined, sourceText: text || base.sourceText },
        };
      } else {
        const entities = mergeOrderSearchHints(base, text);
        if (
          entities.listOrders ||
          looksLikeListOrders(text) ||
          entities.clientName ||
          entities.productName
        ) {
          return offerOpenOrderPick(tenant.businessId, phone, {
            originalIntent: 'query_status',
            entities,
            rubro: tenant.rubro,
          });
        }
        parsed = { ...parsed, entities };
      }
    }
    const result = await executeWhatsappCommand(tenant, parsed);
    const queryEntities = entitiesFromParsed(parsed, isImage ? mediaId : null);
    const listItems = Array.isArray(result.data?.listItems)
      ? result.data.listItems.map((item) => String(item))
      : undefined;
    const listContext: ConversationListContext | null =
      listItems && listItems.length
        ? {
            type: 'orders',
            items: listItems,
            currentPage: Math.floor(Number(result.data?.offset ?? 0) / Math.max(1, Number(result.data?.pageSize ?? 10))) + 1,
            pageSize: Number(result.data?.pageSize ?? 10) || 10,
            totalResults: Number(result.data?.total ?? listItems.length) || listItems.length,
            title: String(result.data?.title ?? ''),
            hasMore: result.data?.hasMore === true,
            offset: Number(result.data?.offset ?? 0) || 0,
            filters: lastQueryFromEntities(parsed.intent, queryEntities).slots,
          }
        : null;
    await rememberLastQuery(
      tenant.businessId,
      phone,
      lastQueryFromEntities(parsed.intent, queryEntities),
      listContext
    );
    return {
      reply: result.reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  }

  const dual = isLlmFirstEngine() ? { currentText: text } : takeDualIntent(text);
  const entities = entitiesFromParsed(parsed, isImage ? mediaId : null);
  stampInboundIdempotency(entities, message.messageId);
  if ('queued' in dual && dual.queued) {
    await saveConversationState(tenant.businessId, phone, { queuedTasks: [dual.queued] });
    entities.sourceText = dual.currentText;
  }
  return prepareOperation(tenant.businessId, phone, parsed.intent, entities, tenant.rubro);
}
