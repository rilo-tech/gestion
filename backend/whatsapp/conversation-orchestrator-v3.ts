import type { TurnInterpretation } from './turn-interpretation.ts';
import type { WhatsappParseConversation } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  assertQueryPlanExecutable,
  assertQueryResultScope,
  buildQueryPlanDraft,
  isOrderListInterpretation,
  toQueryServiceInput,
  type QueryPlan,
} from './conversation-query-plan.ts';
import { applyClientResolution, type ClientResolverFn } from './conversation-v3-resolver.ts';
import { countOrdersForQuery, findOrdersPage, type OrderListPageQuery } from './erp-queries.ts';
import {
  presentCountQuery,
  presentEntityList,
  presentOrderListItem,
} from './conversation-query.ts';
import { presentListFooter, wantsEntityList } from './query-policy.ts';
import { formatDateOnlyEs } from './lookups.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { rememberLastQuery } from './conversation-state.ts';
import { compactWhatsappText } from '../../shared/whatsapp-format.ts';

export type V3QueryResult = {
  reply: string;
  intent: string;
  executed: boolean;
  businessId: string;
  plan: QueryPlan;
};

function toPageQuery(businessId: string, plan: QueryPlan): OrderListPageQuery {
  const input = toQueryServiceInput(businessId, plan);
  return {
    businessId,
    clientId: input.filters.clientId,
    status: input.filters.status,
    dateFrom: input.filters.dateFrom,
    dateTo: input.filters.dateTo,
    dateField: plan.filters.dateField === 'fechaEntrega' ? 'fechaEntrega' : 'createdAt',
    sortDir: input.sort.direction,
    limit: input.limit,
    offset: input.offset,
  };
}

export async function planV3Query(
  interpretation: TurnInterpretation,
  conversation: WhatsappParseConversation | null | undefined,
  businessId: string,
  resolve?: ClientResolverFn
): Promise<QueryPlan> {
  let plan = buildQueryPlanDraft(interpretation, conversation);
  plan = await applyClientResolution(businessId, plan, resolve);
  plan = assertQueryPlanExecutable(plan);
  console.info(
    '[whatsapp:v3:query-plan]',
    JSON.stringify({
      entity: plan.entity,
      metric: plan.metric,
      requestedFilters: plan.requestedFilters,
      filters: {
        clientHint: plan.filters.clientHint ?? null,
        clientId: plan.filters.clientId ?? null,
        status: plan.filters.status ?? null,
      },
      invalid: plan.invalid ?? null,
      limit: plan.limit,
    })
  );
  return plan;
}

export async function executeV3QueryTurn(input: {
  tenant: WhatsappTenantContext;
  interpretation: TurnInterpretation;
  conversation: WhatsappParseConversation | null | undefined;
  resolveClient?: ClientResolverFn;
}): Promise<V3QueryResult | null> {
  const intent = input.interpretation.intent;
  if (intent !== 'query_status') return null;
  if (!isOrderListInterpretation(input.interpretation)) return null;
  if (
    !wantsEntityList({
      listOrders: input.interpretation.filters?.listOrders,
      entity: input.interpretation.query?.entity,
      metric: input.interpretation.query?.metric,
      orderNumber: input.interpretation.orderNumber,
    })
  ) {
    return null;
  }

  const plan = await planV3Query(
    input.interpretation,
    input.conversation,
    input.tenant.businessId,
    input.resolveClient
  );
  if (plan.invalid === 'ENTITY_NOT_FOUND') {
    return {
      reply: compactWhatsappText(`No encontré un cliente llamado ${plan.invalidHint}.`),
      intent: 'query_status',
      executed: false,
      businessId: input.tenant.businessId,
      plan,
    };
  }
  if (plan.invalid === 'AMBIGUOUS_ENTITY') {
    const names = (plan.ambiguousNames ?? []).slice(0, 5).map((name) => `• ${name}`);
    return {
      reply: compactWhatsappText(
        `Encontré más de un cliente parecido a *${plan.invalidHint}*:\n${names.join('\n')}\nDecime el nombre completo.`
      ),
      intent: 'query_status',
      executed: false,
      businessId: input.tenant.businessId,
      plan,
    };
  }
  if (plan.invalid === 'QUERY_PLAN_INVALID' && plan.requestedFilters.client) {
    return {
      reply: compactWhatsappText('¿De qué cliente querés ver los pedidos?'),
      intent: 'query_status',
      executed: false,
      businessId: input.tenant.businessId,
      plan,
    };
  }

  const pageQuery = toPageQuery(input.tenant.businessId, plan);
  console.info('[whatsapp:v3:query-service]', JSON.stringify(pageQuery));

  if (plan.metric === 'count') {
    const total = (await countOrdersForQuery(pageQuery)) ?? 0;
    const reply = presentCountQuery({
      subject: plan.filters.clientHint || 'Ese cliente',
      total,
      filterHint: pageQuery.status ? `(${pageQuery.status})` : undefined,
    });
    return {
      reply: compactWhatsappText(reply),
      intent: 'query_status',
      executed: true,
      businessId: input.tenant.businessId,
      plan,
    };
  }

  const [page, counted] = await Promise.all([
    findOrdersPage(pageQuery),
    countOrdersForQuery(pageQuery),
  ]);
  const scoped = assertQueryResultScope(plan, page.items);
  page.items = scoped.items;

  const lines: string[] = [];
  for (const row of page.items) {
    const when = formatDateOnlyEs(String(row.data.fechaEntrega || row.data.createdAt || '').slice(0, 10));
    const label = resolveOrderLabel({
      numeroPedido: Number(row.data.numeroPedido) || undefined,
      numeroPedidoLabel: String(row.data.numeroPedidoLabel ?? ''),
    });
    lines.push(
      presentOrderListItem({
        label: label || row.id.slice(0, 6),
        date: when || undefined,
        statusLabel: String(row.data.estado ?? ''),
        total: Number(row.data.total) || 0,
      })
    );
  }
  const total = counted ?? page.items.length;
  const hasMore = counted != null ? plan.offset + lines.length < counted : page.hasMore;
  const title = plan.filters.clientHint
    ? `Últimos pedidos de ${plan.filters.clientHint}`
    : 'Últimos pedidos';
  const footer = presentListFooter({
    shown: plan.offset + lines.length,
    total,
    hasMore,
    requestAll: input.interpretation.query?.requestAll === true,
  });
  const reply = presentEntityList({
    title,
    lines,
    shown: lines.length,
    total,
    hasMore,
    emptyText: plan.filters.clientHint
      ? `No encontré pedidos de ${plan.filters.clientHint}.`
      : 'No encontré pedidos.',
    footer,
  });

  await rememberLastQuery(
    input.tenant.businessId,
    input.tenant.phone,
    {
      intent: 'query_status',
      slots: {
        clientName: plan.filters.clientHint,
        metric: String(plan.metric),
        entity: String(plan.entity),
        status: plan.filters.status ? String(plan.filters.status) : undefined,
        dateFrom: plan.filters.dateFrom,
        dateTo: plan.filters.dateTo,
        limit: plan.limit,
        offset: plan.offset,
      },
    },
    {
      type: 'orders',
      items: lines,
      currentPage: Math.floor(plan.offset / Math.max(1, plan.limit)) + 1,
      pageSize: plan.limit,
      totalResults: total,
      title,
      hasMore,
      offset: plan.offset,
      filters: {
        clientName: plan.filters.clientHint,
        status: plan.filters.status ? String(plan.filters.status) : undefined,
      },
    }
  );

  return {
    reply: compactWhatsappText(reply),
    intent: 'query_status',
    executed: true,
    businessId: input.tenant.businessId,
    plan,
  };
}
