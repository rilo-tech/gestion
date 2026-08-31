import { db } from '../firebase.ts';
import type { Query } from 'firebase-admin/firestore';
import {
  getOrderEstadoLabel,
  normalizeOrderPedidosConfig,
} from '../utils/order-config.ts';
import { formatOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import {
  formatDateOnlyEs,
  extractOrderNumberFromText,
  extractQueryClientFromText,
  resolveClientMatch,
} from './lookups.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { getConversationState, rememberFocusOrder, rememberFocusProduct, type LastWhatsappOperation } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { formatFindOrderGuide, listWhatsappOrdersWithFallback } from './order-status.ts';
import { formatWhatsappResponse } from '../../shared/whatsapp-format.ts';
import {
  ASK_STOCK_PRODUCT,
  focusProductsFromOrderItems,
  presentCountQuery,
  presentEntityList,
  presentOrderListItem,
  presentOrderQuery,
  presentStockQuery,
  uniqueFocusProduct,
} from './conversation-query.ts';
import { presentListFooter, resolveListPolicy, wantsEntityList } from './query-policy.ts';

type StoreDoc = { id: string; data: () => Record<string, unknown> };

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function pedidosEstadoLabel(businessId: string, estado?: string): Promise<string> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const raw = snap.data()?.pedidos;
  const config = normalizeOrderPedidosConfig(
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  );
  return getOrderEstadoLabel(estado, config.estados);
}

function itemNames(items: unknown): string {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .slice(0, 6)
    .map((row) => {
      const data = row as { nombre?: string; cantidad?: number };
      const name = String(data.nombre ?? '').trim();
      const qty = Number(data.cantidad) || 0;
      if (!name) return '';
      return qty > 1 ? `${qty} × ${name}` : name;
    })
    .filter(Boolean)
    .join(', ');
}

async function formatOrderDoc(
  businessId: string,
  id: string,
  data: Record<string, unknown>,
  metric?: string | null
): Promise<string> {
  const label = resolveOrderLabel({
    numeroPedido: Number(data.numeroPedido) || undefined,
    numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
  });
  const estado = await pedidosEstadoLabel(businessId, String(data.estado ?? ''));
  const notes = String(data.descripcion ?? '').trim();
  const saldo = Number(data.saldo);
  return presentOrderQuery({
    metric: metric || 'details',
    label: label || id.slice(0, 6),
    clientName: String(data.clienteNombre ?? '').trim() || '(sin nombre)',
    statusLabel: estado || String(data.estado ?? 'pendiente'),
    products: itemNames(data.items) || undefined,
    notes: notes && !/^origen:\s*whatsapp/i.test(notes) ? notes.slice(0, 160) : undefined,
    total: Number(data.total) || 0,
    saldo: Number.isFinite(saldo) ? saldo : undefined,
    delivery: formatDateOnlyEs(String(data.fechaEntrega ?? '').slice(0, 10)) || undefined,
  });
}

async function formatSaleDoc(id: string, data: Record<string, unknown>): Promise<string> {
  const label = String(data.ventaLabel ?? data.numeroVenta ?? id.slice(0, 6));
  const estado = String(data.estado ?? 'confirmada').replace(/_/g, ' ');
  const lines = [
    `*Venta #${label}*`,
    '',
    `• Estado: ${estado}`,
  ];
  const products = itemNames(data.items);
  if (products) lines.push(`• Producto: ${products}`);
  lines.push(`• Total: $${money(Number(data.total) || 0)}`);
  if (data.saldoPendiente != null) {
    lines.push(`• Saldo: $${money(Number(data.saldoPendiente) || 0)}`);
  }
  return lines.join('\n');
}

async function loadOrderById(
  businessId: string,
  id: string,
  metric?: string | null
): Promise<{ reply: string } | null> {
  const snap = await db.doc(`negocios/${businessId}/pedidos/${id}`).get();
  if (!snap.exists) return null;
  return { reply: await formatOrderDoc(businessId, snap.id, (snap.data() ?? {}) as Record<string, unknown>, metric) };
}

async function loadSaleById(businessId: string, id: string): Promise<{ reply: string } | null> {
  const snap = await db.doc(`negocios/${businessId}/ventas/${id}`).get();
  if (!snap.exists) return null;
  return { reply: await formatSaleDoc(snap.id, (snap.data() ?? {}) as Record<string, unknown>) };
}

async function findOrdersByNumber(businessId: string, rawNumber: string): Promise<StoreDoc[]> {
  const numero = Number(rawNumber);
  if (!Number.isFinite(numero) || numero <= 0) return [];
  const label = formatOrderNumber(numero);
  const col = db.collection(`negocios/${businessId}/pedidos`);
  const byNumero = await col.where('numeroPedido', '==', numero).limit(5).get();
  if (!byNumero.empty) return byNumero.docs;
  const byLabel = await col.where('numeroPedidoLabel', '==', label).limit(5).get();
  return byLabel.docs;
}

async function findLatestWhatsappOrder(
  businessId: string,
  phone: string
): Promise<StoreDoc | null> {
  const snap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('whatsappPhone', '==', phone)
    .limit(15)
    .get();
  if (snap.empty) return null;
  const sorted = [...snap.docs].sort((a, b) =>
    String(b.data().createdAt ?? '').localeCompare(String(a.data().createdAt ?? ''))
  );
  return sorted[0] ?? null;
}

async function findSalesByClientId(businessId: string, clientId: string): Promise<StoreDoc[]> {
  const snap = await db
    .collection(`negocios/${businessId}/ventas`)
    .where('clienteId', '==', clientId)
    .limit(12)
    .get();
  return [...snap.docs].sort((a, b) => {
    const ta = String(a.data().createdAt ?? a.data().fecha ?? '');
    const tb = String(b.data().createdAt ?? b.data().fecha ?? '');
    return tb.localeCompare(ta);
  });
}

async function formatClientHistory(
  businessId: string,
  clientName: string,
  orders: StoreDoc[],
  sales: StoreDoc[]
): Promise<string> {
  if (orders.length === 1 && !sales.length) {
    const body = await formatOrderDoc(businessId, orders[0]!.id, orders[0]!.data() as Record<string, unknown>);
    const data = orders[0]!.data() as Record<string, unknown>;
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    return `${clientName} tiene el pedido #${label}.\n${body}`;
  }
  if (sales.length === 1 && !orders.length) {
    const body = await formatSaleDoc(sales[0]!.id, sales[0]!.data() as Record<string, unknown>);
    return `${clientName} tiene esta venta:\n${body}`;
  }

  const lines: string[] = [];
  for (const doc of orders.slice(0, 6)) {
    const data = doc.data() as Record<string, unknown>;
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    const estado = await pedidosEstadoLabel(businessId, String(data.estado ?? ''));
    const products = itemNames(data.items) || String(data.descripcion ?? '').trim().slice(0, 80);
    lines.push(
      `• Pedido #${label} · ${estado}${products ? ` · ${products}` : ''} · $${money(Number(data.total) || 0)}`
    );
  }
  for (const doc of sales.slice(0, 4)) {
    const data = doc.data() as Record<string, unknown>;
    const label = String(data.ventaLabel ?? data.numeroVenta ?? '').trim() || 'venta';
    const products = itemNames(data.items);
    lines.push(
      `• Venta #${label}${products ? ` · ${products}` : ''} · $${money(Number(data.total) || 0)}`
    );
  }
  if (!lines.length) return `${clientName} no tiene pedidos ni ventas registradas.`;
  return `${clientName} — ${orders.length ? `${orders.length} pedido(s)` : ''}${
    orders.length && sales.length ? ', ' : ''
  }${sales.length ? `${sales.length} venta(s)` : ''}:\n${lines.join('\n')}`;
}

async function findOrdersByClientId(businessId: string, clientId: string): Promise<StoreDoc[]> {
  const snap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('clienteId', '==', clientId)
    .limit(12)
    .get();
  return [...snap.docs].sort((a, b) => {
    const ta = String(a.data().createdAt ?? '');
    const tb = String(b.data().createdAt ?? '');
    return tb.localeCompare(ta);
  });
}

export type OrderListPageQuery = {
  businessId: string;
  clientId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'createdAt' | 'fechaEntrega';
  sortDir?: 'asc' | 'desc';
  limit: number;
  offset: number;
};

export type OrderListPageResult = {
  items: Array<{ id: string; data: Record<string, unknown> }>;
  total?: number;
  hasMore: boolean;
};

function applyOrderListConstraints(col: Query, q: OrderListPageQuery): Query {
  let ref: Query = col;
  if (q.clientId) ref = ref.where('clienteId', '==', q.clientId);
  if (q.status) ref = ref.where('estado', '==', q.status);
  const dateField = q.dateField === 'fechaEntrega' ? 'fechaEntrega' : 'createdAt';
  if (q.dateFrom) ref = ref.where(dateField, '>=', q.dateFrom);
  if (q.dateTo) {
    const to =
      dateField === 'createdAt' && q.dateTo.length === 10 ? `${q.dateTo}T23:59:59.999Z` : q.dateTo;
    ref = ref.where(dateField, '<=', to);
  }
  return ref;
}

export async function countOrdersForQuery(q: OrderListPageQuery): Promise<number | undefined> {
  try {
    const col = db.collection(`negocios/${q.businessId}/pedidos`);
    const snap = await applyOrderListConstraints(col, q).count().get();
    return Number(snap.data().count) || 0;
  } catch {
    return undefined;
  }
}

export async function findOrdersPage(q: OrderListPageQuery): Promise<OrderListPageResult> {
  const col = db.collection(`negocios/${q.businessId}/pedidos`);
  const dateField = q.dateField === 'fechaEntrega' ? 'fechaEntrega' : 'createdAt';
  const sortDir = q.sortDir === 'asc' ? 'asc' : 'desc';
  const take = Math.max(1, q.limit);
  const offset = Math.max(0, q.offset);
  const fetchN = offset + take + 1;

  try {
    const snap = await applyOrderListConstraints(col, q).orderBy(dateField, sortDir).limit(fetchN).get();
    const sliced = snap.docs.slice(offset, offset + take);
    return {
      items: sliced.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> })),
      hasMore: snap.docs.length > offset + take,
    };
  } catch {
    const fallback = q.clientId
      ? await col.where('clienteId', '==', q.clientId).limit(Math.min(40, fetchN)).get()
      : await col.limit(Math.min(40, fetchN)).get();
    const sorted = [...fallback.docs].sort((a, b) => {
      const ta = String(a.data()[dateField] ?? a.data().createdAt ?? '');
      const tb = String(b.data()[dateField] ?? b.data().createdAt ?? '');
      return sortDir === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
    });
    const filtered = sorted.filter((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (q.status && String(data.estado ?? '') !== q.status) return false;
      const stamp = String(data[dateField] ?? data.createdAt ?? '').slice(0, 10);
      if (q.dateFrom && stamp < q.dateFrom) return false;
      if (q.dateTo && stamp > q.dateTo) return false;
      return true;
    });
    const sliced = filtered.slice(offset, offset + take);
    return {
      items: sliced.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> })),
      hasMore: filtered.length > offset + take,
    };
  }
}

export type OrderListQueryResult = {
  reply: string;
  listItems?: string[];
  title?: string;
  total?: number;
  hasMore?: boolean;
  pageSize?: number;
  offset?: number;
};

export async function queryOrderListFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<OrderListQueryResult> {
  const clientHint = String(entities.clientName ?? '').trim();
  let clientId = '';
  let clientLabel = clientHint;
  if (clientHint) {
    const resolved = await resolveClientMatch(tenant.businessId, clientHint, { utterance: clientHint });
    const candidates = resolved.status === 'unique'
      ? [{ id: resolved.client.id, name: resolved.client.nombre, score: resolved.client.score }]
      : resolved.status === 'ambiguous'
        ? resolved.candidates.map((row) => ({ id: row.id, name: row.nombre, score: row.score }))
        : [];
    console.info(
      '[whatsapp:resolver:client]',
      JSON.stringify({
        query: clientHint,
        status: resolved.status,
        candidates,
        selected:
          resolved.status === 'unique'
            ? { id: resolved.client.id, name: resolved.client.nombre }
            : null,
      })
    );
    if (resolved.status === 'none') {
      return { reply: `No encontré un cliente llamado ${clientHint}.` };
    }
    if (resolved.status === 'ambiguous') {
      const names = resolved.candidates.slice(0, 5).map((row) => `• ${row.nombre}`);
      return {
        reply: `Encontré más de un cliente parecido a *${clientHint}*:\n${names.join('\n')}\nDecime el nombre completo.`,
      };
    }
    clientId = resolved.client.id;
    clientLabel = resolved.client.nombre || clientHint;
  }

  const policy = resolveListPolicy({
    metric: entities.queryMetric,
    limit: entities.queryLimit,
    requestAll: entities.queryRequestAll === true,
    page: entities.queryPage,
    offset: entities.queryOffset,
    sortDirection: entities.querySortDir,
  });
  const dateField = entities.queryDateField === 'fechaEntrega' ? 'fechaEntrega' : 'createdAt';
  const pageQuery: OrderListPageQuery = {
    businessId: tenant.businessId,
    clientId: clientId || undefined,
    status: String(entities.queryStatusFilter ?? '').trim() || undefined,
    dateFrom: entities.queryDateFrom,
    dateTo: entities.queryDateTo,
    dateField,
    sortDir: policy.sortDirection,
    limit: policy.limit || policy.pageSize,
    offset: policy.offset,
  };

  console.info(
    '[whatsapp:query:plan]',
    JSON.stringify({
      entity: 'orders',
      clientId: clientId || null,
      clientLabel,
      limit: pageQuery.limit,
      offset: pageQuery.offset,
      sort: pageQuery.sortDir,
      status: pageQuery.status ?? null,
      dateFrom: pageQuery.dateFrom ?? null,
      dateTo: pageQuery.dateTo ?? null,
    })
  );

  if (String(entities.queryMetric ?? '') === 'sum') {
    return {
      reply:
        'Entendí que querés un total. El agregado en dinero todavía no tiene adaptador en WhatsApp; puedo listar o contar registros.',
    };
  }

  if (policy.mode === 'count') {
    const total = await countOrdersForQuery(pageQuery);
    const known = total ?? 0;
    const reply = presentCountQuery({
      subject: clientLabel || 'Ese cliente',
      total: known,
      filterHint: pageQuery.status ? `(${pageQuery.status})` : undefined,
    });
    const offer = known > 0 ? `\nSi querés, te muestro los últimos.` : '';
    return { reply: `${reply}${offer}`, total: known, hasMore: false };
  }

  const [page, counted] = await Promise.all([
    findOrdersPage(pageQuery),
    countOrdersForQuery(pageQuery),
  ]);
  if (clientId) {
    const leaked = page.items.filter((row) => String(row.data.clienteId ?? '') !== clientId);
    if (leaked.length) {
      console.error(
        '[whatsapp:QUERY_RESULT_SCOPE_MISMATCH]',
        JSON.stringify({
          clientId,
          leaked: leaked.slice(0, 5).map((row) => ({
            id: row.id,
            clienteId: row.data.clienteId ?? null,
            clienteNombre: row.data.clienteNombre ?? null,
          })),
        })
      );
      page.items = page.items.filter((row) => String(row.data.clienteId ?? '') === clientId);
    }
  }
  const total = counted ?? page.items.length + (page.hasMore ? policy.offset + page.items.length + 1 : policy.offset + page.items.length);
  const hasMore = counted != null ? policy.offset + page.items.length < counted : page.hasMore;

  if (!page.items.length) {
    return {
      reply: clientLabel ? `No encontré pedidos de ${clientLabel}.` : 'No encontré pedidos.',
      total: counted ?? 0,
      hasMore: false,
    };
  }

  const lines: string[] = [];
  for (const row of page.items) {
    const estado = await pedidosEstadoLabel(tenant.businessId, String(row.data.estado ?? ''));
    const when = formatDateOnlyEs(
      String(row.data.fechaEntrega || row.data.createdAt || '').slice(0, 10)
    );
    const label = resolveOrderLabel({
      numeroPedido: Number(row.data.numeroPedido) || undefined,
      numeroPedidoLabel: String(row.data.numeroPedidoLabel ?? ''),
    });
    lines.push(
      presentOrderListItem({
        label: label || row.id.slice(0, 6),
        date: when || undefined,
        statusLabel: estado || String(row.data.estado ?? ''),
        total: Number(row.data.total) || 0,
      })
    );
  }

  const title = clientLabel
    ? policy.limit === 1
      ? `Último pedido de ${clientLabel}`
      : `Últimos pedidos de ${clientLabel}`
    : 'Últimos pedidos';
  const footer = presentListFooter({
    shown: policy.offset + lines.length,
    total: counted ?? total,
    hasMore,
    requestAll: policy.requestAll,
  });
  const reply = presentEntityList({
    title,
    lines,
    shown: lines.length,
    total: counted ?? total,
    hasMore,
    requestAll: policy.requestAll,
    emptyText: clientLabel ? `No encontré pedidos de ${clientLabel}.` : 'No encontré pedidos.',
    footer,
  });
  return {
    reply,
    listItems: lines,
    title,
    total: counted ?? total,
    hasMore,
    pageSize: policy.pageSize,
    offset: policy.offset,
  };
}

async function replyFromLastOperation(
  tenant: WhatsappTenantContext,
  last: LastWhatsappOperation
): Promise<{ reply: string } | null> {
  if (last.kind === 'order') {
    const loaded = await loadOrderById(tenant.businessId, last.id);
    if (!loaded) return null;
    const who = last.clientName ? ` de ${last.clientName}` : '';
    const num = last.label ? ` #${last.label}` : '';
    return { reply: `El último pedido${who}${num}:\n${loaded.reply}` };
  }
  if (last.kind === 'sale') return loadSaleById(tenant.businessId, last.id);
  if (last.kind === 'purchase') {
    const snap = await db.doc(`negocios/${tenant.businessId}/compras/${last.id}`).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const estado = String(data.estado ?? (data.borrador ? 'borrador' : 'registrada'));
    return {
      reply:
        `Compra ${last.label ? `#${last.label}` : ''}\n` +
        `• Proveedor: ${String(data.proveedorNombre ?? last.clientName ?? '').trim() || '(sin nombre)'}\n` +
        `• Estado: ${estado}\n` +
        `• Total: $${money(Number(data.total ?? last.amount) || 0)}`,
    };
  }
  if (last.kind === 'client') {
    return { reply: `El último alta fue el cliente ${last.clientName || 'sin nombre'}.` };
  }
  if (last.kind === 'payment') {
    return {
      reply: `El último cobro fue ${last.clientName ? `de ${last.clientName} ` : ''}por $${money(last.amount || 0)}.`,
    };
  }
  if (last.kind === 'cash') {
    return { reply: `El último movimiento de caja fue por $${money(last.amount || 0)}.` };
  }
  return null;
}

async function rememberShownOrder(
  tenant: WhatsappTenantContext,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const products = focusProductsFromOrderItems(data.items);
  await rememberFocusOrder(tenant.businessId, tenant.phone, {
    id,
    label: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientName: String(data.clienteNombre ?? ''),
  }, {
    product: uniqueFocusProduct(products),
    products,
  });
}

export async function queryStatusFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  lastOperation?: LastWhatsappOperation | null
): Promise<{ reply: string; listItems?: string[]; title?: string; total?: number; hasMore?: boolean; pageSize?: number; offset?: number }> {
  const source = String(entities.sourceText ?? '');
  const metric = String(entities.queryMetric ?? '').trim() || undefined;
  const orderNumber =
    String(entities.orderNumber ?? '').trim() || extractOrderNumberFromText(source);
  const targetId = String(entities.targetOrderId ?? '').trim();
  if (
    wantsEntityList({
      listOrders: entities.listOrders,
      entity: entities.queryEntity,
      metric: entities.queryMetric,
      orderNumber,
      targetOrderId: targetId,
    })
  ) {
    return queryOrderListFromWhatsapp(tenant, entities);
  }
  let clientName =
    String(entities.clientName ?? '').trim() || extractQueryClientFromText(source) || '';
  if (/^(este|esta|esto|ese|esa|eso)$/i.test(clientName)) clientName = '';
  const asksItems = /\b(pidi[oó]|compr[oó]|n[uú]mero|nro\.?)/i.test(source);

  if (targetId) {
    const loaded = await loadOrderById(tenant.businessId, targetId, metric);
    if (loaded) {
      const snap = await db.doc(`negocios/${tenant.businessId}/pedidos/${targetId}`).get();
      if (snap.exists) await rememberShownOrder(tenant, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
      return loaded;
    }
  }

  if (
    !clientName &&
    asksItems &&
    lastOperation?.clientName &&
    lastOperation.kind !== 'order' &&
    lastOperation.kind !== 'sale'
  ) {
    clientName = lastOperation.clientName;
  }

  if (orderNumber) {
    const docs = await findOrdersByNumber(tenant.businessId, orderNumber);
    if (!docs.length) {
      return { reply: `No encontré el pedido #${formatOrderNumber(Number(orderNumber)) || orderNumber}.` };
    }
    if (docs.length === 1) {
      const doc = docs[0]!;
      const data = doc.data() as Record<string, unknown>;
      await rememberShownOrder(tenant, doc.id, data);
      return {
        reply: await formatOrderDoc(tenant.businessId, doc.id, data, metric),
      };
    }
    const lines = await Promise.all(
      docs.slice(0, 5).map(async (doc) => {
        const data = doc.data() as Record<string, unknown>;
        const label = resolveOrderLabel({
          numeroPedido: Number(data.numeroPedido) || undefined,
          numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
        });
        const estado = await pedidosEstadoLabel(tenant.businessId, String(data.estado ?? ''));
        return `• #${label} · ${data.clienteNombre || 'cliente'} · ${estado} · $${money(Number(data.total) || 0)}`;
      })
    );
    return { reply: `Encontré varios:\n${lines.join('\n')}` };
  }

  if (clientName) {
    const { items: listed, closedFallback } = await listWhatsappOrdersWithFallback(tenant.businessId, {
      clientHint: clientName,
      productHint: entities.productName,
      sourceText: String(entities.sourceText ?? clientName),
      limit: 8,
    });
    if (listed.length === 1 && !closedFallback) {
      const hit = listed[0]!;
      const loaded = await loadOrderById(tenant.businessId, hit.id, metric);
      if (loaded) {
        const snap = await db.doc(`negocios/${tenant.businessId}/pedidos/${hit.id}`).get();
        if (snap.exists) {
          await rememberShownOrder(tenant, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
        }
        return loaded;
      }
    }
    if (listed.length) {
      const lines = listed.map(
        (item, index) =>
          `${index + 1}) #${item.label} · ${item.clientName}${item.productSummary ? ` · ${item.productSummary}` : ''} · ${item.estado}`
      );
      const head = closedFallback
        ? `No hay pedidos abiertos de ${clientName}. Estos ya están entregados:`
        : `Pedidos de ${clientName}:`;
      return {
        reply: `${head}\n${lines.join('\n')}\n¿Cuál? Número de la lista.`,
      };
    }
    return {
      reply: formatFindOrderGuide({
        missed: true,
        triedHint: clientName,
        forQuery: true,
      }),
    };
  }

  const state = await getConversationState(tenant.businessId, tenant.phone);
  const focusId = String(state?.focusOrder?.id ?? '').trim();
  if (focusId) {
    const loaded = await loadOrderById(tenant.businessId, focusId, metric);
    if (loaded) {
      const snap = await db.doc(`negocios/${tenant.businessId}/pedidos/${focusId}`).get();
      if (snap.exists) {
        await rememberShownOrder(tenant, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
      }
      return loaded;
    }
  }

  if (lastOperation?.id) {
    const fromLast = await replyFromLastOperation(tenant, lastOperation);
    if (fromLast) return fromLast;
  }

  const recent = await findLatestWhatsappOrder(tenant.businessId, tenant.phone);
  if (recent) {
    return {
      reply: await formatOrderDoc(tenant.businessId, recent.id, recent.data() as Record<string, unknown>, metric),
    };
  }

  return {
    reply:
      '¿De qué pedido hablás? Decime el número (ej. #00223), el cliente, o «el último».',
  };
}

function normalizeStockToken(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function stockActualOf(data: Record<string, unknown>): number {
  return Number(data.stockActual) || 0;
}

async function loadStockRow(
  businessId: string,
  productId: string
): Promise<{ id: string; name: string; qty: number } | null> {
  const snap = await db.doc(`negocios/${businessId}/stock/${productId}`).get();
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const name = String(data.nombre ?? '').trim();
  if (!name) return null;
  return { id: snap.id, name, qty: stockActualOf(data) };
}

async function loadOrderFocusProducts(businessId: string, orderId: string) {
  const snap = await db.doc(`negocios/${businessId}/pedidos/${orderId}`).get();
  if (!snap.exists) return [];
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  return focusProductsFromOrderItems(data.items);
}

export type StockQueryResult = {
  reply: string;
  replies?: string[];
  listItems?: string[];
  title?: string;
  total?: number;
  productId?: string;
  productName?: string;
};

async function replyStockHit(
  tenant: WhatsappTenantContext,
  hit: { id?: string; name: string; qty: number },
  expectedValue?: number
): Promise<StockQueryResult> {
  if (hit.id || hit.name) {
    await rememberFocusProduct(tenant.businessId, tenant.phone, {
      id: hit.id,
      name: hit.name,
      locked: true,
    });
  }
  return {
    reply: presentStockQuery({
      productName: hit.name,
      stock: hit.qty,
      expectedValue,
    }),
    total: hit.qty,
    productId: hit.id,
    productName: hit.name,
  };
}

export async function queryStockFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<StockQueryResult> {
  const expectedValue =
    entities.queryExpectedValue != null && Number.isFinite(Number(entities.queryExpectedValue))
      ? Number(entities.queryExpectedValue)
      : undefined;
  const item = entities.items?.[0];
  const color = String(item?.attributes?.color ?? '').trim() || null;
  const size = String(item?.attributes?.size ?? '').trim().toUpperCase() || null;
  const hint = String(item?.productHint || item?.productName || entities.productName || '').trim();
  let productId = String(entities.productId || item?.productId || '').trim();

  if (!productId && entities.referToFocusedProduct) {
    const state = await getConversationState(tenant.businessId, tenant.phone);
    productId = String(state?.focusEntities?.product?.id ?? '').trim();
    if (!productId && !hint && state?.focusOrder?.id) {
      const products = await loadOrderFocusProducts(tenant.businessId, state.focusOrder.id);
      const unique = uniqueFocusProduct(products);
      if (unique?.id && !color && !size) {
        productId = unique.id;
        if (!entities.productName) entities.productName = unique.name;
      } else if (products.length > 1 && !hint && !color && !size) {
        const labels = products
          .map((row, index) => `${index + 1}. ${row.name || row.id}`)
          .filter(Boolean);
        return {
          reply: `${ASK_STOCK_PRODUCT}\n${labels.join('\n')}`,
          listItems: labels,
          title: 'Stock',
        };
      }
    } else if (!productId && !hint && state?.focusEntities?.product?.name) {
      entities.productName = state.focusEntities.product.name;
    }
  }

  if (productId && !color && !size) {
    const row = await loadStockRow(tenant.businessId, productId);
    if (row) return replyStockHit(tenant, row, expectedValue);
  }

  const searchHint = (hint || String(entities.productName ?? '')).trim().toLowerCase();
  if (!productId && !searchHint && !color && !size) {
    return { reply: ASK_STOCK_PRODUCT };
  }

  const snap = await db.collection(`negocios/${tenant.businessId}/stock`).get();
  const hits: Array<{ id: string; label: string; qty: number }> = [];

  for (const doc of snap.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const rowSize = String(data.talle ?? '').trim().toUpperCase();
    const haystack = normalizeStockToken(`${nombre} ${data.color ?? ''} ${data.talle ?? ''}`);
    if (color && !haystack.includes(normalizeStockToken(color))) continue;
    if (size && rowSize && rowSize !== size && !haystack.includes(size.toLowerCase())) continue;
    if (searchHint) {
      const tokens = searchHint.split(/\s+/).filter((token) => token.length >= 3);
      if (tokens.length && !tokens.every((token) => haystack.includes(normalizeStockToken(token)))) {
        continue;
      }
    }
    const qty = stockActualOf(data);
    const extra = [data.color, data.talle].map((value) => String(value ?? '').trim()).filter(Boolean);
    const label = extra.length ? `${nombre} (${extra.join(', ')})` : nombre;
    hits.push({ id: doc.id, label, qty });
  }

  if (!hits.length) {
    return { reply: 'No encontré ese producto ⚠️' };
  }

  if (hits.length === 1) {
    const hit = hits[0]!;
    return replyStockHit(tenant, { id: hit.id, name: hit.label, qty: hit.qty }, expectedValue);
  }

  const items = hits
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    .map((hit, index) => `${index + 1}. ${hit.label} — ${hit.qty}`);
  const presented = formatWhatsappResponse({
    kind: 'explore',
    title: 'Stock',
    items,
    wantAll: entities.listWantAll === true,
  });
  return {
    reply: presented.pages[0] ?? 'Stock',
    replies: presented.pages.length > 1 ? presented.pages : undefined,
    listItems: items,
    title: 'Stock',
    total: hits.reduce((sum, hit) => sum + hit.qty, 0),
  };
}
