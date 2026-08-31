import type { ConversationAction, LineItemIntent } from './conversation-contract.ts';
import { parseConversationAction, parseLineItems } from './conversation-contract.ts';
import type {
  ParsedWhatsappCommand,
  WhatsappCommandEntities,
  WhatsappIntent,
  WhatsappParseConversation,
} from './ai-command-parser.ts';
import { personNamesLookRelated } from './lookups.ts';
import { lockedOrderFromFocus } from './order-lock.ts';
import { attributesChanged, focusedProductFromState } from './conversation-query.ts';
import { mapLinguisticIntent } from './capability-registry.ts';
import { isListQueryMetric } from './query-policy.ts';
import { isFreshListQuery, preferTurn } from './turn-priority.ts';

const INTENTS: readonly WhatsappIntent[] = [
  'help',
  'how_to',
  'capability_question',
  'greeting',
  'create_order',
  'create_sale',
  'create_purchase',
  'register_payment',
  'query_balance',
  'query_cash',
  'query_status',
  'query_stock',
  'register_cash',
  'create_client',
  'register_cost',
  'update_product_cost',
  'update_order_status',
  'unknown',
];

export type OrderStatusValue = 'pendiente' | 'en_produccion' | 'listo' | 'entregado';

export type QueryMetric = 'stock' | 'status' | 'balance' | 'details' | 'verify' | 'list' | 'count' | 'sum';
export type QueryEntity =
  | 'orders'
  | 'sales'
  | 'purchases'
  | 'cash'
  | 'clients'
  | 'products'
  | 'suppliers';

export type TargetReferenceKind =
  | 'focused_order'
  | 'focused_client'
  | 'focused_product'
  | 'explicit_order'
  | 'explicit_product'
  | 'last_completed';

export type TargetReference =
  | TargetReferenceKind
  | {
      type?: TargetReferenceKind;
      kind?: TargetReferenceKind;
      clientHint?: string;
      orderNumber?: string;
      orderId?: string;
      productId?: string;
      productHint?: string;
    };

export type TurnQuery = {
  entity?: QueryEntity;
  metric?: QueryMetric;
  aggregation?: 'count' | 'sum' | 'list';
  expectedValue?: number;
  limit?: number;
  requestAll?: boolean;
  page?: 'next' | 'first';
  sortDirection?: 'asc' | 'desc';
};

export type TurnProduct = {
  raw?: string;
  attributes?: LineItemIntent['attributes'];
};

export type PaymentInterpretation = {
  full?: boolean;
  fullBalance?: boolean;
  amount?: number;
  kind?: 'senia' | 'pago' | 'related';
  method?: string;
};

export type CashInterpretation = {
  type?: 'ingreso' | 'egreso';
  concept?: string;
  ambitoHint?: string;
  scope?: string;
  amount?: number;
  date?: string;
};

export type TurnDates = {
  delivery?: string;
  order?: string;
};

export type TurnFilters = {
  listOrders?: boolean;
  includeDelivered?: boolean;
  statusNot?: string;
  status?: OrderStatusValue;
  dateFrom?: string;
  dateTo?: string;
  dateToken?: string;
  dateField?: 'createdAt' | 'fechaEntrega';
  clientHint?: string;
};

export type ExtraTurnOperation = {
  intent?: WhatsappIntent;
  type?: string;
  cash?: CashInterpretation;
  payment?: PaymentInterpretation;
  requestedStatus?: OrderStatusValue;
  orderStatus?: OrderStatusValue;
  dates?: TurnDates;
  notes?: string;
  amount?: number;
  client?: { raw?: string; name?: string; phone?: string };
  targetReference?: TargetReference;
};

export type TurnInterpretation = {
  intent: WhatsappIntent;
  confidence: number;
  conversationAction: ConversationAction;
  rawMessage: string;
  transcript?: string;
  client?: { raw?: string; name?: string; phone?: string };
  items?: LineItemIntent[];
  payment?: PaymentInterpretation;
  requestedStatus?: OrderStatusValue;
  orderStatus?: OrderStatusValue;
  notes?: string;
  dates?: TurnDates;
  filters?: TurnFilters;
  corrections?: { field?: string; itemIndex?: number };
  missingFields?: string[];
  ambiguities?: string[];
  requiresClarification?: boolean;
  clarificationReason?: string;
  stockResolution?: 'discount_full_order' | 'discount_reserved' | 'cancel';
  targetReference?: TargetReference;
  query?: TurnQuery;
  product?: TurnProduct;
  helpTopic?: string;
  expectedItemCount?: number;
  cash?: CashInterpretation;
  extraCosts?: Array<{ nombre?: string; costo?: number }>;
  operations?: ExtraTurnOperation[];
  choiceIndex?: number;
  choiceIndexes?: number[];
  supplierName?: string;
  invoiceNumber?: string;
  amount?: number;
  orderNumber?: string;
  requestedCapability?: string;
  capabilityUnwired?: boolean;
  interpreterFailure?: import('./interpreter-availability.ts').InterpreterFailure | null;
};

const STRING_SCHEMA = { type: 'STRING' as const };
const NUMBER_SCHEMA = { type: 'NUMBER' as const };
const BOOL_SCHEMA = { type: 'BOOLEAN' as const };
const INT_SCHEMA = { type: 'INTEGER' as const };

/** Schema Gemini v2: cada propiedad se copia en normalizeTurnInterpretation. */
export const GEMINI_TURN_SCHEMA_V2 = {
  type: 'OBJECT',
  properties: {
    intent: STRING_SCHEMA,
    confidence: NUMBER_SCHEMA,
    conversationAction: STRING_SCHEMA,
    followUpAction: STRING_SCHEMA,
    choiceIndex: INT_SCHEMA,
    choiceIndexes: { type: 'ARRAY', items: INT_SCHEMA },
    requiresClarification: BOOL_SCHEMA,
    clarificationReason: STRING_SCHEMA,
    transcript: STRING_SCHEMA,
    helpTopic: STRING_SCHEMA,
    expectedItemCount: NUMBER_SCHEMA,
    notes: STRING_SCHEMA,
    amount: NUMBER_SCHEMA,
    orderNumber: STRING_SCHEMA,
    supplierName: STRING_SCHEMA,
    invoiceNumber: STRING_SCHEMA,
    requestedStatus: STRING_SCHEMA,
    orderStatus: STRING_SCHEMA,
    stockResolution: STRING_SCHEMA,
    targetReference: {
      type: 'OBJECT',
      properties: {
        type: STRING_SCHEMA,
        kind: STRING_SCHEMA,
        clientHint: STRING_SCHEMA,
        orderNumber: STRING_SCHEMA,
        orderId: STRING_SCHEMA,
        productId: STRING_SCHEMA,
        productHint: STRING_SCHEMA,
      },
    },
    query: {
      type: 'OBJECT',
      properties: {
        entity: STRING_SCHEMA,
        metric: STRING_SCHEMA,
        aggregation: STRING_SCHEMA,
        expectedValue: NUMBER_SCHEMA,
        limit: NUMBER_SCHEMA,
        requestAll: BOOL_SCHEMA,
        page: STRING_SCHEMA,
        sortDirection: STRING_SCHEMA,
        filters: {
          type: 'OBJECT',
          properties: {
            listOrders: BOOL_SCHEMA,
            includeDelivered: BOOL_SCHEMA,
            status: STRING_SCHEMA,
            statusNot: STRING_SCHEMA,
            dateFrom: STRING_SCHEMA,
            dateTo: STRING_SCHEMA,
            dateToken: STRING_SCHEMA,
            dateField: STRING_SCHEMA,
            clientHint: STRING_SCHEMA,
          },
        },
      },
    },
    product: {
      type: 'OBJECT',
      properties: {
        raw: STRING_SCHEMA,
        attributes: {
          type: 'OBJECT',
          properties: {
            type: STRING_SCHEMA,
            fabric: STRING_SCHEMA,
            model: STRING_SCHEMA,
            color: STRING_SCHEMA,
            size: STRING_SCHEMA,
            variant: STRING_SCHEMA,
          },
        },
      },
    },
    client: {
      type: 'OBJECT',
      properties: {
        raw: STRING_SCHEMA,
        name: STRING_SCHEMA,
        phone: STRING_SCHEMA,
      },
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          quantity: NUMBER_SCHEMA,
          rawText: STRING_SCHEMA,
          productHint: STRING_SCHEMA,
          itemKey: STRING_SCHEMA,
          sourceSpan: STRING_SCHEMA,
          attributes: {
            type: 'OBJECT',
            properties: {
              type: STRING_SCHEMA,
              fabric: STRING_SCHEMA,
              model: STRING_SCHEMA,
              color: STRING_SCHEMA,
              size: STRING_SCHEMA,
              variant: STRING_SCHEMA,
            },
          },
        },
        required: ['rawText'],
      },
    },
    payment: {
      type: 'OBJECT',
      properties: {
        full: BOOL_SCHEMA,
        fullBalance: BOOL_SCHEMA,
        amount: NUMBER_SCHEMA,
        kind: STRING_SCHEMA,
        method: STRING_SCHEMA,
      },
    },
    dates: {
      type: 'OBJECT',
      properties: {
        delivery: STRING_SCHEMA,
        order: STRING_SCHEMA,
      },
    },
    filters: {
      type: 'OBJECT',
      properties: {
        listOrders: BOOL_SCHEMA,
        includeDelivered: BOOL_SCHEMA,
        statusNot: STRING_SCHEMA,
        status: STRING_SCHEMA,
        dateFrom: STRING_SCHEMA,
        dateTo: STRING_SCHEMA,
        dateToken: STRING_SCHEMA,
        dateField: STRING_SCHEMA,
      },
    },
    corrections: {
      type: 'OBJECT',
      properties: {
        field: STRING_SCHEMA,
        itemIndex: INT_SCHEMA,
      },
    },
    missingFields: { type: 'ARRAY', items: STRING_SCHEMA },
    ambiguities: { type: 'ARRAY', items: STRING_SCHEMA },
    cash: {
      type: 'OBJECT',
      properties: {
        type: STRING_SCHEMA,
        movementType: STRING_SCHEMA,
        concept: STRING_SCHEMA,
        ambitoHint: STRING_SCHEMA,
        scope: STRING_SCHEMA,
        amount: NUMBER_SCHEMA,
        date: STRING_SCHEMA,
      },
    },
    operations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          intent: STRING_SCHEMA,
          type: STRING_SCHEMA,
          requestedStatus: STRING_SCHEMA,
          orderStatus: STRING_SCHEMA,
          notes: STRING_SCHEMA,
          amount: NUMBER_SCHEMA,
          cash: {
            type: 'OBJECT',
            properties: {
              type: STRING_SCHEMA,
              movementType: STRING_SCHEMA,
              concept: STRING_SCHEMA,
              ambitoHint: STRING_SCHEMA,
              scope: STRING_SCHEMA,
              amount: NUMBER_SCHEMA,
              date: STRING_SCHEMA,
            },
          },
          payment: {
            type: 'OBJECT',
            properties: {
              full: BOOL_SCHEMA,
              fullBalance: BOOL_SCHEMA,
              amount: NUMBER_SCHEMA,
              kind: STRING_SCHEMA,
              method: STRING_SCHEMA,
            },
          },
          dates: {
            type: 'OBJECT',
            properties: {
              delivery: STRING_SCHEMA,
              order: STRING_SCHEMA,
            },
          },
          client: {
            type: 'OBJECT',
            properties: {
              raw: STRING_SCHEMA,
              name: STRING_SCHEMA,
            },
          },
        },
      },
    },
    extraCosts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nombre: STRING_SCHEMA,
          costo: NUMBER_SCHEMA,
        },
      },
    },
  },
  required: ['intent', 'conversationAction'],
} as const;

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function asCashType(value: unknown): 'ingreso' | 'egreso' | undefined {
  const t = asTrimmed(value).toLowerCase();
  if (
    t === 'egreso' ||
    t === 'expense' ||
    t === 'out' ||
    t === 'salida' ||
    t === 'gasto' ||
    t === 'retiro'
  ) {
    return 'egreso';
  }
  if (t === 'ingreso' || t === 'income' || t === 'in' || t === 'entrada') {
    return 'ingreso';
  }
  return undefined;
}

function asCashAmbitoHint(value: unknown): string | undefined {
  const t = asTrimmed(value);
  if (!t) return undefined;
  const fold = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (fold === 'business' || fold === 'company' || fold === 'negocio' || fold === 'empresa') {
    return 'negocio';
  }
  if (fold === 'personal' || fold === 'private' || fold === 'mine' || fold === 'mia') {
    return 'personal';
  }
  return t;
}

/** Gemini a veces manda movementType/scope en inglés en vez de type/ambitoHint. */
export function parseGeminiCash(raw: unknown): CashInterpretation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const cashRaw = raw as Record<string, unknown>;
  const type = asCashType(cashRaw.type ?? cashRaw.movementType ?? cashRaw.kind);
  const concept = asTrimmed(cashRaw.concept) || undefined;
  const ambitoHint = asCashAmbitoHint(
    cashRaw.ambitoHint ?? cashRaw.scope ?? cashRaw.ambito ?? cashRaw.caja
  );
  const amount =
    cashRaw.amount == null || cashRaw.amount === '' ? undefined : asPositiveMoney(cashRaw.amount);
  const date = asTrimmed(cashRaw.date ?? cashRaw.fecha) || undefined;
  if (!type && !concept && amount == null && !ambitoHint && !date) return undefined;
  return { type, concept, ambitoHint, scope: ambitoHint, amount, date };
}

function asNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function asPositiveMoney(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n == null || n <= 0) return undefined;
  return n;
}

function asStatus(value: unknown): OrderStatusValue | undefined {
  const t = asTrimmed(value).toLowerCase();
  if (t === 'pendiente' || t === 'en_produccion' || t === 'listo' || t === 'entregado') return t;
  if (t.startsWith('entreg')) return 'entregado';
  if (t.startsWith('pend')) return 'pendiente';
  if (t.includes('produc')) return 'en_produccion';
  if (t === 'ready' || t === 'listo') return 'listo';
  return undefined;
}

function asIntent(value: unknown): WhatsappIntent {
  return mapLinguisticIntent(asTrimmed(value)).intent;
}

const TARGET_KINDS: readonly TargetReferenceKind[] = [
  'focused_order',
  'focused_client',
  'focused_product',
  'explicit_order',
  'explicit_product',
  'last_completed',
];

const QUERY_METRICS: readonly QueryMetric[] = [
  'stock',
  'status',
  'balance',
  'details',
  'verify',
  'list',
  'count',
  'sum',
];
const QUERY_ENTITIES: readonly QueryEntity[] = [
  'orders',
  'sales',
  'purchases',
  'cash',
  'clients',
  'products',
  'payments',
  'suppliers',
];

function asTargetKind(value: unknown): TargetReferenceKind | undefined {
  const t = asTrimmed(value);
  return (TARGET_KINDS as readonly string[]).includes(t) ? (t as TargetReferenceKind) : undefined;
}

function asQueryMetric(value: unknown): QueryMetric | undefined {
  const t = asTrimmed(value).toLowerCase();
  if (t === 'query_stock' || t === 'stock') return 'stock';
  if (t === 'query_order_status' || t === 'status') return 'status';
  if (t === 'query_order_balance' || t === 'balance') return 'balance';
  if (t === 'query_order_details' || t === 'details') return 'details';
  if (t === 'verify_stock' || t === 'verify') return 'verify';
  if (t === 'query_orders' || t === 'list' || t === 'list_orders') return 'list';
  if (t === 'count' || t === 'how_many') return 'count';
  if (t === 'sum' || t === 'total' || t === 'aggregate') return 'sum';
  return (QUERY_METRICS as readonly string[]).includes(t) ? (t as QueryMetric) : undefined;
}

function asQueryEntity(value: unknown): QueryEntity | undefined {
  const t = asTrimmed(value).toLowerCase();
  if (t === 'order' || t === 'pedido' || t === 'pedidos') return 'orders';
  if (t === 'sale' || t === 'venta' || t === 'ventas') return 'sales';
  if (t === 'purchase' || t === 'compra' || t === 'compras') return 'purchases';
  if (t === 'client' || t === 'cliente' || t === 'clientes') return 'clients';
  if (t === 'product' || t === 'producto' || t === 'productos') return 'products';
  if (t === 'supplier' || t === 'proveedor' || t === 'proveedores') return 'suppliers';
  if (t === 'caja' || t === 'cash') return 'cash';
  return (QUERY_ENTITIES as readonly string[]).includes(t) ? (t as QueryEntity) : undefined;
}

function parseTargetReference(raw: unknown): TargetReference | undefined {
  if (typeof raw === 'string') {
    const kind = asTargetKind(raw.trim());
    if (kind) return kind;
    if (asTrimmed(raw)) return { type: 'explicit_order', clientHint: asTrimmed(raw) };
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const kind = asTargetKind(row.type || row.kind);
  const clientHint = asTrimmed(row.clientHint || row.clientName);
  const orderNumber = asTrimmed(row.orderNumber);
  const orderId = asTrimmed(row.orderId);
  const productId = asTrimmed(row.productId);
  const productHint = asTrimmed(row.productHint);
  if (kind && !clientHint && !orderNumber && !orderId && !productId && !productHint) return kind;
  if (!kind && !clientHint && !orderNumber && !orderId && !productId && !productHint) return undefined;
  return {
    ...(kind ? { type: kind } : {}),
    ...(clientHint ? { clientHint } : {}),
    ...(orderNumber ? { orderNumber } : {}),
    ...(orderId ? { orderId } : {}),
    ...(productId ? { productId } : {}),
    ...(productHint ? { productHint } : {}),
  };
}

export function targetReferenceKind(ref?: TargetReference | null): TargetReferenceKind | undefined {
  if (!ref) return undefined;
  if (typeof ref === 'string') return asTargetKind(ref);
  return asTargetKind(ref.type || ref.kind);
}

function withItemKeys(items: LineItemIntent[]): LineItemIntent[] {
  return items.map((item, index) => ({
    ...item,
    itemKey: item.itemKey || item.sourceSpan || `item:${index + 1}`,
  }));
}

/** Copia el JSON de Gemini. No reinterpreta rawMessage. */
export function normalizeTurnInterpretation(
  raw: Record<string, unknown>,
  rawMessage: string
): TurnInterpretation {
  const items = withItemKeys(parseLineItems(raw.items));
  const paymentRaw = raw.payment && typeof raw.payment === 'object' ? (raw.payment as Record<string, unknown>) : {};
  const datesRaw = raw.dates && typeof raw.dates === 'object' ? (raw.dates as Record<string, unknown>) : {};
  const queryRawEarly = raw.query && typeof raw.query === 'object' && !Array.isArray(raw.query)
    ? (raw.query as Record<string, unknown>)
    : {};
  const nestedFilters =
    queryRawEarly.filters && typeof queryRawEarly.filters === 'object' && !Array.isArray(queryRawEarly.filters)
      ? (queryRawEarly.filters as Record<string, unknown>)
      : {};
  const filtersRaw = {
    ...nestedFilters,
    ...(raw.filters && typeof raw.filters === 'object' && !Array.isArray(raw.filters)
      ? (raw.filters as Record<string, unknown>)
      : {}),
  };
  const extraRaw = Array.isArray(raw.extraCosts) ? raw.extraCosts : [];
  const missing = Array.isArray(raw.missingFields)
    ? raw.missingFields.map((row) => asTrimmed(row)).filter(Boolean)
    : [];
  const ambiguities = Array.isArray(raw.ambiguities)
    ? raw.ambiguities.map((row) => asTrimmed(row)).filter(Boolean)
    : [];
  const choiceIndexes = Array.isArray(raw.choiceIndexes)
    ? raw.choiceIndexes.map((row) => Number(row)).filter((n) => Number.isFinite(n) && n >= 1)
    : undefined;

  const rawIntentLabel = asTrimmed(raw.intent);
  const mappedIntent = mapLinguisticIntent(rawIntentLabel);
  const listedAlias =
    mappedIntent.requestedCapability === 'query_orders' ||
    mappedIntent.requestedCapability === 'query_order_list' ||
    mappedIntent.requestedCapability === 'list_orders' ||
    mappedIntent.requestedCapability === 'query_sales' ||
    rawIntentLabel === 'query_orders' ||
    rawIntentLabel === 'query_order_list' ||
    rawIntentLabel === 'list_orders';

  const interpretation: TurnInterpretation = {
    intent: mappedIntent.intent,
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.7)),
    conversationAction: parseConversationAction(raw.conversationAction) || 'new_task',
    rawMessage,
    transcript: asTrimmed(raw.transcript) || undefined,
    helpTopic: asTrimmed(raw.helpTopic) || undefined,
    expectedItemCount: asNumber(raw.expectedItemCount),
    notes: asTrimmed(raw.notes) || undefined,
    amount: asPositiveMoney(raw.amount),
    orderNumber: asTrimmed(raw.orderNumber) || undefined,
    supplierName: asTrimmed(raw.supplierName) || undefined,
    invoiceNumber: asTrimmed(raw.invoiceNumber) || undefined,
    requestedStatus: asStatus(raw.requestedStatus),
    orderStatus: asStatus(raw.orderStatus),
    stockResolution:
      asTrimmed(raw.stockResolution) === 'discount_full_order' ||
      asTrimmed(raw.stockResolution) === 'discount_reserved' ||
      asTrimmed(raw.stockResolution) === 'cancel'
        ? (asTrimmed(raw.stockResolution) as TurnInterpretation['stockResolution'])
        : undefined,
    targetReference: parseTargetReference(raw.targetReference),
    missingFields: missing.length ? missing : undefined,
    ambiguities: ambiguities.length ? ambiguities : undefined,
    requiresClarification: raw.requiresClarification === true,
    clarificationReason: asTrimmed(raw.clarificationReason) || undefined,
    choiceIndex: Number(raw.choiceIndex) >= 1 ? Number(raw.choiceIndex) : undefined,
    choiceIndexes: choiceIndexes?.length ? choiceIndexes : undefined,
    requestedCapability: mappedIntent.requestedCapability || undefined,
    capabilityUnwired: mappedIntent.unwired || undefined,
  };

  if (raw.client && typeof raw.client === 'object' && !Array.isArray(raw.client)) {
    const client = raw.client as Record<string, unknown>;
    interpretation.client = {
      raw: asTrimmed(client.raw) || undefined,
      name: asTrimmed(client.name) || undefined,
      phone: asTrimmed(client.phone) || undefined,
    };
  }
  const filterClientHint = asTrimmed(filtersRaw.clientHint || filtersRaw.client);
  if (filterClientHint && !interpretation.client?.raw && !interpretation.client?.name) {
    interpretation.client = { ...(interpretation.client ?? {}), raw: filterClientHint };
  }
  if (items.length) interpretation.items = items;
  if (Object.keys(paymentRaw).length) {
    interpretation.payment = {
      full: paymentRaw.full === true || paymentRaw.fullBalance === true,
      fullBalance: paymentRaw.fullBalance === true || paymentRaw.full === true,
      amount: asPositiveMoney(paymentRaw.amount),
      kind:
        asTrimmed(paymentRaw.kind) === 'senia' ||
        asTrimmed(paymentRaw.kind) === 'deposit' ||
        asTrimmed(paymentRaw.kind) === 'seña'
          ? 'senia'
          : asTrimmed(paymentRaw.kind) === 'pago' || asTrimmed(paymentRaw.kind) === 'partial'
            ? 'pago'
            : asTrimmed(paymentRaw.kind) === 'related'
              ? 'related'
              : undefined,
      method: asTrimmed(paymentRaw.method) || undefined,
    };
  }
  if (asTrimmed(datesRaw.delivery) || asTrimmed(datesRaw.order)) {
    interpretation.dates = {
      delivery: asTrimmed(datesRaw.delivery) || undefined,
      order: asTrimmed(datesRaw.order) || undefined,
    };
  }
  const filterStatus = asStatus(filtersRaw.status);
  const dateFrom = asTrimmed(filtersRaw.dateFrom) || undefined;
  const dateTo = asTrimmed(filtersRaw.dateTo) || undefined;
  const dateToken = asTrimmed(filtersRaw.dateToken || filtersRaw.period) || undefined;
  const dateFieldRaw = asTrimmed(filtersRaw.dateField);
  const dateField =
    dateFieldRaw === 'fechaEntrega' || dateFieldRaw === 'delivery'
      ? 'fechaEntrega'
      : dateFieldRaw === 'createdAt'
        ? 'createdAt'
        : undefined;
  if (
    filtersRaw.listOrders === true ||
    listedAlias ||
    filtersRaw.includeDelivered === true ||
    asTrimmed(filtersRaw.statusNot) ||
    filterStatus ||
    dateFrom ||
    dateTo ||
    dateToken ||
    dateField ||
    asTrimmed(filtersRaw.clientHint || filtersRaw.client)
  ) {
    interpretation.filters = {
      listOrders: filtersRaw.listOrders === true || listedAlias,
      includeDelivered: filtersRaw.includeDelivered === true,
      statusNot: asTrimmed(filtersRaw.statusNot) || undefined,
      status: filterStatus,
      dateFrom,
      dateTo,
      dateToken,
      dateField,
      clientHint: asTrimmed(filtersRaw.clientHint || filtersRaw.client) || undefined,
    };
  }
  if (raw.cash && typeof raw.cash === 'object' && !Array.isArray(raw.cash)) {
    const parsedCash = parseGeminiCash(raw.cash);
    if (parsedCash) interpretation.cash = parsedCash;
  }
  const extraOps = Array.isArray(raw.operations) ? raw.operations : [];
  const parsedOps = extraOps
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const item = row as Record<string, unknown>;
      const intent = asIntent(item.intent || item.type);
      if (intent === 'unknown' && !asTrimmed(item.intent || item.type)) return null;
      return {
        intent,
        type: asTrimmed(item.type) || undefined,
        requestedStatus: asStatus(item.requestedStatus),
        orderStatus: asStatus(item.orderStatus),
        notes: asTrimmed(item.notes) || undefined,
        amount: asPositiveMoney(item.amount),
        cash: parseGeminiCash(item.cash),
        payment:
          item.payment && typeof item.payment === 'object'
            ? {
                full:
                  (item.payment as Record<string, unknown>).full === true ||
                  (item.payment as Record<string, unknown>).fullBalance === true,
                fullBalance:
                  (item.payment as Record<string, unknown>).fullBalance === true ||
                  (item.payment as Record<string, unknown>).full === true,
                amount: asPositiveMoney((item.payment as Record<string, unknown>).amount),
                kind:
                  asTrimmed((item.payment as Record<string, unknown>).kind) === 'senia' ||
                  asTrimmed((item.payment as Record<string, unknown>).kind) === 'pago'
                    ? (asTrimmed((item.payment as Record<string, unknown>).kind) as 'senia' | 'pago')
                    : undefined,
                method: asTrimmed((item.payment as Record<string, unknown>).method) || undefined,
              }
            : undefined,
        dates:
          item.dates && typeof item.dates === 'object'
            ? {
                delivery: asTrimmed((item.dates as Record<string, unknown>).delivery) || undefined,
                order: asTrimmed((item.dates as Record<string, unknown>).order) || undefined,
              }
            : undefined,
      } satisfies ExtraTurnOperation;
    })
    .filter((row): row is ExtraTurnOperation => Boolean(row));
  if (parsedOps.length) interpretation.operations = parsedOps;
  const extraCosts = extraRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const costo = asNumber(item.costo);
      const nombre = asTrimmed(item.nombre) || 'Costo extra';
      if (costo == null) return null;
      return { nombre, costo };
    })
    .filter((row): row is { nombre: string; costo: number } => Boolean(row));
  if (extraCosts.length) interpretation.extraCosts = extraCosts;
  if (raw.query && typeof raw.query === 'object' && !Array.isArray(raw.query)) {
    const queryRaw = raw.query as Record<string, unknown>;
    const aggregationRaw = asTrimmed(queryRaw.aggregation || queryRaw.metric).toLowerCase();
    let metric = asQueryMetric(queryRaw.metric) || (listedAlias ? 'list' : undefined);
    if (aggregationRaw === 'count') metric = 'count';
    if (aggregationRaw === 'sum' || aggregationRaw === 'total') metric = 'sum';
    if (aggregationRaw === 'list') metric = metric || 'list';
    const entity =
      asQueryEntity(queryRaw.entity) ||
      (listedAlias
        ? mappedIntent.requestedCapability === 'query_sales'
          ? 'sales'
          : 'orders'
        : undefined);
    const expectedValue = asNumber(queryRaw.expectedValue);
    const limit = asNumber(queryRaw.limit);
    const requestAll = queryRaw.requestAll === true;
    const pageRaw = asTrimmed(queryRaw.page).toLowerCase();
    const page = pageRaw === 'next' || pageRaw === 'first' ? (pageRaw as 'next' | 'first') : undefined;
    const sortRaw = asTrimmed(queryRaw.sortDirection || queryRaw.sort).toLowerCase();
    const sortDirection = sortRaw === 'asc' || sortRaw === 'desc' ? (sortRaw as 'asc' | 'desc') : undefined;
    if (metric || entity || expectedValue != null || limit != null || requestAll || page || sortDirection) {
      interpretation.query = {
        ...(entity ? { entity } : {}),
        ...(metric ? { metric } : {}),
        ...(aggregationRaw === 'count' || aggregationRaw === 'sum' || aggregationRaw === 'list'
          ? { aggregation: aggregationRaw as 'count' | 'sum' | 'list' }
          : {}),
        ...(expectedValue != null ? { expectedValue } : {}),
        ...(limit != null && limit > 0 ? { limit } : {}),
        ...(requestAll ? { requestAll: true } : {}),
        ...(page ? { page } : {}),
        ...(sortDirection ? { sortDirection } : {}),
      };
    }
    const nestedFilters =
      queryRaw.filters && typeof queryRaw.filters === 'object' && !Array.isArray(queryRaw.filters)
        ? (queryRaw.filters as Record<string, unknown>)
        : {};
    const nestedClient = asTrimmed(nestedFilters.clientHint || nestedFilters.client);
    if (nestedClient && !interpretation.client?.raw && !interpretation.client?.name) {
      interpretation.client = { ...(interpretation.client ?? {}), raw: nestedClient };
    }
  } else if (listedAlias) {
    interpretation.query = { entity: 'orders', metric: 'list' };
  }
  if (raw.product && typeof raw.product === 'object' && !Array.isArray(raw.product)) {
    const productRaw = raw.product as Record<string, unknown>;
    const attrsRaw =
      productRaw.attributes && typeof productRaw.attributes === 'object'
        ? (productRaw.attributes as Record<string, unknown>)
        : {};
    interpretation.product = {
      raw: asTrimmed(productRaw.raw) || undefined,
      attributes: {
        type: asTrimmed(attrsRaw.type) || null,
        fabric: asTrimmed(attrsRaw.fabric) || null,
        model: asTrimmed(attrsRaw.model) || null,
        color: asTrimmed(attrsRaw.color) || null,
        size: asTrimmed(attrsRaw.size) || null,
        variant: asTrimmed(attrsRaw.variant) || null,
      },
    };
  }
  liftExplicitClient(interpretation);
  return interpretation;
}

export function explicitClientFromInterpretation(interpretation: TurnInterpretation): string {
  const fromClient = String(interpretation.client?.raw || interpretation.client?.name || '').trim();
  if (fromClient) return fromClient;
  const ref = interpretation.targetReference;
  if (typeof ref === 'object' && ref?.clientHint) return String(ref.clientHint).trim();
  return String(interpretation.filters?.clientHint || '').trim();
}

function liftExplicitClient(interpretation: TurnInterpretation): void {
  const hint = explicitClientFromInterpretation(interpretation);
  if (!hint) return;
  if (!interpretation.client?.raw && !interpretation.client?.name) {
    interpretation.client = { ...(interpretation.client ?? {}), raw: hint };
  }
}

function isCollectionQuery(interpretation: TurnInterpretation): boolean {
  return (
    interpretation.filters?.listOrders === true ||
    isListQueryMetric(interpretation.query?.metric) ||
    interpretation.query?.entity === 'orders' ||
    interpretation.query?.entity === 'sales' ||
    interpretation.query?.entity === 'purchases' ||
    interpretation.query?.entity === 'cash'
  );
}

function shouldBindFocusOrder(intent: WhatsappIntent): boolean {
  return (
    intent === 'update_order_status' ||
    intent === 'query_status' ||
    intent === 'register_payment' ||
    intent === 'query_balance' ||
    intent === 'register_cost'
  );
}

function bindFocusedProduct(
  entities: WhatsappCommandEntities,
  conversation?: WhatsappParseConversation,
  incoming?: LineItemIntent
): void {
  const focused = focusedProductFromState(conversation?.focusEntities);
  entities.referToFocusedProduct = true;
  const incomingAttrs = incoming?.attributes;
  const changed = attributesChanged(focused?.attributes, incomingAttrs);
  if (changed) {
    const typeHint =
      String(incomingAttrs?.type ?? focused?.attributes?.type ?? '').trim() ||
      String(focused?.name ?? '').trim();
    entities.productId = undefined;
    entities.productName = undefined;
    entities.items = [
      {
        quantity: incoming?.quantity || 1,
        rawText: incoming?.rawText || [typeHint, incomingAttrs?.color, incomingAttrs?.size].filter(Boolean).join(' '),
        productHint: incoming?.productHint || typeHint,
        attributes: { ...focused?.attributes, ...incomingAttrs },
        itemKey: incoming?.itemKey || 'item:1',
      },
    ];
    return;
  }
  if (focused?.id) entities.productId = entities.productId || focused.id;
  if (focused?.name) {
    entities.productName = entities.productName || focused.name;
    if (!entities.items?.length) {
      entities.items = [
        {
          quantity: 1,
          rawText: focused.name,
          productHint: focused.name,
          productId: focused.id,
          productName: focused.name,
          attributes: focused.attributes,
          itemKey: 'item:1',
        },
      ];
    }
  }
}

function applyTargetReference(
  entities: WhatsappCommandEntities,
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation
): void {
  const focus = conversation?.focusOrder;
  const last = conversation?.lastOperation;
  const kind = targetReferenceKind(interpretation.targetReference);
  const ref = interpretation.targetReference;
  const bind = shouldBindFocusOrder(interpretation.intent);
  const collection = isCollectionQuery(interpretation);
  const explicitClient =
    String(entities.clientName || entities.spokenClientName || '').trim() ||
    (typeof ref === 'object' && ref?.clientHint ? String(ref.clientHint).trim() : '');

  const lockFocus = () => {
    const locked = lockedOrderFromFocus(focus);
    if (!locked) return;
    entities.targetOrderId = locked.id;
    entities.targetOrderLabel = locked.label;
    if (!entities.clientName && locked.clientName) {
      entities.clientName = locked.clientName;
      entities.spokenClientName = entities.spokenClientName || locked.clientName;
    }
  };

  if (kind === 'focused_product' || kind === 'explicit_product') {
    if (typeof ref === 'object' && ref) {
      if (ref.productId) entities.productId = ref.productId;
      if (ref.productHint && !entities.productName) entities.productName = ref.productHint;
    }
    if (kind === 'focused_product' || interpretation.intent === 'query_stock') {
      bindFocusedProduct(entities, conversation, interpretation.items?.[0]);
    }
    return;
  }

  if (collection) {
    if (typeof ref === 'object' && ref?.clientHint && !entities.clientName) {
      entities.clientName = ref.clientHint;
      entities.spokenClientName = entities.spokenClientName || ref.clientHint;
    }
    return;
  }

  if (kind === 'focused_order' || (typeof ref === 'object' && ref?.orderId && ref.orderId === focus?.id)) {
    lockFocus();
    return;
  }
  if (kind === 'focused_client' && focus?.clientName) {
    entities.clientName = entities.clientName || focus.clientName;
    return;
  }
  if (kind === 'last_completed' && last?.id && last.kind === 'order') {
    entities.targetOrderId = last.id;
    entities.targetOrderLabel = last.label;
    if (last.clientName) entities.clientName = entities.clientName || last.clientName;
    return;
  }
  if (typeof ref === 'object' && ref) {
    if (ref.orderId) entities.targetOrderId = ref.orderId;
    if (ref.orderNumber) entities.orderNumber = ref.orderNumber;
    if (ref.productId) entities.productId = ref.productId;
    if (ref.productHint) entities.productName = entities.productName || ref.productHint;
    if (ref.clientHint) {
      entities.clientName = entities.clientName || ref.clientHint;
      entities.spokenClientName = entities.spokenClientName || ref.clientHint;
      if (bind && focus?.id && personNamesLookRelated(ref.clientHint, focus.clientName || '')) {
        lockFocus();
      }
    }
    return;
  }
  if (interpretation.intent === 'query_stock') {
    return;
  }
  if (explicitClient && focus?.clientName && !personNamesLookRelated(explicitClient, focus.clientName)) {
    return;
  }
  if (bind && focus?.id && interpretation.conversationAction !== 'cancel_current') {
    const hint = entities.clientName || entities.spokenClientName;
    if (!hint || personNamesLookRelated(hint, focus.clientName || '')) {
      lockFocus();
    }
  }
}

/**
 * TurnInterpretation → comando del ERP.
 * No lee rawMessage para reconstruir producto, notas, cliente ni pago.
 */
export function turnInterpretationToParsed(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation
): ParsedWhatsappCommand {
  const clientRaw = interpretation.client?.raw || interpretation.client?.name;
  const entities: WhatsappCommandEntities = {
    rawUserMessage: interpretation.rawMessage,
    sourceText: interpretation.rawMessage,
    conversationAction: interpretation.conversationAction,
  };
  if (clientRaw) {
    entities.clientName = clientRaw;
    entities.spokenClientName = interpretation.client?.raw || clientRaw;
  }
  if (interpretation.client?.phone) entities.clientPhone = interpretation.client.phone;
  if (interpretation.items?.length) {
    entities.items = interpretation.items;
  }
  if (interpretation.notes) entities.notes = interpretation.notes;
  if (interpretation.amount != null && interpretation.amount > 0) entities.amount = interpretation.amount;
  if (interpretation.intent !== 'register_cash' && interpretation.payment?.amount != null) {
    entities.amount = entities.amount ?? interpretation.payment.amount;
    entities.collectionAmount = interpretation.payment.amount;
  }
  if (interpretation.intent !== 'register_cash' && interpretation.payment?.full) {
    entities.paid = true;
    entities.payFullBalance = true;
  } else if (interpretation.intent !== 'register_cash' && interpretation.payment?.amount != null) {
    entities.paid = true;
  }
  if (interpretation.payment?.kind === 'senia') {
    entities.paymentKind = 'senia';
    entities.seniaAmount = interpretation.payment.amount;
  } else if (interpretation.payment?.kind === 'pago') {
    entities.paymentKind = 'pago';
  }
  if (interpretation.requestedStatus) entities.requestedStatus = interpretation.requestedStatus;
  if (interpretation.orderStatus) entities.orderStatus = interpretation.orderStatus;
  if (interpretation.intent === 'update_order_status' && !entities.orderStatus && interpretation.requestedStatus) {
    entities.orderStatus = interpretation.requestedStatus;
  }
  if (interpretation.dates?.delivery) entities.deliveryDate = interpretation.dates.delivery;
  if (interpretation.dates?.order) entities.orderDate = interpretation.dates.order;
  if (
    interpretation.filters?.listOrders ||
    interpretation.query?.metric === 'list' ||
    interpretation.query?.metric === 'count' ||
    interpretation.query?.entity === 'orders' ||
    interpretation.query?.entity === 'sales'
  ) {
    entities.listOrders = true;
  }
  if (interpretation.requestedCapability) entities.requestedCapability = interpretation.requestedCapability;
  if (interpretation.capabilityUnwired) entities.capabilityUnwired = true;
  if (interpretation.filters?.status) entities.queryStatusFilter = interpretation.filters.status;
  if (interpretation.filters?.dateFrom) entities.queryDateFrom = interpretation.filters.dateFrom;
  if (interpretation.filters?.dateTo) entities.queryDateTo = interpretation.filters.dateTo;
  if (interpretation.filters?.dateToken) entities.queryDateToken = interpretation.filters.dateToken;
  if (interpretation.filters?.dateField) entities.queryDateField = interpretation.filters.dateField;
  if (interpretation.query?.entity) entities.queryEntity = interpretation.query.entity;
  if (interpretation.query?.limit != null) entities.queryLimit = interpretation.query.limit;
  if (interpretation.query?.requestAll) entities.queryRequestAll = true;
  if (interpretation.query?.page) entities.queryPage = interpretation.query.page;
  if (interpretation.query?.sortDirection) entities.querySortDir = interpretation.query.sortDirection;
  if (interpretation.stockResolution) entities.stockResolution = interpretation.stockResolution;
  if (interpretation.helpTopic) entities.helpTopic = interpretation.helpTopic;
  if (interpretation.expectedItemCount) entities.expectedItemCount = interpretation.expectedItemCount;
  if (interpretation.orderNumber) entities.orderNumber = interpretation.orderNumber;
  if (interpretation.supplierName) entities.supplierName = interpretation.supplierName;
  if (interpretation.invoiceNumber) entities.invoiceNumber = interpretation.invoiceNumber;
  if (interpretation.cash?.type) entities.cashType = interpretation.cash.type;
  if (interpretation.cash?.concept) entities.cashConcept = interpretation.cash.concept;
  if (interpretation.cash?.ambitoHint) entities.cashAmbitoHint = interpretation.cash.ambitoHint;
  if (interpretation.cash?.amount != null && interpretation.cash.amount > 0) {
    entities.amount = interpretation.cash.amount;
  }
  if (interpretation.cash?.date) entities.orderDate = interpretation.cash.date;
  if (interpretation.extraCosts?.length) {
    entities.extraCosts = interpretation.extraCosts.map((row) => ({
      nombre: String(row.nombre || 'Costo extra'),
      costo: Number(row.costo) || 0,
    }));
  }
  if (interpretation.query?.metric) entities.queryMetric = interpretation.query.metric;
  if (interpretation.query?.expectedValue != null) {
    entities.queryExpectedValue = interpretation.query.expectedValue;
  } else if (interpretation.intent === 'query_stock' && interpretation.query?.metric === 'verify' && interpretation.amount != null) {
    entities.queryExpectedValue = interpretation.amount;
  }
  if (!entities.items?.length && interpretation.product?.raw) {
    entities.items = [
      {
        quantity: 1,
        rawText: interpretation.product.raw,
        productHint: interpretation.product.raw,
        attributes: interpretation.product.attributes,
        itemKey: 'item:1',
      },
    ];
  }

  applyTargetReference(entities, interpretation, conversation);

  if (interpretation.intent === 'help' || interpretation.intent === 'greeting') {
    return {
      intent: interpretation.intent,
      confidence: interpretation.confidence,
      conversationAction: interpretation.conversationAction,
      choiceIndex: interpretation.choiceIndex,
      choiceIndexes: interpretation.choiceIndexes,
    };
  }

  return {
    intent: interpretation.intent,
    confidence: interpretation.confidence,
    entities,
    raw: interpretation.rawMessage,
    conversationAction: interpretation.conversationAction,
    choiceIndex: interpretation.choiceIndex,
    choiceIndexes: interpretation.choiceIndexes,
  };
}

export function overlayKnownEntities(
  known: WhatsappCommandEntities | undefined,
  incoming: WhatsappCommandEntities,
  action: ConversationAction
): WhatsappCommandEntities {
  if (!known || action === 'new_task' || action === 'cancel_current') return incoming;
  const next: WhatsappCommandEntities = { ...known };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'items' && Array.isArray(value) && value.length) {
      next.items =
        action === 'correct_current'
          ? mergeCorrectionItems(known.items, value as LineItemIntent[])
          : mergeItemsByKey(known.items, value as LineItemIntent[]);
      continue;
    }
    (next as Record<string, unknown>)[key] = value;
  }
  next.rawUserMessage = incoming.rawUserMessage || known.rawUserMessage;
  next.sourceText = incoming.rawUserMessage || known.sourceText;
  next.clientName = preferTurn(incoming.clientName, known.clientName) as string | undefined;
  next.spokenClientName = preferTurn(incoming.spokenClientName, known.spokenClientName) as string | undefined;
  next.clientId = preferTurn(incoming.clientId, known.clientId) as string | undefined;
  next.productId = preferTurn(incoming.productId, known.productId) as string | undefined;
  next.productName = preferTurn(incoming.productName, known.productName) as string | undefined;
  next.supplierName = preferTurn(incoming.supplierName, known.supplierName) as string | undefined;
  next.supplierId = preferTurn(incoming.supplierId, known.supplierId) as string | undefined;
  next.orderStatus = preferTurn(incoming.orderStatus, known.orderStatus) as typeof next.orderStatus;
  next.amount = preferTurn(incoming.amount, known.amount) as number | undefined;
  next.cashAmbitoHint = preferTurn(incoming.cashAmbitoHint, known.cashAmbitoHint) as string | undefined;
  if (
    isFreshListQuery({
      listOrders: incoming.listOrders,
      entity: incoming.queryEntity,
      metric: incoming.queryMetric,
      status: incoming.queryStatusFilter,
      dateFrom: incoming.queryDateFrom,
      dateTo: incoming.queryDateTo,
      dateToken: incoming.queryDateToken,
      page: incoming.queryPage,
      requestAll: incoming.queryRequestAll,
    })
  ) {
    if (incoming.clientName) {
      next.clientName = incoming.clientName;
      next.spokenClientName = incoming.spokenClientName || incoming.clientName;
      next.clientId = incoming.clientId;
      next.targetOrderId = incoming.targetOrderId;
      next.targetOrderLabel = incoming.targetOrderLabel;
    } else {
      next.clientName = undefined;
      next.spokenClientName = undefined;
      next.clientId = undefined;
      next.targetOrderId = undefined;
      next.targetOrderLabel = undefined;
    }
  }
  return next;
}

function mergeCorrectionItems(
  previous: LineItemIntent[] | undefined,
  incoming: LineItemIntent[]
): LineItemIntent[] {
  const merged = mergeItemsByKey(previous, incoming);
  if (previous?.length && incoming.length === previous.length) {
    return previous.map((item, index) => {
      const next = incoming[index];
      if (!next) return item;
      return {
        ...item,
        ...next,
        itemKey: item.itemKey || next.itemKey || `item:${index + 1}`,
        attributes: { ...item.attributes, ...next.attributes },
      };
    });
  }
  return merged;
}

function mergeItemsByKey(
  previous: LineItemIntent[] | undefined,
  incoming: LineItemIntent[]
): LineItemIntent[] {
  if (!previous?.length) return incoming;
  const byKey = new Map(previous.map((item, index) => [item.itemKey || `item:${index + 1}`, { ...item }]));
  for (const item of incoming) {
    const key = item.itemKey || '';
    if (key && byKey.has(key)) {
      byKey.set(key, { ...byKey.get(key)!, ...item, itemKey: key });
    } else if (incoming.length === 1 && previous.length === 1) {
      const only = previous[0]!;
      return [{ ...only, ...item, itemKey: only.itemKey || item.itemKey || 'item:1' }];
    } else {
      byKey.set(item.itemKey || `item:${byKey.size + 1}`, item);
    }
  }
  return [...byKey.values()];
}

export function isValidTurnInterpretationJson(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  if (row.intent != null && typeof row.intent !== 'string') return false;
  if (row.items != null && !Array.isArray(row.items)) return false;
  return true;
}
