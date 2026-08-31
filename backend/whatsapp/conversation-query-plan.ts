import type { QueryEntity, QueryMetric, OrderStatusValue, TurnInterpretation } from './turn-interpretation.ts';
import { explicitClientFromInterpretation } from './turn-interpretation.ts';
import type { WhatsappParseConversation } from './ai-command-parser.ts';
import { preferTurn, isQueryRefinement, isFreshListQuery } from './turn-priority.ts';
import { personNamesLookRelated } from './lookups.ts';
import { DEFAULT_LIST_LIMIT, resolveListPolicy, wantsEntityList } from './query-policy.ts';

export type QueryFilters = {
  clientId?: string;
  clientHint?: string;
  productId?: string;
  productHint?: string;
  supplierId?: string;
  supplierHint?: string;
  orderId?: string;
  orderNumber?: string;
  status?: OrderStatusValue | string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'createdAt' | 'fechaEntrega';
  scope?: string;
};

export type RequestedQueryFilters = {
  client?: boolean;
  product?: boolean;
  supplier?: boolean;
  order?: boolean;
  status?: boolean;
  date?: boolean;
  scope?: boolean;
};

export type QueryPlan = {
  entity: QueryEntity | 'orders';
  metric: QueryMetric | 'list' | 'count' | 'details' | 'status' | 'balance';
  filters: QueryFilters;
  requestedFilters: RequestedQueryFilters;
  limit: number;
  offset: number;
  sort: { field: 'createdAt' | 'fechaEntrega'; direction: 'asc' | 'desc' };
  aggregation?: 'list' | 'count' | 'sum';
  invalid?: 'ENTITY_NOT_FOUND' | 'AMBIGUOUS_ENTITY' | 'QUERY_PLAN_INVALID';
  invalidHint?: string;
  ambiguousNames?: string[];
};

export type OrderQueryServiceInput = {
  businessId: string;
  filters: { clientId?: string; status?: string; dateFrom?: string; dateTo?: string };
  limit: number;
  offset: number;
  sort: { field: 'createdAt' | 'fechaEntrega'; direction: 'asc' | 'desc' };
};

export function explicitClientHint(interpretation: TurnInterpretation): string {
  return explicitClientFromInterpretation(interpretation);
}

export function isOrderListInterpretation(interpretation: TurnInterpretation): boolean {
  return wantsEntityList({
    listOrders: interpretation.filters?.listOrders,
    entity: interpretation.query?.entity,
    metric: interpretation.query?.metric,
    orderNumber: interpretation.orderNumber,
  });
}

export function inheritedClientHint(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation | null
): string {
  if (explicitClientHint(interpretation)) return '';
  const last = String(conversation?.lastQuery?.slots?.clientName ?? '').trim();
  const focus = String(conversation?.focusOrder?.clientName ?? '').trim();
  const refining = isQueryRefinement({
    status: interpretation.filters?.status,
    dateFrom: interpretation.filters?.dateFrom,
    dateTo: interpretation.filters?.dateTo,
    dateToken: interpretation.filters?.dateToken,
    page: interpretation.query?.page,
    requestAll: interpretation.query?.requestAll,
    limit: interpretation.query?.limit,
  });
  const followUp =
    interpretation.conversationAction === 'answer_current' ||
    interpretation.query?.page === 'next' ||
    refining;
  if (followUp) return last || focus;
  const fresh = isFreshListQuery({
    listOrders: interpretation.filters?.listOrders,
    entity: interpretation.query?.entity,
    metric: interpretation.query?.metric,
    status: interpretation.filters?.status,
    dateFrom: interpretation.filters?.dateFrom,
    dateTo: interpretation.filters?.dateTo,
    dateToken: interpretation.filters?.dateToken,
    page: interpretation.query?.page,
    requestAll: interpretation.query?.requestAll,
  });
  if (fresh) return '';
  return last || focus;
}

export function effectiveClientHint(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation | null
): string {
  const explicit = explicitClientHint(interpretation);
  const inherited = inheritedClientHint(interpretation, conversation);
  const focus = String(conversation?.focusOrder?.clientName ?? '').trim();
  if (explicit && focus && !personNamesLookRelated(explicit, focus)) return explicit;
  return String(preferTurn(explicit, inherited) ?? '').trim();
}

export function explicitOverFocus(explicitHint: string, focusedHint: string): string {
  return String(preferTurn(String(explicitHint ?? '').trim(), String(focusedHint ?? '').trim()) ?? '').trim();
}

export function writeTargetFromTurn(input: {
  explicitHint: string;
  focusedId?: string;
  resolvedId?: string;
  resolution: 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NONE';
}): { id?: string; blocked?: 'ENTITY_NOT_FOUND' | 'AMBIGUOUS_ENTITY' } {
  const explicit = String(input.explicitHint ?? '').trim();
  if (explicit) {
    if (input.resolution === 'RESOLVED') return { id: input.resolvedId };
    if (input.resolution === 'AMBIGUOUS') return { blocked: 'AMBIGUOUS_ENTITY' };
    if (input.resolution === 'NOT_FOUND') return { blocked: 'ENTITY_NOT_FOUND' };
    return { blocked: 'ENTITY_NOT_FOUND' };
  }
  return { id: input.focusedId };
}

export function buildRequestedFilters(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation | null
): RequestedQueryFilters {
  const explicitClient = Boolean(explicitClientHint(interpretation));
  const inherited = Boolean(inheritedClientHint(interpretation, conversation));
  const orderList = isOrderListInterpretation(interpretation);
  return {
    client: explicitClient || inherited || orderList,
    product: Boolean(interpretation.product?.raw),
    supplier: Boolean(interpretation.supplierName),
    order: Boolean(
      interpretation.orderNumber ||
        (typeof interpretation.targetReference === 'object' && interpretation.targetReference?.orderId)
    ),
    status: Boolean(interpretation.filters?.status),
    date: Boolean(
      interpretation.filters?.dateFrom || interpretation.filters?.dateTo || interpretation.filters?.dateToken
    ),
    scope: Boolean(interpretation.cash?.ambitoHint || interpretation.cash?.scope),
  };
}

export function buildQueryPlanDraft(
  interpretation: TurnInterpretation,
  conversation?: WhatsappParseConversation | null
): QueryPlan {
  const entity = (interpretation.query?.entity || 'orders') as QueryPlan['entity'];
  const metric = (interpretation.query?.metric || 'list') as QueryPlan['metric'];
  const policy = resolveListPolicy({
    entity,
    metric,
    limit: interpretation.query?.limit,
    requestAll: interpretation.query?.requestAll,
    page: interpretation.query?.page,
    sortDirection: interpretation.query?.sortDirection,
  });
  const clientHint = effectiveClientHint(interpretation, conversation);
  return {
    entity,
    metric,
    filters: {
      clientHint: clientHint || undefined,
      productHint: interpretation.product?.raw,
      supplierHint: interpretation.supplierName,
      orderNumber: interpretation.orderNumber,
      status: interpretation.filters?.status,
      dateFrom: interpretation.filters?.dateFrom,
      dateTo: interpretation.filters?.dateTo,
      dateField: interpretation.filters?.dateField,
    },
    requestedFilters: buildRequestedFilters(interpretation, conversation),
    limit: policy.limit || DEFAULT_LIST_LIMIT,
    offset: policy.offset,
    sort: {
      field: interpretation.filters?.dateField === 'fechaEntrega' ? 'fechaEntrega' : 'createdAt',
      direction: policy.sortDirection,
    },
    aggregation: metric === 'count' ? 'count' : metric === 'sum' ? 'sum' : 'list',
  };
}

export function assertQueryPlanExecutable(plan: QueryPlan): QueryPlan {
  if (plan.requestedFilters.client && !plan.filters.clientId && !plan.invalid) {
    return {
      ...plan,
      invalid: 'QUERY_PLAN_INVALID',
      invalidHint: plan.filters.clientHint || '',
    };
  }
  if (plan.requestedFilters.product && !plan.filters.productId && plan.filters.productHint && !plan.invalid) {
    return { ...plan, invalid: 'QUERY_PLAN_INVALID', invalidHint: plan.filters.productHint };
  }
  if (plan.requestedFilters.supplier && !plan.filters.supplierId && plan.filters.supplierHint && !plan.invalid) {
    return { ...plan, invalid: 'QUERY_PLAN_INVALID', invalidHint: plan.filters.supplierHint };
  }
  if (plan.requestedFilters.order && !plan.filters.orderId && plan.filters.orderNumber && !plan.invalid) {
    return { ...plan, invalid: 'QUERY_PLAN_INVALID', invalidHint: plan.filters.orderNumber };
  }
  return plan;
}

export function toQueryServiceInput(businessId: string, plan: QueryPlan): OrderQueryServiceInput {
  return {
    businessId,
    filters: {
      clientId: plan.filters.clientId,
      status: plan.filters.status ? String(plan.filters.status) : undefined,
      dateFrom: plan.filters.dateFrom,
      dateTo: plan.filters.dateTo,
    },
    limit: plan.limit,
    offset: plan.offset,
    sort: plan.sort,
  };
}

export function assertQueryResultScope<T extends { data: Record<string, unknown> }>(
  plan: QueryPlan,
  items: T[]
): { items: T[]; mismatch: boolean } {
  const clientId = String(plan.filters.clientId ?? '').trim();
  if (!clientId) return { items, mismatch: false };
  const leaked = items.filter((row) => String(row.data.clienteId ?? '') !== clientId);
  if (!leaked.length) return { items, mismatch: false };
  console.error(
    '[whatsapp:QUERY_RESULT_SCOPE_MISMATCH]',
    JSON.stringify({
      clientId,
      leaked: leaked.slice(0, 5).map((row) => ({
        id: (row as { id?: string }).id ?? null,
        clienteId: row.data.clienteId ?? null,
      })),
    })
  );
  return {
    items: items.filter((row) => String(row.data.clienteId ?? '') === clientId),
    mismatch: true,
  };
}
