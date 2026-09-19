/**
 * Capa tipada llm_first: TurnInterpretation → SemanticCommand → OperationPlan.
 * Normaliza SOLO el JSON del modelo (aliases, fechas, salvage estructural).
 * No lee rawMessage para descubrir intent, monto, caja ni pago.
 */
import type { ConversationAction, LineItemIntent } from './conversation-contract.ts';
import type { WhatsappCommandEntities, WhatsappIntent, WhatsappParseConversation } from './ai-command-parser.ts';
import {
  type CashInterpretation,
  type PaymentInterpretation,
  type TurnInterpretation,
  type TurnDates,
  type TurnFilters,
  type TurnQuery,
  type TargetReference,
  type OrderStatusValue,
  type ExtraTurnOperation,
  targetReferenceKind,
  explicitClientFromInterpretation,
} from './turn-interpretation.ts';
import type { RegisterCashMovementCommand } from '../domain/cash/cash-types.ts';
import { resolveQueryDateRange, wantsEntityList, isSingleRecordMetric } from './query-policy.ts';
import { isQueryRefinement } from './turn-priority.ts';
import { personNamesLookRelated } from './lookups.ts';

export type { RegisterCashMovementCommand } from '../domain/cash/cash-types.ts';

/** Día civil en UTC−3 (Río de la Plata), a partir del clock del servidor. */
export function calendarDayAr(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export type SemanticCash = CashInterpretation & {
  scope?: string;
  date?: string;
};

export type SemanticPayment = PaymentInterpretation & {
  fullBalance?: boolean;
};

export type SemanticOperation = {
  intent: WhatsappIntent;
  cash?: SemanticCash;
  payment?: SemanticPayment;
  items?: LineItemIntent[];
  client?: TurnInterpretation['client'];
  dates?: TurnDates;
  requestedStatus?: OrderStatusValue;
  orderStatus?: OrderStatusValue;
  query?: TurnQuery;
  filters?: TurnFilters;
  corrections?: TurnInterpretation['corrections'];
  targetReference?: TargetReference;
  notes?: string;
  extraCosts?: TurnInterpretation['extraCosts'];
  product?: TurnInterpretation['product'];
  supplierName?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  stockResolution?: TurnInterpretation['stockResolution'];
  expectedItemCount?: number;
};

export type SemanticCommand = {
  conversationAction: ConversationAction;
  operations: SemanticOperation[];
  ambiguities?: string[];
  missingFields?: string[];
  requiresClarification?: boolean;
  clarificationReason?: string;
  discardedUnexpectedFields: string[];
  schemaWarnings: string[];
  rawMessage: string;
  requestedCapability?: string;
  capabilityUnwired?: boolean;
};

export type ResolvedTurn = {
  llm: TurnInterpretation;
  command: SemanticCommand;
};

export type SemanticSnapshot = {
  intent: string;
  conversationAction: ConversationAction;
  cashType?: 'ingreso' | 'egreso';
  cashAmount?: number;
  cashConcept?: string;
  cashScope?: string;
  cashDate?: string;
  paymentFull?: boolean;
  paymentAmount?: number;
  orderStatus?: string;
  deliveryDate?: string;
  queryMetric?: string;
  itemCount?: number;
  clientHint?: string;
};

const CASH_INTENTS = new Set<WhatsappIntent>(['register_cash']);
const CLIENT_INTENTS = new Set<WhatsappIntent>([
  'create_order',
  'create_sale',
  'register_payment',
  'query_balance',
  'create_client',
  'update_order_status',
  'query_status',
  'register_cost',
]);
const ITEM_INTENTS = new Set<WhatsappIntent>([
  'create_order',
  'create_sale',
  'create_purchase',
  'query_stock',
  'update_product_cost',
]);
const PAYMENT_INTENTS = new Set<WhatsappIntent>([
  'register_payment',
  'create_order',
  'create_sale',
  'update_order_status',
]);

export function hasMeaningfulStructure(interpretation: TurnInterpretation): boolean {
  return Boolean(
    interpretation.cash?.amount ||
      interpretation.cash?.type ||
      interpretation.cash?.concept ||
      interpretation.payment?.amount ||
      interpretation.payment?.full ||
      interpretation.requestedStatus ||
      interpretation.orderStatus ||
      interpretation.items?.length ||
      interpretation.corrections ||
      interpretation.query?.metric ||
      interpretation.query?.entity ||
      interpretation.targetReference ||
      interpretation.dates?.delivery ||
      interpretation.dates?.order ||
      interpretation.client?.raw ||
      interpretation.client?.name ||
      interpretation.filters?.listOrders ||
      interpretation.filters?.status ||
      interpretation.filters?.dateToken ||
      interpretation.filters?.dateFrom
  );
}

export function snapshotFromInterpretation(interpretation: TurnInterpretation): SemanticSnapshot {
  const cashAmount =
    interpretation.cash?.amount ??
    (interpretation.intent === 'register_cash'
      ? interpretation.payment?.amount ?? interpretation.amount
      : undefined);
  return {
    intent: interpretation.intent,
    conversationAction: interpretation.conversationAction,
    cashType: interpretation.cash?.type,
    cashAmount,
    cashConcept: interpretation.cash?.concept,
    cashScope: interpretation.cash?.ambitoHint || interpretation.cash?.scope,
    cashDate: interpretation.cash?.date,
    paymentFull: interpretation.payment?.full === true || interpretation.payment?.fullBalance === true,
    paymentAmount: interpretation.payment?.amount,
    orderStatus: interpretation.orderStatus || interpretation.requestedStatus,
    deliveryDate: interpretation.dates?.delivery,
    queryMetric: interpretation.query?.metric,
    itemCount: interpretation.items?.length,
    clientHint: interpretation.client?.raw || interpretation.client?.name,
  };
}

export function snapshotFromCommand(command: SemanticCommand): SemanticSnapshot {
  const op = command.operations[0];
  return {
    intent: op?.intent ?? 'unknown',
    conversationAction: command.conversationAction,
    cashType: op?.cash?.type,
    cashAmount: op?.cash?.amount,
    cashConcept: op?.cash?.concept,
    cashScope: op?.cash?.scope || op?.cash?.ambitoHint,
    cashDate: op?.cash?.date || op?.dates?.order,
    paymentFull: op?.payment?.full === true || op?.payment?.fullBalance === true,
    paymentAmount: op?.payment?.amount,
    orderStatus: op?.orderStatus || op?.requestedStatus,
    deliveryDate: op?.dates?.delivery,
    queryMetric: op?.query?.metric,
    itemCount: op?.items?.length,
    clientHint: op?.client?.raw || op?.client?.name,
  };
}

export function snapshotFromPlan(plan: {
  operations: Array<{ intent: string; payload?: Record<string, unknown> }>;
  conversationAction?: string;
}): SemanticSnapshot {
  const primary = plan.operations[0];
  const payload = (primary?.payload ?? {}) as Record<string, unknown>;
  const cashAmount = positiveMoney(payload.cashAmount ?? payload.amount);
  const paymentOp = plan.operations.find((row) => row.intent === 'register_collection' || row.intent === 'register_payment');
  const payPayload = (paymentOp?.payload ?? {}) as Record<string, unknown>;
  return {
    intent: String(primary?.intent ?? ''),
    conversationAction: (plan.conversationAction as ConversationAction) || 'new_task',
    cashType: payload.cashType as SemanticSnapshot['cashType'],
    cashAmount: primary?.intent === 'register_cash' ? cashAmount : undefined,
    cashConcept: payload.cashConcept ? String(payload.cashConcept) : undefined,
    cashScope: payload.cashAmbitoHint ? String(payload.cashAmbitoHint) : payload.cashScope ? String(payload.cashScope) : undefined,
    cashDate: payload.cashDate ? String(payload.cashDate) : payload.orderDate ? String(payload.orderDate) : undefined,
    paymentFull: payPayload.payFullBalance === true || payload.payFullBalance === true,
    paymentAmount: positiveMoney(payPayload.amount ?? payload.collectionAmount),
    orderStatus: payload.orderStatus ? String(payload.orderStatus) : payload.requestedStatus ? String(payload.requestedStatus) : undefined,
    deliveryDate: payload.deliveryDate ? String(payload.deliveryDate) : undefined,
    queryMetric: payload.queryMetric ? String(payload.queryMetric) : undefined,
    itemCount: Array.isArray(payload.items) ? payload.items.length : undefined,
    clientHint: payload.clientName ? String(payload.clientName) : undefined,
  };
}

/**
 * Equivalencia de significado LLM vs plan.
 * Permitido: ids ERP, fecha relativa resuelta, salvage unknown→intent concreto, payFull sin monto.
 * Prohibido: perder amount de caja, cambiar dominio, new_task destructivo vs corrección.
 */
export function meaningEquivalent(
  llm: SemanticSnapshot,
  final: SemanticSnapshot,
  opts?: { allowIntentSalvage?: boolean }
): { ok: boolean; diffs: string[] } {
  const diffs: string[] = [];
  const salvage =
    opts?.allowIntentSalvage !== false && llm.intent === 'unknown' && final.intent !== 'unknown';
  if (llm.intent !== final.intent && !salvage) {
    diffs.push(`intent ${llm.intent} → ${final.intent}`);
  }
  const llmCash = llm.cashAmount ?? (llm.intent === 'register_cash' ? llm.paymentAmount : undefined);
  const finalCash = final.cashAmount;
  if (llmCash != null && llmCash > 0) {
    if (finalCash !== llmCash) {
      diffs.push(`cashAmount ${llmCash} → ${finalCash ?? 0}`);
    }
  }
  if (llm.cashType && final.cashType && llm.cashType !== final.cashType) {
    diffs.push(`cashType ${llm.cashType} → ${final.cashType}`);
  }
  if (llm.cashConcept && final.cashConcept && fold(llm.cashConcept) !== fold(final.cashConcept)) {
    diffs.push(`cashConcept ${llm.cashConcept} → ${final.cashConcept}`);
  }
  if (llm.conversationAction === 'correct_current' && final.conversationAction === 'new_task') {
    diffs.push('correction → new_task');
  }
  if (llm.intent === 'register_cash' && final.intent === 'query_cash') {
    diffs.push('register_cash → query_cash');
  }
  if (llm.intent === 'register_cash' && llm.cashAmount && final.paymentAmount && !final.cashAmount) {
    diffs.push('expense → payment');
  }
  return { ok: diffs.length === 0, diffs };
}

export function logSemanticDrift(input: {
  rawMessage: string;
  llm: SemanticSnapshot;
  normalized: SemanticSnapshot;
  plan: SemanticSnapshot;
  fieldDiff: string[];
}): void {
  if (!input.fieldDiff.length) return;
  console.error(
    '[whatsapp:SEMANTIC_DRIFT]',
    JSON.stringify({
      rawMessage: input.rawMessage.slice(0, 240),
      llmOutput: input.llm,
      normalizedOutput: input.normalized,
      operationPlan: input.plan,
      fieldDiff: input.fieldDiff,
    })
  );
}

export function resolveSemanticTurn(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation | null,
  now: Date = new Date()
): ResolvedTurn {
  const warnings: string[] = [];
  const discarded: string[] = [];
  const today = calendarDayAr(now);

  let intent = interpretation.intent;
  let action = interpretation.conversationAction;
  const salvage = salvageIntentFromStructure(interpretation);
  if (intent === 'unknown' && salvage) {
    intent = salvage;
    warnings.push(`schema/model mismatch: unknown salvaged to ${salvage}`);
  }

  const hasTask = Boolean(
    conversation?.pendingIntent ||
      conversation?.knownEntities?.items?.length ||
      conversation?.focusOrder?.id ||
      conversation?.focusEntities?.product?.id
  );

  if (intent === 'unknown' && hasMeaningfulStructure(interpretation) && hasTask) {
    action = interpretation.items?.length || interpretation.corrections ? 'correct_current' : 'continue_current';
    warnings.push('unknown with structured fields: keep current task');
  }

  if (
    hasTask &&
    intent === 'unknown' &&
    action === 'new_task' &&
    hasMeaningfulStructure(interpretation)
  ) {
    action = interpretation.items?.length || interpretation.corrections ? 'correct_current' : 'continue_current';
    warnings.push('blocked destructive new_task on unknown+structure');
  }

  if (action === 'new_task' && (interpretation.items?.length || interpretation.corrections) && conversation?.knownEntities?.items?.length) {
    action = 'correct_current';
    if (intent === 'unknown') intent = 'create_order';
    warnings.push('item edits against active items: correct_current');
  }
  if (intent === 'unknown' && action === 'correct_current' && conversation?.knownEntities?.items?.length) {
    intent = 'create_order';
    warnings.push('unknown item correction salvaged to create_order');
  }

  const explicitClient = explicitClientFromInterpretation(interpretation);
  if (explicitClient && !interpretation.client?.raw && !interpretation.client?.name) {
    interpretation.client = { ...(interpretation.client ?? {}), raw: explicitClient };
  }
  const focusName = String(conversation?.focusOrder?.clientName ?? '').trim();
  if (explicitClient && focusName && !personNamesLookRelated(explicitClient, focusName)) {
    action = 'new_task';
    warnings.push('explicit client overrides focused client: new_task');
  }

  inheritQueryContext(interpretation, conversation, intent, action);

  let cash = normalizeCash(interpretation, intent, warnings);
  cash = mergeCashFromExtraOperations(cash, interpretation, intent, warnings);
  const payment = normalizePayment(interpretation, intent, cash, warnings);
  const dates = resolveTurnDates(interpretation.dates, cash?.date, today);
  if (cash && dates?.order) cash.date = dates.order;

  if (interpretation.query?.page === 'next' && !interpretation.client?.raw && !interpretation.client?.name) {
    const lastClient = conversation?.lastQuery?.slots?.clientName;
    if (lastClient) {
      interpretation.client = { ...(interpretation.client ?? {}), raw: lastClient };
    }
    const lastIntent = conversation?.lastQuery?.intent;
    if (intent === 'unknown' && lastIntent === 'query_status') {
      intent = 'query_status';
      warnings.push('schema/model mismatch: page=next salvaged to lastQuery');
    }
  }

  const filters = normalizeQueryFilters(interpretation.filters, today, intent, interpretation.query) ?? {};
  const targetKind = targetReferenceKind(interpretation.targetReference);
  if (
    intent === 'query_status' &&
    (interpretation.client?.raw || interpretation.client?.name) &&
    !interpretation.orderNumber &&
    !isSingleRecordMetric(interpretation.query?.metric) &&
    targetKind !== 'focused_order' &&
    targetKind !== 'explicit_order' &&
    targetKind !== 'last_completed'
  ) {
    filters.listOrders = true;
    interpretation.query = {
      ...(interpretation.query ?? {}),
      entity: interpretation.query?.entity || 'orders',
      metric: interpretation.query?.metric || 'list',
    };
  }

  const primary: SemanticOperation = {
    intent,
    cash: CASH_INTENTS.has(intent) ? cash : undefined,
    payment: PAYMENT_INTENTS.has(intent) ? payment : undefined,
    items: ITEM_INTENTS.has(intent) || action === 'correct_current' ? interpretation.items : undefined,
    client: CLIENT_INTENTS.has(intent) ? interpretation.client : undefined,
    dates,
    requestedStatus: interpretation.requestedStatus,
    orderStatus: interpretation.orderStatus,
    query: interpretation.query,
    filters,
    corrections: interpretation.corrections,
    targetReference: interpretation.targetReference,
    notes: interpretation.notes,
    extraCosts: interpretation.extraCosts,
    product: interpretation.product,
    supplierName: interpretation.supplierName,
    invoiceNumber: interpretation.invoiceNumber,
    orderNumber: interpretation.orderNumber,
    stockResolution: interpretation.stockResolution,
    expectedItemCount: interpretation.expectedItemCount,
  };

  if (!CLIENT_INTENTS.has(intent) && interpretation.client?.raw) {
    discarded.push('client');
  }
  if (CASH_INTENTS.has(intent) && interpretation.client) {
    discarded.push('client');
    primary.client = undefined;
  }
  if (intent === 'query_stock' && interpretation.client) {
    discarded.push('client');
    primary.client = undefined;
  }
  if (intent === 'update_order_status' && interpretation.items?.length && !interpretation.corrections) {
    discarded.push('items');
    primary.items = undefined;
  }
  if (CASH_INTENTS.has(intent) && payment && !CASH_INTENTS.has(intent)) {
    /* payment already stripped for cash */
  }
  if (CASH_INTENTS.has(intent)) {
    primary.payment = undefined;
  }

  const operations: SemanticOperation[] = [primary];
  if (interpretation.operations?.length) {
    for (const extra of interpretation.operations) {
      const extraIntent = extra.intent;
      if (!extraIntent || extraIntent === 'unknown' || extraIntent === primary.intent) continue;
      if (isSpuriousQueryExtra(extraIntent, extra, intent, payment)) {
        warnings.push(`discarded extra ${extraIntent}: not a real query`);
        continue;
      }
      operations.push({
        intent: extraIntent,
        cash: extra.cash,
        payment: extra.payment,
        requestedStatus: extra.requestedStatus,
        orderStatus: extra.orderStatus,
        dates: extra.dates,
        notes: extra.notes,
        client: extra.client,
        targetReference: extra.targetReference,
      });
    }
  }
  if (
    (intent === 'update_order_status' || intent === 'create_order' || intent === 'create_sale') &&
    (payment?.full || payment?.fullBalance || (payment?.amount != null && payment.amount > 0)) &&
    !operations.some((row) => row.intent === 'register_payment')
  ) {
    operations.push({
      intent: 'register_payment',
      payment,
      targetReference: interpretation.targetReference,
      client: interpretation.client,
    });
  }

  const missing = [...(interpretation.missingFields ?? [])];
  if (intent === 'register_cash' && (cash?.amount == null || cash.amount <= 0)) {
    missing.push('cash.amount');
  }

  const command: SemanticCommand = {
    conversationAction: action,
    operations,
    ambiguities: interpretation.ambiguities,
    missingFields: missing.length ? missing : undefined,
    requiresClarification:
      interpretation.requiresClarification === true ||
      (intent === 'unknown' && hasMeaningfulStructure(interpretation)) ||
      missing.includes('cash.amount'),
    clarificationReason: interpretation.clarificationReason,
    discardedUnexpectedFields: discarded,
    schemaWarnings: warnings,
    rawMessage: interpretation.rawMessage,
    requestedCapability: interpretation.requestedCapability,
    capabilityUnwired: interpretation.capabilityUnwired === true,
  };

  return { llm: interpretation, command };
}

export function shouldClearPendingForCommand(command: SemanticCommand): boolean {
  if (command.conversationAction === 'new_task') {
    const intent = command.operations[0]?.intent;
    if (intent === 'unknown' && (command.requiresClarification || command.operations[0]?.corrections || command.operations[0]?.items?.length)) {
      return false;
    }
    return intent !== 'unknown';
  }
  return false;
}

export function semanticCommandToLegacyEntities(command: SemanticCommand): WhatsappCommandEntities {
  const op = command.operations[0] ?? { intent: 'unknown' as WhatsappIntent };
  const entities: WhatsappCommandEntities = {
    rawUserMessage: command.rawMessage,
    sourceText: command.rawMessage,
    conversationAction: command.conversationAction,
    semanticCommand: command,
    requestedCapability: command.requestedCapability,
    capabilityUnwired: command.capabilityUnwired,
  };
  const clientRaw = op.client?.raw || op.client?.name;
  if (clientRaw && CLIENT_INTENTS.has(op.intent)) {
    entities.clientName = clientRaw;
    entities.spokenClientName = op.client?.raw || clientRaw;
  }
  if (op.client?.phone) entities.clientPhone = op.client.phone;
  if (op.items?.length) entities.items = op.items;
  if (op.notes) entities.notes = op.notes;
  if (op.requestedStatus) entities.requestedStatus = op.requestedStatus;
  if (op.orderStatus) entities.orderStatus = op.orderStatus;
  if (op.intent === 'update_order_status' && !entities.orderStatus && op.requestedStatus) {
    entities.orderStatus = op.requestedStatus;
  }
  if (op.dates?.delivery) entities.deliveryDate = op.dates.delivery;
  if (op.dates?.order) entities.orderDate = op.dates.order;
  if (op.filters?.listOrders) entities.listOrders = true;
  if (op.filters?.status) entities.queryStatusFilter = op.filters.status;
  if (op.filters?.dateFrom) entities.queryDateFrom = op.filters.dateFrom;
  if (op.filters?.dateTo) entities.queryDateTo = op.filters.dateTo;
  if (op.filters?.dateToken) entities.queryDateToken = op.filters.dateToken;
  if (op.filters?.dateField) entities.queryDateField = op.filters.dateField;
  if (op.query?.entity) entities.queryEntity = op.query.entity;
  if (op.query?.limit != null) entities.queryLimit = op.query.limit;
  if (op.query?.requestAll) entities.queryRequestAll = true;
  if (op.query?.page) entities.queryPage = op.query.page;
  if (op.query?.sortDirection) entities.querySortDir = op.query.sortDirection;
  if (op.stockResolution) entities.stockResolution = op.stockResolution;
  if (op.expectedItemCount) entities.expectedItemCount = op.expectedItemCount;
  if (op.orderNumber) entities.orderNumber = op.orderNumber;
  if (op.supplierName) entities.supplierName = op.supplierName;
  if (op.invoiceNumber) entities.invoiceNumber = op.invoiceNumber;
  if (op.extraCosts?.length) {
    entities.extraCosts = op.extraCosts.map((row) => ({
      nombre: String(row.nombre || 'Costo extra'),
      costo: Number(row.costo) || 0,
    }));
  }
  if (op.query?.metric) entities.queryMetric = op.query.metric;
  if (op.query?.expectedValue != null) entities.queryExpectedValue = op.query.expectedValue;

  if (op.cash) {
    if (op.cash.type) entities.cashType = op.cash.type;
    if (op.cash.concept) entities.cashConcept = op.cash.concept.trim();
    if (op.cash.ambitoHint || op.cash.scope) {
      entities.cashAmbitoHint = op.cash.scope || op.cash.ambitoHint;
    }
    if (op.cash.amount != null && op.cash.amount > 0) entities.amount = op.cash.amount;
    if (op.cash.date) entities.orderDate = op.cash.date;
  } else if (op.payment) {
    if (op.payment.amount != null && op.payment.amount > 0) {
      entities.amount = op.payment.amount;
      entities.collectionAmount = op.payment.amount;
    }
    if (op.payment.full || op.payment.fullBalance) {
      entities.paid = true;
      entities.payFullBalance = true;
    } else if (op.payment.amount != null && op.payment.amount > 0) {
      entities.paid = true;
    }
    if (op.payment.kind === 'senia') {
      entities.paymentKind = 'senia';
      entities.seniaAmount = op.payment.amount;
    } else if (op.payment.kind === 'pago') {
      entities.paymentKind = 'pago';
    }
    if (op.payment.method) entities.paymentHint = op.payment.method;
  }

  const payOp = command.operations.find((row) => row.intent === 'register_payment');
  if (op.intent === 'update_order_status' && payOp?.payment) {
    if (payOp.payment.full || payOp.payment.fullBalance) {
      entities.paid = true;
      entities.payFullBalance = true;
    }
    if (payOp.payment.amount != null && payOp.payment.amount > 0) {
      entities.amount = payOp.payment.amount;
      entities.collectionAmount = payOp.payment.amount;
      entities.paid = true;
    }
  }

  if (op.intent === 'create_order' && op.payment) {
    if (op.payment.full || op.payment.fullBalance) {
      entities.paid = true;
      entities.payFullBalance = true;
    } else if (op.payment.amount != null && op.payment.amount > 0) {
      entities.paid = true;
      entities.collectionAmount = op.payment.amount;
    }
  }

  return entities;
}

export function cashCommandFromOperation(
  businessId: string,
  op: SemanticOperation,
  phone?: string
): RegisterCashMovementCommand | { error: string } {
  const type = op.cash?.type;
  const amount = op.cash?.amount;
  if (!type) return { error: 'Falta cash.type (ingreso|egreso).' };
  if (amount == null || amount <= 0) return { error: 'Falta cash.amount.' };
  return {
    businessId,
    type,
    amount,
    concept: String(op.cash?.concept || '').trim() || (type === 'egreso' ? 'Egreso' : 'Ingreso'),
    scope: op.cash?.scope || op.cash?.ambitoHint,
    date: op.cash?.date || op.dates?.order,
    source: 'whatsapp',
    actor: phone ? { type: 'whatsapp_user', phone } : { type: 'whatsapp_user' },
  };
}

function inheritQueryContext(
  interpretation: TurnInterpretation,
  conversation: WhatsappParseConversation | null | undefined,
  intent: WhatsappIntent,
  action: ConversationAction
): void {
  const last = conversation?.lastQuery;
  if (!last?.slots) return;
  const queryFamily =
    intent === 'query_status' ||
    intent === 'query_cash' ||
    intent === 'query_stock' ||
    intent === 'query_balance';
  if (!queryFamily) return;
  const refining = isQueryRefinement({
    status: interpretation.filters?.status,
    dateToken: interpretation.filters?.dateToken,
    dateFrom: interpretation.filters?.dateFrom,
    dateTo: interpretation.filters?.dateTo,
    page: interpretation.query?.page,
    requestAll: interpretation.query?.requestAll,
    limit: interpretation.query?.limit,
  });
  const explicitClient = explicitClientFromInterpretation(interpretation);
  const inheritClient =
    !explicitClient && (interpretation.query?.page === 'next' || (refining && action !== 'new_task'));
  if (inheritClient && last.slots.clientName) {
    interpretation.client = { ...(interpretation.client ?? {}), raw: last.slots.clientName };
  }
  if (!inheritClient && !refining && action !== 'continue_current') return;
  if (!inheritClient && !refining && action === 'continue_current') return;
  const filters: TurnFilters = { ...(interpretation.filters ?? {}) };
  if (!filters.status && last.slots.status) {
    const st = last.slots.status;
    if (st === 'pendiente' || st === 'en_produccion' || st === 'listo' || st === 'entregado') {
      filters.status = st;
    }
  }
  if (!filters.dateFrom && last.slots.dateFrom) filters.dateFrom = last.slots.dateFrom;
  if (!filters.dateTo && last.slots.dateTo) filters.dateTo = last.slots.dateTo;
  if (!filters.dateField && last.slots.dateField === 'fechaEntrega') filters.dateField = 'fechaEntrega';
  if (!filters.listOrders && (last.slots.metric === 'list' || last.slots.entity === 'orders')) {
    filters.listOrders = true;
  }
  interpretation.filters = filters;
  interpretation.query = {
    ...(interpretation.query ?? {}),
    entity: interpretation.query?.entity || (last.slots.entity as TurnQuery['entity']) || 'orders',
    metric: interpretation.query?.metric || (last.slots.metric as TurnQuery['metric']) || 'list',
    limit: interpretation.query?.limit ?? last.slots.limit,
  };
}

function salvageIntentFromStructure(interpretation: TurnInterpretation): WhatsappIntent | null {
  if (interpretation.cash?.amount || interpretation.cash?.type || interpretation.cash?.concept) {
    return 'register_cash';
  }
  if (interpretation.query?.metric === 'stock' || interpretation.query?.metric === 'verify') {
    return 'query_stock';
  }
  if (interpretation.requestedStatus || interpretation.orderStatus) {
    return 'update_order_status';
  }
  if (
    interpretation.query?.entity === 'orders' ||
    interpretation.query?.entity === 'sales' ||
    interpretation.query?.metric === 'list' ||
    interpretation.query?.metric === 'count' ||
    interpretation.query?.metric === 'sum' ||
    interpretation.filters?.listOrders
  ) {
    return 'query_status';
  }
  if (interpretation.query?.metric === 'status' || interpretation.query?.metric === 'balance' || interpretation.query?.metric === 'details') {
    return 'query_status';
  }
  if (interpretation.payment?.full || interpretation.payment?.amount) {
    if (interpretation.targetReference || interpretation.client) return 'register_payment';
  }
  if (interpretation.items?.length && interpretation.corrections) return 'create_order';
  return null;
}

function normalizeCash(
  interpretation: TurnInterpretation,
  intent: WhatsappIntent,
  warnings: string[]
): SemanticCash | undefined {
  const cash: SemanticCash = { ...(interpretation.cash ?? {}) };
  const paymentAmount = positiveMoney(interpretation.payment?.amount);
  const rootAmount = positiveMoney(interpretation.amount);
  if (intent === 'register_cash' || cash.type || cash.amount || cash.concept) {
    if (cash.amount == null && paymentAmount != null) {
      cash.amount = paymentAmount;
      warnings.push('schema/model mismatch: payment.amount → cash.amount');
    }
    if (cash.amount == null && rootAmount != null) {
      cash.amount = rootAmount;
      warnings.push('schema/model mismatch: root amount → cash.amount');
    }
    if (cash.concept) cash.concept = cash.concept.trim();
    if (cash.ambitoHint && !cash.scope) cash.scope = cash.ambitoHint;
    if (cash.scope && !cash.ambitoHint) cash.ambitoHint = cash.scope;
    if (!cash.type && !cash.concept && cash.amount == null) return undefined;
    return cash;
  }
  return cash.amount || cash.type || cash.concept ? cash : undefined;
}

function mergeCashFromExtraOperations(
  cash: SemanticCash | undefined,
  interpretation: TurnInterpretation,
  intent: WhatsappIntent,
  warnings: string[]
): SemanticCash | undefined {
  if (intent !== 'register_cash') return cash;
  const next: SemanticCash = { ...(cash ?? {}) };
  for (const extra of interpretation.operations ?? []) {
    const extraAmount = positiveMoney(extra.cash?.amount ?? extra.amount);
    if (next.amount == null && extraAmount != null) {
      next.amount = extraAmount;
      warnings.push('schema/model mismatch: operations[].amount → cash.amount');
    }
    if (!next.type && extra.cash?.type) next.type = extra.cash.type;
    if (!next.concept && extra.cash?.concept) next.concept = extra.cash.concept.trim();
    if (!next.scope && (extra.cash?.scope || extra.cash?.ambitoHint)) {
      next.scope = extra.cash.scope || extra.cash.ambitoHint;
      next.ambitoHint = next.scope;
    }
  }
  if (!next.type && !next.concept && next.amount == null && !next.scope && !next.date) return cash;
  return next;
}

const QUERY_EXTRA_INTENTS = new Set<WhatsappIntent>([
  'query_status',
  'query_cash',
  'query_balance',
  'query_stock',
]);

function normalizeQueryFilters(
  filters: TurnFilters | undefined,
  today: string,
  intent: WhatsappIntent,
  query: TurnQuery | undefined
): TurnFilters | undefined {
  const next: TurnFilters = { ...(filters ?? {}) };
  const range =
    resolveQueryDateRange(next.dateToken, today) ||
    (next.dateFrom || next.dateTo
      ? {
          from: next.dateFrom || next.dateTo || '',
          to: next.dateTo || next.dateFrom || '',
        }
      : undefined);
  if (range?.from) next.dateFrom = range.from;
  if (range?.to) next.dateTo = range.to;
  if (
    wantsEntityList({
      listOrders: next.listOrders,
      entity: query?.entity,
      metric: query?.metric,
    })
  ) {
    next.listOrders = true;
  }
  if (intent === 'query_status' && (query?.metric === 'list' || query?.metric === 'count' || query?.entity === 'orders')) {
    next.listOrders = true;
  }
  if (
    !next.listOrders &&
    !next.includeDelivered &&
    !next.statusNot &&
    !next.status &&
    !next.dateFrom &&
    !next.dateTo &&
    !next.dateToken
  ) {
    return filters;
  }
  return next;
}

function extraHasQueryBody(extra: ExtraTurnOperation): boolean {
  return Boolean(
    extra.payment || extra.cash || extra.requestedStatus || extra.orderStatus || extra.dates || extra.notes
  );
}

function isSpuriousQueryExtra(
  extraIntent: WhatsappIntent,
  extra: ExtraTurnOperation,
  primaryIntent: WhatsappIntent,
  payment: SemanticPayment | undefined
): boolean {
  if (!QUERY_EXTRA_INTENTS.has(extraIntent)) return false;
  const hasPayment = Boolean(
    payment?.full || payment?.fullBalance || (payment?.amount != null && payment.amount > 0)
  );
  if (hasPayment && extraIntent === 'query_status' && !extra.payment && !extra.notes) return true;
  if (
    (primaryIntent === 'update_order_status' ||
      primaryIntent === 'register_cash' ||
      primaryIntent === 'create_order') &&
    extraIntent === 'query_status' &&
    !extraHasQueryBody(extra)
  ) {
    return true;
  }
  return false;
}

function normalizePayment(
  interpretation: TurnInterpretation,
  intent: WhatsappIntent,
  cash: SemanticCash | undefined,
  warnings: string[]
): SemanticPayment | undefined {
  if (intent === 'register_cash') return undefined;
  const payment: SemanticPayment = { ...(interpretation.payment ?? {}) };
  if (payment.full === true) payment.fullBalance = true;
  if (payment.fullBalance === true) payment.full = true;
  const amount = positiveMoney(payment.amount);
  if (amount != null) payment.amount = amount;
  else delete payment.amount;
  if (!payment.full && !payment.fullBalance && payment.amount == null && !payment.kind) return undefined;
  if (cash?.amount && payment.amount === cash.amount && intent !== 'register_payment') {
    warnings.push('payment.amount ignored; belongs to cash');
    return undefined;
  }
  return payment;
}

function resolveTurnDates(dates: TurnDates | undefined, cashDate: string | undefined, today: string): TurnDates | undefined {
  const delivery = resolveDateToken(dates?.delivery, today);
  const order = resolveDateToken(dates?.order || cashDate, today);
  if (!delivery && !order) return undefined;
  return { delivery, order };
}

/** Normaliza tokens de fecha que YA vienen en el JSON (no parsea el utterance). */
export function resolveDateToken(value: string | undefined, today: string): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    return isValidCalendarIsoDay(iso) ? iso : undefined;
  }
  const fold = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const base = parseIsoDay(today);
  if (!base) return undefined;
  if (fold === 'hoy' || fold === 'today') return today;
  if (fold === 'ayer' || fold === 'yesterday') return shiftDay(base, -1);
  if (fold === 'manana' || fold === 'mañana' || fold === 'tomorrow') return shiftDay(base, 1);
  if (fold === 'pasado manana' || fold === 'pasado mañana' || fold === 'day_after_tomorrow') {
    return shiftDay(base, 2);
  }

  // AR: DD/MM, DD/MM/YY, DD/MM/YYYY (también con - o .)
  const full = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(raw);
  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    let year = Number(full[3]);
    if (year < 100) year += 2000;
    return buildIsoDay(day, month, year) ?? undefined;
  }
  const short = /^(\d{1,2})[/\-.](\d{1,2})$/.exec(raw);
  if (short) {
    return resolveDayMonthAgainstToday(Number(short[1]), Number(short[2]), today) ?? undefined;
  }

  return undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildIsoDay(day: number, month: number, year: number): string | null {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return isValidCalendarIsoDay(iso) ? iso : null;
}

function isValidCalendarIsoDay(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
  );
}

/** DD/MM sin año: usa el año de `today`; si cae >120 días en el futuro, año anterior. */
function resolveDayMonthAgainstToday(day: number, month: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  let iso = buildIsoDay(day, month, year);
  if (!iso) return null;
  const todayMs = Date.parse(`${today}T12:00:00Z`);
  const isoMs = Date.parse(`${iso}T12:00:00Z`);
  if (Number.isFinite(todayMs) && Number.isFinite(isoMs) && isoMs - todayMs > 120 * 86400000) {
    iso = buildIsoDay(day, month, year - 1);
  }
  return iso;
}

function parseIsoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function shiftDay(base: Date, delta: number): string {
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

export function semanticOperationPayload(op: SemanticOperation): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (op.client?.raw || op.client?.name) payload.clientName = op.client.raw || op.client.name;
  if (op.items) payload.items = op.items;
  if (op.notes) payload.notes = op.notes;
  if (op.dates?.delivery) payload.deliveryDate = op.dates.delivery;
  if (op.dates?.order) payload.orderDate = op.dates.order;
  if (op.requestedStatus) payload.requestedStatus = op.requestedStatus;
  if (op.orderStatus) payload.orderStatus = op.orderStatus;
  if (op.cash?.type) payload.cashType = op.cash.type;
  if (op.cash?.concept) payload.cashConcept = op.cash.concept;
  if (op.cash?.scope || op.cash?.ambitoHint) payload.cashAmbitoHint = op.cash.scope || op.cash.ambitoHint;
  if (op.cash?.scope) payload.cashScope = op.cash.scope;
  if (op.cash?.amount != null) {
    payload.cashAmount = op.cash.amount;
    payload.amount = op.cash.amount;
  }
  if (op.cash?.date) payload.cashDate = op.cash.date;
  if (op.payment?.full || op.payment?.fullBalance) {
    payload.paid = true;
    payload.payFullBalance = true;
  }
  if (op.payment?.amount != null) {
    payload.collectionAmount = op.payment.amount;
    if (payload.amount == null) payload.amount = op.payment.amount;
    payload.paid = true;
  }
  if (op.query?.metric) payload.queryMetric = op.query.metric;
  if (op.query?.entity) payload.queryEntity = op.query.entity;
  if (op.query?.limit != null) payload.queryLimit = op.query.limit;
  if (op.query?.requestAll) payload.queryRequestAll = true;
  if (op.filters?.listOrders) payload.listOrders = true;
  if (op.filters?.status) payload.queryStatusFilter = op.filters.status;
  if (op.supplierName) payload.supplierName = op.supplierName;
  if (op.extraCosts) payload.extraCosts = op.extraCosts;
  if (op.orderNumber) payload.orderNumber = op.orderNumber;
  return payload;
}

export function semanticSummaryLines(op: SemanticOperation | undefined): string[] {
  if (!op) return [];
  const lines: string[] = [];
  const client = op.client?.raw || op.client?.name;
  if (client) lines.push(`Cliente: ${client}`);
  for (const item of op.items ?? []) {
    const name = item.productName || item.productHint || item.rawText;
    if (name) lines.push(`Ítem: ${name}`);
  }
  if (op.cash?.amount != null) {
    lines.push(`${op.cash.type === 'ingreso' ? 'Ingreso' : 'Egreso'}: $${op.cash.amount}`);
  }
  if (op.cash?.concept) lines.push(`Motivo: ${op.cash.concept}`);
  if (op.payment?.full || op.payment?.fullBalance) lines.push('Cobro: saldo completo');
  else if (op.payment?.amount != null) lines.push(`Cobro: $${op.payment.amount}`);
  if (op.requestedStatus || op.orderStatus) lines.push(`Estado: ${op.orderStatus || op.requestedStatus}`);
  if (op.dates?.delivery) lines.push(`Entrega: ${op.dates.delivery}`);
  if (op.cash?.date || op.dates?.order) lines.push(`Fecha: ${op.cash?.date || op.dates?.order}`);
  return lines;
}

function positiveMoney(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
