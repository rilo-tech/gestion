import { db } from '../../../firebase.ts';
import { computeClientBalanceForIds } from '../../../utils/client-balance.ts';
import { resolveOrderLabel } from '../../../utils/order-number.ts';
import { getOrderEstadoLabel, normalizeOrderPedidosConfig } from '../../../utils/order-config.ts';
import { getCashBalance, getCashMovements } from '../../../domain/cash/index.ts';
import { findClient, getClient, listClients } from '../../../domain/client/index.ts';
import { findProduct, getProduct, getProductStock, listProducts } from '../../../domain/stock/index.ts';
import { findSupplier, getSupplier, listSuppliers } from '../../../domain/supplier/index.ts';
import {
  countOrdersForQuery,
  findOrdersPage,
  type OrderListPageQuery,
} from '../../erp-queries.ts';
import { extractOrderNumberFromText } from '../../lookups.ts';
import { resolveListPolicy, resolveQueryDateRange, presentListFooter } from '../../query-policy.ts';
import type { ToolDefinition, ToolExecutionContext } from '../tool-types.ts';
import {
  nBoolean,
  nInteger,
  nNumber,
  nString,
  reqString,
  strictObject,
} from '../strict-tool-schema.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function pedidosEstadoLabel(businessId: string, estado?: string): Promise<string> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const raw = snap.data()?.pedidos;
  const config = normalizeOrderPedidosConfig(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
  return getOrderEstadoLabel(estado, config.estados);
}

function mapOrderRow(
  businessId: string,
  id: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return pedidosEstadoLabel(businessId, String(data.estado ?? '')).then((statusLabel) => ({
    id,
    number: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientId: String(data.clienteId ?? ''),
    clientName: String(data.clienteNombre ?? '').trim(),
    status: String(data.estado ?? ''),
    statusLabel,
    total: Number(data.total) || 0,
    balance: Math.max(0, Number(data.saldo) || 0),
    deliveryDate: String(data.fechaEntrega ?? '').slice(0, 10) || undefined,
    createdAt: String(data.createdAt ?? '').slice(0, 10) || undefined,
  }));
}

async function resolveOrderByHint(
  businessId: string,
  input: { orderId?: string; orderNumber?: string; query?: string }
): Promise<{ status: 'resolved' | 'not_found' | 'ambiguous'; entity?: Record<string, unknown>; candidates?: Record<string, unknown>[] }> {
  const orderId = String(input.orderId ?? '').trim();
  if (orderId) {
    const snap = await db.doc(`negocios/${businessId}/pedidos/${orderId}`).get();
    if (!snap.exists) return { status: 'not_found' };
    const entity = await mapOrderRow(businessId, snap.id, (snap.data() ?? {}) as Record<string, unknown>);
    return { status: 'resolved', entity };
  }
  const hint = String(input.orderNumber ?? input.query ?? '').trim();
  if (!hint) return { status: 'not_found' };
  const extracted = extractOrderNumberFromText(hint);
  const col = db.collection(`negocios/${businessId}/pedidos`);
  if (extracted) {
    const snap = await col.where('numeroPedidoLabel', '==', extracted).limit(2).get();
    if (snap.empty) {
      const numeric = Number(extracted.replace(/^0+/, ''));
      if (numeric > 0) {
        const alt = await col.where('numeroPedido', '==', numeric).limit(2).get();
        if (alt.size === 1) {
          const entity = await mapOrderRow(businessId, alt.docs[0]!.id, (alt.docs[0]!.data() ?? {}) as Record<string, unknown>);
          return { status: 'resolved', entity };
        }
      }
    } else if (snap.size === 1) {
      const entity = await mapOrderRow(businessId, snap.docs[0]!.id, (snap.docs[0]!.data() ?? {}) as Record<string, unknown>);
      return { status: 'resolved', entity };
    }
  }
  return { status: 'not_found' };
}

function listPolicyFromArgs(args: Record<string, unknown>, stateOffset?: number) {
  return resolveListPolicy({
    metric: String(args.metric ?? 'list'),
    limit: args.limit != null ? Number(args.limit) : undefined,
    requestAll: args.requestAll === true,
    page: String(args.page ?? ''),
    offset: args.offset != null ? Number(args.offset) : stateOffset,
    sortDirection: String(args.sort ?? 'recent_desc').includes('asc') ? 'asc' : 'desc',
  });
}

function dateRangeFromArgs(args: Record<string, unknown>, today: string) {
  const token = String(args.dateRange ?? args.month ?? args.date ?? '').trim();
  return resolveQueryDateRange(token, today);
}

export const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'find_client',
    description: 'Busca un cliente por nombre o hint humano.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_client',
    description: 'Obtiene un cliente por id real del ERP.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({ clientId: reqString() }),
  },
  {
    name: 'list_clients',
    description: 'Lista clientes con paginación opcional.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({
      query: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'find_product',
    description: 'Busca un producto del catálogo por hint.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_product',
    description: 'Obtiene un producto por id real del ERP.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({ productId: reqString() }),
  },
  {
    name: 'list_products',
    description: 'Lista productos del catálogo.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      query: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'get_stock',
    description: 'Consulta stock actual de un producto por id.',
    mode: 'read',
    capability: 'query_stock',
    parameters: strictObject({ productId: reqString() }),
  },
  {
    name: 'find_order',
    description: 'Busca un pedido por número o hint (#00245).',
    mode: 'read',
    capability: 'query_order',
    parameters: strictObject({
      query: nString(),
      orderNumber: nString(),
      orderId: nString(),
    }),
  },
  {
    name: 'get_order',
    description: 'Obtiene un pedido por id real del ERP.',
    mode: 'read',
    capability: 'query_order',
    parameters: strictObject({ orderId: reqString() }),
  },
  {
    name: 'list_orders',
    description: 'Lista pedidos. Si el usuario pidió pedidos de un cliente, clientId es obligatorio.',
    mode: 'read',
    capability: 'query_orders',
    parameters: strictObject({
      clientId: nString(),
      clientQuery: nString(),
      status: nString(),
      limit: nInteger(),
      offset: nInteger(),
      page: nString(),
      sort: nString(),
      metric: nString(),
      requestAll: nBoolean(),
      dateRange: nString(),
      month: nString(),
    }),
  },
  {
    name: 'get_order_balance',
    description: 'Saldo pendiente de un pedido por id.',
    mode: 'read',
    capability: 'query_order_balance',
    parameters: strictObject({ orderId: reqString() }),
  },
  {
    name: 'get_client_balance',
    description: 'Saldo total pendiente de un cliente por id.',
    mode: 'read',
    capability: 'query_client_balance',
    parameters: strictObject({ clientId: reqString() }),
  },
  {
    name: 'get_cash_balance',
    description: 'Saldo actual de caja.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({ ambitoId: nString() }),
  },
  {
    name: 'list_cash_movements',
    description: 'Lista movimientos recientes de caja.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({
      limit: nInteger(),
      ambitoId: nString(),
    }),
  },
  {
    name: 'find_supplier',
    description: 'Busca un proveedor por nombre.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_supplier',
    description: 'Obtiene un proveedor por id.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({ supplierId: reqString() }),
  },
  {
    name: 'list_suppliers',
    description: 'Lista proveedores.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({
      query: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'list_sales',
    description: 'Lista ventas recientes.',
    mode: 'read',
    capability: 'query_sales',
    requiresDomainAdapter: true,
    parameters: strictObject({
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'aggregate_sales',
    description: 'Suma ventas por rango.',
    mode: 'read',
    capability: 'aggregate_sales',
    requiresDomainAdapter: true,
    parameters: strictObject({ dateRange: nString() }),
  },
  {
    name: 'list_purchases',
    description: 'Lista compras recientes.',
    mode: 'read',
    capability: 'query_purchases',
    requiresDomainAdapter: true,
    parameters: strictObject({
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'get_supplier_balance',
    description: 'Saldo/deuda de proveedor.',
    mode: 'read',
    capability: 'query_supplier_balance',
    requiresDomainAdapter: true,
    parameters: strictObject({ supplierId: reqString() }),
  },
];

export const READ_TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<Record<string, unknown>>> = {
  async find_client(args, ctx) {
    return findClient(ctx.tenant.businessId, String(args.query ?? ''), {
      utterance: ctx.rawUserMessage,
    });
  },
  async get_client(args, ctx) {
    const entity = await getClient(ctx.tenant.businessId, String(args.clientId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_clients(args, ctx) {
    const result = await listClients(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
    return result;
  },
  async find_product(args, ctx) {
    return findProduct(ctx.tenant.businessId, String(args.query ?? ''), { utterance: ctx.rawUserMessage });
  },
  async get_product(args, ctx) {
    const entity = await getProduct(ctx.tenant.businessId, String(args.productId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_products(args, ctx) {
    return listProducts(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
  },
  async get_stock(args, ctx) {
    const row = await getProductStock(ctx.tenant.businessId, String(args.productId ?? ''));
    return row ? { status: 'resolved', ...row } : { status: 'not_found' };
  },
  async find_order(args, ctx) {
    return resolveOrderByHint(ctx.tenant.businessId, {
      orderId: String(args.orderId ?? ''),
      orderNumber: String(args.orderNumber ?? ''),
      query: String(args.query ?? ''),
    });
  },
  async get_order(args, ctx) {
    return resolveOrderByHint(ctx.tenant.businessId, { orderId: String(args.orderId ?? '') });
  },
  async list_orders(args, ctx) {
    const businessId = ctx.tenant.businessId;
    const today = new Date().toISOString().slice(0, 10);
    const clientQuery = String(args.clientQuery ?? '').trim();
    let clientId = String(args.clientId ?? '').trim();
    let clientName = '';

    if (clientQuery && !clientId) {
      const resolved = await findClient(businessId, clientQuery, { utterance: ctx.rawUserMessage });
      if (resolved.status === 'not_found') {
        return {
          status: 'filter_blocked',
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No encontré un cliente llamado ${clientQuery}.`,
          filter: { clientQuery },
        };
      }
      if (resolved.status === 'ambiguous') {
        return {
          status: 'filter_blocked',
          errorCode: 'ENTITY_AMBIGUOUS',
          message: `Encontré más de un cliente parecido a ${clientQuery}.`,
          candidates: resolved.candidates,
          filter: { clientQuery },
        };
      }
      clientId = resolved.entity!.id;
      clientName = resolved.entity!.name;
    }

    const policy = listPolicyFromArgs(args, ctx.state?.listContext?.offset);
    const range = dateRangeFromArgs(args, today);
    const pageQuery: OrderListPageQuery = {
      businessId,
      clientId: clientId || undefined,
      status: String(args.status ?? '').trim() || undefined,
      dateFrom: range?.from,
      dateTo: range?.to,
      sortDir: policy.sortDirection,
      limit: policy.limit,
      offset: policy.offset,
    };

    if (policy.mode === 'count') {
      const total = (await countOrdersForQuery(pageQuery)) ?? 0;
      return {
        mode: 'count',
        total,
        filter: { clientId: clientId || undefined, clientName: clientName || undefined, status: pageQuery.status },
      };
    }

    const page = await findOrdersPage(pageQuery);
    const total = clientId ? (await countOrdersForQuery(pageQuery)) ?? page.items.length : undefined;
    const items = await Promise.all(
      page.items.map((row) => mapOrderRow(businessId, row.id, row.data))
    );
    return {
      items,
      total: total ?? items.length,
      hasMore: page.hasMore,
      nextOffset: page.hasMore ? policy.offset + policy.limit : undefined,
      filter: { clientId: clientId || undefined, clientName: clientName || undefined, status: pageQuery.status },
      footer: presentListFooter({
        shown: items.length,
        total: total ?? items.length,
        hasMore: page.hasMore,
        requestAll: policy.requestAll,
      }),
    };
  },
  async get_order_balance(args, ctx) {
    const orderId = String(args.orderId ?? '').trim();
    const snap = await db.doc(`negocios/${ctx.tenant.businessId}/pedidos/${orderId}`).get();
    if (!snap.exists) return { status: 'not_found' };
    const data = snap.data() as Record<string, unknown>;
    return {
      status: 'resolved',
      orderId,
      number: resolveOrderLabel({
        numeroPedido: Number(data.numeroPedido) || undefined,
        numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
      }),
      balance: Math.max(0, Number(data.saldo) || 0),
      total: Number(data.total) || 0,
      clientName: String(data.clienteNombre ?? '').trim(),
    };
  },
  async get_client_balance(args, ctx) {
    const clientId = String(args.clientId ?? '').trim();
    const balances = await computeClientBalanceForIds(ctx.tenant.businessId, [clientId]);
    const client = await getClient(ctx.tenant.businessId, clientId);
    return {
      status: 'resolved',
      clientId,
      clientName: client?.name,
      balance: balances.get(clientId) ?? 0,
      formattedBalance: money(balances.get(clientId) ?? 0),
    };
  },
  async get_cash_balance(args, ctx) {
    const balance = await getCashBalance(ctx.tenant.businessId, {
      ambitoId: String(args.ambitoId ?? '').trim() || undefined,
    });
    return {
      status: 'resolved',
      saldo: balance.saldo,
      scope: balance.scope,
      byAmbito: balance.byAmbito,
      empty: balance.empty === true,
    };
  },
  async list_cash_movements(args, ctx) {
    const page = await getCashMovements(ctx.tenant.businessId, {
      limit: Math.min(20, Number(args.limit) || 10),
      ambitoId: String(args.ambitoId ?? '').trim() || undefined,
      paged: true,
    });
    const items = Array.isArray(page) ? page : page.items;
    return {
      items: items.map((row) => ({
        id: row.id,
        type: row.tipo,
        amount: row.monto,
        concept: row.concepto,
        date: row.fecha,
        ambito: row.ambito,
      })),
      hasMore: Array.isArray(page) ? false : page.hasMore,
      nextCursor: Array.isArray(page) ? null : page.nextCursor,
    };
  },
  async find_supplier(args, ctx) {
    return findSupplier(ctx.tenant.businessId, String(args.query ?? ''));
  },
  async get_supplier(args, ctx) {
    const entity = await getSupplier(ctx.tenant.businessId, String(args.supplierId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_suppliers(args, ctx) {
    return listSuppliers(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
  },
  async list_sales() {
    return { status: 'requires_domain_adapter', message: 'list_sales aún no está adaptado en V4.' };
  },
  async aggregate_sales() {
    return { status: 'requires_domain_adapter', message: 'aggregate_sales aún no está adaptado en V4.' };
  },
  async list_purchases() {
    return { status: 'requires_domain_adapter', message: 'list_purchases aún no está adaptado en V4.' };
  },
  async get_supplier_balance() {
    return { status: 'requires_domain_adapter', message: 'get_supplier_balance aún no está adaptado en V4.' };
  },
};
