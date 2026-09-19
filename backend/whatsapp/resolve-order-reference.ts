import { db } from '../firebase.ts';
import { loadOrderPedidosConfig } from '../routes/orders.ts';
import {
  normalizeOrderReference,
  orderRecordMatchesReference,
  orderReferenceLookupValues,
  type NormalizedOrderReference,
} from '../utils/order-number.ts';
import { findClient, type ClientEntityResult } from '../domain/client/index.ts';
import { findOrdersPage } from './erp-queries.ts';
import { normalizeOrderPedidosConfig } from '../utils/order-config.ts';
import {
  analyzePendingWrites,
  clientCandidateTitleForOperations,
  clientNotFoundMessage,
  filterEligibleOrderRecords,
  noEligibleClientsMessage,
  noEligibleOrdersMessage,
  resolveOrdersForOperation,
  type OrderOperationContext,
  type PendingWriteCall,
} from './v4-order-operation.ts';

const FALLBACK_PEDIDOS_CONFIG = normalizeOrderPedidosConfig({});

export type FindOrderHints = {
  orderId?: string;
  orderNumber?: string;
  query?: string;
  clientQuery?: string;
  clientId?: string;
  operationContext?: OrderOperationContext;
};

export type ClassifiedFindOrderHint =
  | { kind: 'order_reference'; ref: NormalizedOrderReference; raw: string }
  | { kind: 'document_id'; id: string }
  | { kind: 'client_id'; clientId: string }
  | { kind: 'client_query'; query: string }
  | { kind: 'empty' };

export type OrderLookupRecord = { id: string; data: Record<string, unknown> };

export type FindOrderDeps = {
  getById: (id: string) => Promise<OrderLookupRecord | null>;
  findByReference: (ref: NormalizedOrderReference) => Promise<OrderLookupRecord[]>;
  findClient: (query: string) => Promise<ClientEntityResult>;
  listByClientId: (clientId: string, limit: number) => Promise<OrderLookupRecord[]>;
  countEligibleOrdersForClient?: (
    clientId: string,
    ops: ReturnType<typeof analyzePendingWrites>
  ) => Promise<number>;
};

export type FindOrderLookupResult = {
  status: 'resolved' | 'not_found' | 'ambiguous' | 'filter_blocked';
  entity?: OrderLookupRecord;
  candidates?: OrderLookupRecord[] | ClientEntityResult['candidates'];
  entityType?: 'client' | 'order';
  errorCode?: string;
  message?: string;
  title?: string;
  filter?: Record<string, unknown>;
  classified: ClassifiedFindOrderHint;
  clientName?: string;
  clientId?: string;
  operationOutcome?: 'eligible' | 'already_complete' | 'partial_satisfied';
};

export function classifyFindOrderHint(input: FindOrderHints): ClassifiedFindOrderHint {
  const orderNumber = String(input.orderNumber ?? '').trim();
  const orderId = String(input.orderId ?? '').trim();
  const query = String(input.query ?? '').trim();
  const clientQuery = String(input.clientQuery ?? '').trim();
  const clientId = String(input.clientId ?? '').trim();

  const fromNumber = normalizeOrderReference(orderNumber);
  if (fromNumber) return { kind: 'order_reference', ref: fromNumber, raw: orderNumber };

  const fromId = normalizeOrderReference(orderId);
  if (fromId) return { kind: 'order_reference', ref: fromId, raw: orderId };

  if (orderId) return { kind: 'document_id', id: orderId };

  const fromQuery = normalizeOrderReference(query);
  if (fromQuery) return { kind: 'order_reference', ref: fromQuery, raw: query };

  if (clientId) return { kind: 'client_id', clientId };

  const client = clientQuery || query;
  if (client) return { kind: 'client_query', query: client };

  return { kind: 'empty' };
}

function pickFromOrders(
  rows: OrderLookupRecord[],
  extra?: {
    clientName?: string;
    clientId?: string;
    filter?: Record<string, unknown>;
    title?: string;
    operationOutcome?: FindOrderLookupResult['operationOutcome'];
    message?: string;
  }
): FindOrderLookupResult {
  if (rows.length === 1) {
    return {
      status: 'resolved',
      entity: rows[0],
      classified: { kind: 'empty' },
      clientName: extra?.clientName,
      clientId: extra?.clientId,
      filter: extra?.filter,
      operationOutcome: extra?.operationOutcome ?? 'eligible',
      message: extra?.message,
    };
  }
  if (rows.length > 1) {
    return {
      status: 'ambiguous',
      entityType: 'order',
      errorCode: 'ENTITY_AMBIGUOUS',
      candidates: rows.slice(0, 10),
      classified: { kind: 'empty' },
      clientName: extra?.clientName,
      clientId: extra?.clientId,
      filter: extra?.filter,
      title: extra?.title ?? (extra?.clientName ? `📋 Pedidos de ${extra.clientName}` : undefined),
      message: extra?.clientName
        ? `Encontré varios pedidos de ${extra.clientName}`
        : 'Encontré varios pedidos',
    };
  }
  return {
    status: 'not_found',
    classified: { kind: 'empty' },
    clientName: extra?.clientName,
    clientId: extra?.clientId,
    filter: extra?.filter,
    message: extra?.message,
  };
}

async function resolveClientOrdersForOperation(input: {
  clientId: string;
  clientName: string;
  clientQuery?: string;
  pendingWrites: PendingWriteCall[];
  deps: FindOrderDeps;
  pedidosConfig: Awaited<ReturnType<typeof loadOrderPedidosConfig>>;
  classified: ClassifiedFindOrderHint;
}): Promise<FindOrderLookupResult> {
  const ops = analyzePendingWrites(input.pendingWrites);
  const rows = await input.deps.listByClientId(input.clientId, 10);
  const resolution = resolveOrdersForOperation(rows, ops, input.pedidosConfig);

  if (resolution.kind === 'resolved') {
    return {
      status: 'resolved',
      entity: resolution.order,
      classified: input.classified,
      clientId: input.clientId,
      clientName: input.clientName,
      filter: {
        clientId: input.clientId,
        clientName: input.clientName,
        clientQuery: input.clientQuery,
      },
      operationOutcome: 'eligible',
    };
  }

  if (resolution.kind === 'ambiguous') {
    return pickFromOrders(resolution.candidates, {
      clientId: input.clientId,
      clientName: input.clientName,
      filter: {
        clientId: input.clientId,
        clientName: input.clientName,
        clientQuery: input.clientQuery,
      },
      title: `📋 Pedidos de ${input.clientName}`,
    });
  }

  if (resolution.kind === 'already_complete') {
    return {
      status: 'resolved',
      entity: resolution.order,
      classified: input.classified,
      clientId: input.clientId,
      clientName: input.clientName,
      filter: {
        clientId: input.clientId,
        clientName: input.clientName,
        clientQuery: input.clientQuery,
      },
      operationOutcome: 'already_complete',
    };
  }

  if (resolution.kind === 'partial_satisfied') {
    return {
      status: 'resolved',
      entity: resolution.order,
      classified: input.classified,
      clientId: input.clientId,
      clientName: input.clientName,
      filter: {
        clientId: input.clientId,
        clientName: input.clientName,
        clientQuery: input.clientQuery,
      },
      operationOutcome: 'partial_satisfied',
    };
  }

  return {
    status: 'not_found',
    classified: input.classified,
    errorCode: 'ENTITY_NOT_FOUND',
    clientId: input.clientId,
    clientName: input.clientName,
    filter: {
      clientId: input.clientId,
      clientName: input.clientName,
      clientQuery: input.clientQuery,
    },
    message: noEligibleOrdersMessage(input.clientName, ops, input.pedidosConfig),
  };
}

export async function resolveFindOrderHints(
  hints: FindOrderHints,
  deps: FindOrderDeps,
  pedidosConfig?: Awaited<ReturnType<typeof loadOrderPedidosConfig>>
): Promise<FindOrderLookupResult> {
  const classified = classifyFindOrderHint(hints);
  const pendingWrites = hints.operationContext?.pendingWrites ?? [];
  const effectiveConfig =
    pedidosConfig ?? (pendingWrites.length ? FALLBACK_PEDIDOS_CONFIG : undefined);

  if (classified.kind === 'document_id') {
    const row = await deps.getById(classified.id);
    if (!row) {
      return {
        status: 'not_found',
        classified,
        errorCode: 'ENTITY_NOT_FOUND',
      };
    }
    return { status: 'resolved', entity: row, classified };
  }

  if (classified.kind === 'order_reference') {
    const rows = await deps.findByReference(classified.ref);
    const picked = pickFromOrders(rows);
    return { ...picked, classified };
  }

  if (classified.kind === 'client_id' || classified.kind === 'client_query') {
    let clientId = classified.kind === 'client_id' ? classified.clientId : '';
    let clientName = '';
    const clientQuery = classified.kind === 'client_query' ? classified.query : '';
    const ops = analyzePendingWrites(pendingWrites);
    const hasOperationContext = pendingWrites.length > 0 && Boolean(effectiveConfig);

    if (classified.kind === 'client_query') {
      const resolved = await deps.findClient(classified.query);
      if (resolved.status === 'not_found') {
        return {
          status: 'filter_blocked',
          errorCode: 'ENTITY_NOT_FOUND',
          entityType: 'client',
          message: clientNotFoundMessage(),
          filter: { clientQuery: classified.query },
          classified,
        };
      }
      if (resolved.status === 'ambiguous') {
        let candidates = resolved.candidates ?? [];
        if (hasOperationContext && deps.countEligibleOrdersForClient) {
          const scored = await Promise.all(
            candidates.map(async (row) => ({
              row,
              eligible: await deps.countEligibleOrdersForClient!(row.id, ops),
            }))
          );
          const withOrders = scored.filter((entry) => entry.eligible > 0);
          console.info(
            '[v4:order-action:eligibility]',
            JSON.stringify({
              requestedActions: pendingWrites.map((row) => row.tool),
              clientCandidates: candidates.length,
              eligibleClientCandidates: withOrders.length,
            })
          );
          if (withOrders.length === 1) {
            clientId = withOrders[0]!.row.id;
            clientName = withOrders[0]!.row.name;
          } else if (withOrders.length > 1) {
            candidates = withOrders.map((entry) => entry.row);
          } else if (candidates.length === 1) {
            clientId = candidates[0]!.id;
            clientName = candidates[0]!.name;
          } else {
            return {
              status: 'filter_blocked',
              errorCode: 'ENTITY_NOT_FOUND',
              entityType: 'client',
              message: noEligibleClientsMessage(classified.query, ops, effectiveConfig!),
              filter: { clientQuery: classified.query },
              classified,
            };
          }
        }
        if (!clientId) {
          return {
            status: 'ambiguous',
            errorCode: 'ENTITY_AMBIGUOUS',
            entityType: 'client',
            candidates,
            title: hasOperationContext
              ? clientCandidateTitleForOperations(ops, effectiveConfig!)
              : undefined,
            message: hasOperationContext
              ? undefined
              : `Encontré más de un cliente parecido a ${classified.query}.`,
            filter: { clientQuery: classified.query },
            classified,
          };
        }
      } else {
        clientId = resolved.entity!.id;
        clientName = resolved.entity!.name;
      }
    }

    if (!clientId && classified.kind === 'client_id') {
      clientId = classified.clientId;
    } else if (!clientId) {
      return { status: 'not_found', classified, errorCode: 'ENTITY_NOT_FOUND' };
    }

    if (hasOperationContext) {
      return resolveClientOrdersForOperation({
        clientId,
        clientName,
        clientQuery: clientQuery || undefined,
        pendingWrites,
        deps,
        pedidosConfig: effectiveConfig!,
        classified,
      });
    }

    const rows = await deps.listByClientId(clientId, 10);
    const picked = pickFromOrders(rows, {
      clientId,
      clientName,
      filter: { clientId, clientName, clientQuery: clientQuery || undefined },
    });
    if (picked.status === 'not_found') {
      return {
        ...picked,
        classified,
        errorCode: 'ENTITY_NOT_FOUND',
        message: clientName ? `No hay pedidos para ${clientName}.` : 'No encontré ese pedido.',
      };
    }
    return { ...picked, classified };
  }

  return { status: 'not_found', classified, errorCode: 'ENTITY_NOT_FOUND' };
}

export async function firestoreGetOrderById(
  businessId: string,
  id: string
): Promise<OrderLookupRecord | null> {
  const snap = await db.doc(`negocios/${businessId}/pedidos/${id}`).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: (snap.data() ?? {}) as Record<string, unknown> };
}

export async function firestoreFindOrdersByReference(
  businessId: string,
  ref: NormalizedOrderReference
): Promise<OrderLookupRecord[]> {
  const col = db.collection(`negocios/${businessId}/pedidos`);
  const seen = new Map<string, OrderLookupRecord>();
  const fieldsQueried: string[] = [];
  for (const { field, value } of orderReferenceLookupValues(ref)) {
    fieldsQueried.push(`${field}==${String(value)}`);
    const snap = await col.where(field, '==', value).limit(5).get();
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      if (orderRecordMatchesReference(data, ref)) {
        seen.set(doc.id, { id: doc.id, data });
      }
    }
  }
  console.info(
    '[whatsapp:resolver:order]',
    JSON.stringify({
      raw: ref.raw,
      digits: ref.digits,
      numeric: ref.numeric,
      label: ref.label,
      fieldsQueried,
      hits: [...seen.keys()],
    })
  );
  return [...seen.values()];
}

export async function firestoreListOrdersByClientId(
  businessId: string,
  clientId: string,
  limit: number
): Promise<OrderLookupRecord[]> {
  const page = await findOrdersPage({
    businessId,
    clientId,
    sortDir: 'desc',
    limit,
    offset: 0,
  });
  return page.items;
}

export function firestoreFindOrderDeps(
  businessId: string,
  utterance?: string,
  operationContext?: OrderOperationContext,
  pedidosConfig?: Awaited<ReturnType<typeof loadOrderPedidosConfig>>
): FindOrderDeps {
  const config = pedidosConfig ?? FALLBACK_PEDIDOS_CONFIG;
  const countEligibleOrdersForClient = async (
    clientId: string,
    ops: ReturnType<typeof analyzePendingWrites>
  ) => {
    const rows = await firestoreListOrdersByClientId(businessId, clientId, 10);
    return filterEligibleOrderRecords(rows, ops, config).length;
  };
  return {
    getById: (id) => firestoreGetOrderById(businessId, id),
    findByReference: (ref) => firestoreFindOrdersByReference(businessId, ref),
    findClient: async (query) => {
      const resolved = await findClient(businessId, query, { utterance: utterance ?? query });
      console.info(
        '[whatsapp:resolver:client]',
        JSON.stringify({
          query,
          status: resolved.status,
          selected: resolved.entity ? { id: resolved.entity.id, name: resolved.entity.name } : null,
          candidates: (resolved.candidates ?? []).slice(0, 8).map((row) => ({
            id: row.id,
            name: row.name,
            score: row.score,
          })),
        })
      );
      return resolved;
    },
    listByClientId: (clientId, limit) => firestoreListOrdersByClientId(businessId, clientId, limit),
    countEligibleOrdersForClient,
  };
}

export async function resolveFindOrderHintsForBusiness(
  businessId: string,
  hints: FindOrderHints,
  utterance?: string
): Promise<FindOrderLookupResult> {
  const pedidosConfig = hints.operationContext?.pendingWrites?.length
    ? await loadOrderPedidosConfig(businessId)
    : undefined;
  return resolveFindOrderHints(
    hints,
    firestoreFindOrderDeps(businessId, utterance, hints.operationContext, pedidosConfig),
    pedidosConfig
  );
}
