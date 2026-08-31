import { db } from '../firebase.ts';
import {
  applyEntregaCompletaPayment,
  applyEntregaConSaldoVenta,
  isCancelledStatus,
  isDeliveredEstado,
  loadOrderPedidosConfig,
  resolveOrderEstado,
  resolveOrderGananciaForStorage,
  restoreStockForOrderEstadoRollback,
  sanitizePagoForFirestore,
  type OrderRecord,
} from '../routes/orders.ts';
import {
  buildOrderStockDiscountPreview,
  computeOrderStockStatus,
  consumeOrderStockOnDelivery,
  consumeOrderStockOnStatusChange,
  isNoReservedUnitsStockError,
  orderStockFullyConsumed,
  type OrderLineStock,
  type OrderStockRecord,
} from '../utils/order-stock-reservations.ts';
import {
  getOrderEstadoLabel,
  getOrderStockDiscountRank,
  resolveOrderPhysicalStockScope,
  resolveStockDiscountAsk,
  shouldConsumeStockOnStatusChange,
  validateOrderEstadoTransition,
  type OrderPhysicalStockScope,
  type StockDiscountAsk,
} from '../utils/order-config.ts';
import { formatStockResolutionAsk, parseRequestedStockScope } from './stock-resolution.ts';
import { formatOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import { resolveOrderBalance } from '../../shared/order-balance.ts';
import { parseOrderQueryFilter, filterOrdersByQuery } from './order-query-filter.ts';
import { lockedOrderFromFocus, shouldUseLockedOrder } from './order-lock.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';
import { getConversationState, type LastWhatsappOperation } from './conversation-state.ts';
import { resolveClientMatch, personNamesLookRelated } from './lookups.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export type WhatsappOrderStatus = 'pendiente' | 'en_produccion' | 'listo' | 'entregado';

export type OrderStatusTarget = {
  id: string;
  label: string;
  clientName: string;
  clientId: string;
  estado: string;
  total: number;
  saldo: number;
  productSummary?: string;
  searchText?: string;
};

/** Los tipos de línea del panel y de stock no coinciden exactamente, pero son la misma data. */
function stockLines(order: Partial<OrderRecord>): OrderLineStock[] {
  return (order.items ?? []) as unknown as OrderLineStock[];
}

function asStockRecord(order: Partial<OrderRecord>): OrderStockRecord {
  return order as unknown as OrderStockRecord;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function foldSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function itemSummary(data: Record<string, unknown>): string {
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .slice(0, 3)
    .map((row) => String((row as { nombre?: string }).nombre ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

function targetFromDoc(id: string, data: Record<string, unknown>, fallbackClient = ''): OrderStatusTarget {
  const balance = resolveOrderBalance(data as Parameters<typeof resolveOrderBalance>[0]);
  return {
    id,
    label: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientName: String(data.clienteNombre ?? fallbackClient),
    clientId: String(data.clienteId ?? ''),
    estado: String(data.estado ?? 'pendiente'),
    total: balance.total,
    saldo: balance.saldo,
    productSummary: itemSummary(data) || undefined,
    searchText: [
      String(data.clienteNombre ?? fallbackClient),
      itemSummary(data),
      String(data.descripcion ?? ''),
      String(data.numeroPedidoLabel ?? ''),
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export type OrderStatusResolution =
  | { status: 'unique'; order: OrderStatusTarget }
  | { status: 'ambiguous'; candidates: OrderStatusTarget[] }
  | { status: 'none' };

function ordersFromDocs(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  fallbackClient = '',
  includeClosed = false
): OrderStatusTarget[] {
  return [...docs]
    .filter((doc) => {
      const estado = String(doc.data().estado ?? '');
      if (isCancelledStatus(estado)) return false;
      if (!includeClosed && isDeliveredEstado(resolveOrderEstado(estado))) return false;
      return true;
    })
    .sort((a, b) =>
      String(b.data().createdAt ?? '').localeCompare(String(a.data().createdAt ?? ''))
    )
    .map((doc) => targetFromDoc(doc.id, doc.data(), fallbackClient));
}

function openOrdersFrom(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  fallbackClient = ''
): OrderStatusTarget[] {
  return ordersFromDocs(docs, fallbackClient, false);
}

export type OpenOrderListOptions = {
  clientHint?: string;
  productHint?: string;
  amountHint?: number;
  withBalance?: boolean;
  includeClosed?: boolean;
  onlyClosed?: boolean;
  sourceText?: string;
  limit?: number;
};

function hintTokens(value: string): string[] {
  return foldSearch(value)
    .split(' ')
    .filter(
      (token) =>
        token.length >= 3 &&
        !/^(del|los|las|una|con|por|para|que|este|esta|estado|pedido|pedidos|mostrame|listame|buscame)$/.test(
          token
        )
    );
}

/** Listar abiertos por defecto. Entregados solo si el dueño los pide. */
export function closedOrdersListMode(text: string): 'open' | 'closed' | 'all' {
  return parseOrderQueryFilter(text).listMode;
}

function stripListNoise(value: string): string {
  return foldSearch(value)
    .replace(
      /\b(mostrame|mostr[aá]|listame|list[aá]|buscame|buscar?|pedido|pedidos|abiertos?|pendientes?|entregad[oa]s?|cerrad[oa]s?|estado|que no|este|esta|en estado)\b/g,
      ' '
    )
    .replace(
      /\b(que\s+no\s+(est[ae]\s+)?(en\s+(estado\s+)?)?entregad[oa]s?|no\s+est[ae]\s+(en\s+(estado\s+)?)?entregad[oa]s?)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const PRODUCT_HINT_STOP =
  /^(pedido|pedidos|saldo|pago|pagos|abierto|abiertos|pendiente|pendientes|con saldo|llego|llegó|estado|entregado|entregados|entregada|cerrado|cerrados|que no|no en|en estado|en)$/;

function isJunkProductHint(fold: string): boolean {
  const t = String(fold ?? '').trim();
  if (!t) return true;
  if (PRODUCT_HINT_STOP.test(t)) return true;
  const tokens = t.split(' ').filter(Boolean);
  if (!tokens.length) return true;
  if (
    tokens.every(
      (token) =>
        token.length < 3 ||
        PRODUCT_HINT_STOP.test(token) ||
        /^(no|en|que|el|de|del|la|los|un|una|este|esta)$/.test(token)
    )
  ) {
    return true;
  }
  return !hintTokens(t).length;
}

function matchesOpenOrderHint(
  order: OrderStatusTarget,
  clientFold: string,
  productFold: string
): boolean {
  const haystack = foldSearch(
    `${order.searchText ?? ''} ${order.clientName} ${order.productSummary ?? ''} ${order.label}`
  );
  if (clientFold && !foldSearch(order.clientName).includes(clientFold) && !haystack.includes(clientFold)) {
    return false;
  }
  if (productFold) {
    const tokens = hintTokens(productFold);
    if (tokens.length ? !tokens.every((token) => haystack.includes(token)) : !haystack.includes(productFold)) {
      return false;
    }
  }
  return true;
}

function amountDistance(order: OrderStatusTarget, amount: number): number {
  return Math.min(Math.abs(order.saldo - amount), Math.abs(order.total - amount));
}

function matchesAmountHint(order: OrderStatusTarget, amount: number): boolean {
  if (!(amount > 0)) return true;
  const close = amountDistance(order, amount) <= Math.max(1, amount * 0.02);
  return close || order.saldo >= amount;
}

async function loadPedidoDocs(businessId: string, clientId?: string) {
  const col = db.collection(`negocios/${businessId}/pedidos`);
  if (clientId) {
    const snap = await col.where('clienteId', '==', clientId).limit(40).get();
    return snap.docs;
  }
  try {
    const snap = await col.orderBy('createdAt', 'desc').limit(150).get();
    return snap.docs;
  } catch {
    const snap = await col.limit(150).get();
    return snap.docs;
  }
}

function ordersMatchingHints(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  opts: {
    clientHint: string;
    clientFold: string;
    productFold: string;
    amountHint: number;
    includeClosed: boolean;
    onlyClosed: boolean;
    withBalance?: boolean;
  }
): OrderStatusTarget[] {
  let open = ordersFromDocs(docs, '', opts.includeClosed);
  if (opts.onlyClosed) {
    open = open.filter((order) => isDeliveredEstado(resolveOrderEstado(order.estado)));
  }
  if (opts.withBalance) {
    const withSaldo = open.filter((order) => order.saldo > 0);
    if (withSaldo.length) open = withSaldo;
  }
  let hinted = open.filter((order) =>
    matchesOpenOrderHint(order, opts.clientFold, opts.productFold)
  );
  if (!hinted.length && opts.clientHint) {
    hinted = open.filter((order) => personNamesLookRelated(opts.clientHint, order.clientName));
  }
  if (opts.amountHint > 0) {
    const byAmount = hinted.filter((order) => matchesAmountHint(order, opts.amountHint));
    if (byAmount.length) {
      hinted = [...byAmount].sort(
        (a, b) => amountDistance(a, opts.amountHint) - amountDistance(b, opts.amountHint)
      );
    }
  }
  if (hinted.length) return hinted;
  if (!opts.clientFold && !opts.productFold && !(opts.amountHint > 0)) return open;
  return hinted;
}

/** Pedidos abiertos para cuando el dueño no recuerda el número. */
export async function listOpenOrdersForWhatsapp(
  businessId: string,
  options: OpenOrderListOptions = {}
): Promise<OrderStatusTarget[]> {
  const clientHint = String(options.clientHint ?? '').trim();
  const productHint = stripListNoise(String(options.productHint ?? '').trim());
  const amountHint = Number(options.amountHint) || 0;
  const cap = Math.min(8, Math.max(1, options.limit ?? 8));
  const mode = closedOrdersListMode(String(options.sourceText ?? ''));
  const onlyClosed = options.onlyClosed === true || mode === 'closed';
  const includeClosed = onlyClosed || mode === 'all' || (options.includeClosed === true && mode !== 'open');
  let productFold = foldSearch(productHint);
  if (isJunkProductHint(productFold)) productFold = '';

  const rankOpts = {
    clientHint,
    productFold,
    amountHint,
    includeClosed,
    onlyClosed,
    withBalance: options.withBalance,
  };

  const filter = parseOrderQueryFilter(String(options.sourceText ?? ''));
  const finish = (rows: OrderStatusTarget[]) => filterOrdersByQuery(rows, filter).slice(0, cap);

  if (clientHint) {
    const resolved = await resolveClientMatch(businessId, clientHint, { utterance: clientHint });
    if (resolved.status === 'unique') {
      const scoped = ordersMatchingHints(await loadPedidoDocs(businessId, resolved.client.id), {
        ...rankOpts,
        clientFold: '',
      });
      if (scoped.length) return finish(scoped);
    } else if (resolved.status === 'ambiguous' && resolved.candidates.length) {
      const bags = await Promise.all(
        resolved.candidates.slice(0, 6).map((candidate) => loadPedidoDocs(businessId, candidate.id))
      );
      const seen = new Set<string>();
      const uniqueDocs = bags.flat().filter((doc) => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
      });
      const scoped = ordersMatchingHints(uniqueDocs, { ...rankOpts, clientFold: '' });
      if (scoped.length) return finish(scoped);
    }
  }

  const docs = await loadPedidoDocs(businessId);
  const clientFold = foldSearch(clientHint);
  const rows = ordersMatchingHints(docs, { ...rankOpts, clientFold });
  return finish(rows);
}

/** Abiertos primero. Si no hay y pidió abiertos, muestra entregados del mismo cliente. */
export async function listWhatsappOrdersWithFallback(
  businessId: string,
  options: OpenOrderListOptions = {}
): Promise<{ items: OrderStatusTarget[]; closedFallback: boolean }> {
  const items = await listOpenOrdersForWhatsapp(businessId, options);
  if (items.length) return { items, closedFallback: false };
  const clientHint = String(options.clientHint ?? '').trim();
  if (!clientHint || options.onlyClosed === true) return { items, closedFallback: false };
  const filter = parseOrderQueryFilter(String(options.sourceText ?? ''));
  if (!filter.allowClosedFallback || filter.statusNotEquals) return { items, closedFallback: false };
  const mode = filter.listMode;
  if (mode === 'closed' || mode === 'all') return { items, closedFallback: false };
  const closed = await listOpenOrdersForWhatsapp(businessId, {
    ...options,
    onlyClosed: true,
    includeClosed: true,
  });
  return { items: closed, closedFallback: closed.length > 0 };
}

export function formatOpenOrderChoices(items: OrderStatusTarget[], ask: string): string {
  const lines = items.map((item, index) => {
    const product = item.productSummary ? ` · ${item.productSummary.slice(0, 36)}` : '';
    const estado = getOrderEstadoLabel(item.estado);
    const saldo = item.saldo > 0 ? `saldo $${money(item.saldo)}` : 'pago';
    return `${index + 1}) #${item.label} · ${item.clientName}${product} · ${estado} · ${saldo}`;
  });
  const hasClosed = items.some((item) => isDeliveredEstado(resolveOrderEstado(item.estado)));
  const allClosed =
    hasClosed && items.every((item) => isDeliveredEstado(resolveOrderEstado(item.estado)));
  return waCard({
    title: allClosed ? 'Pedidos entregados' : hasClosed ? 'Pedidos' : 'Pedidos abiertos',
    lines,
    ask,
  });
}

export function formatFindOrderGuide(opts?: {
  missed?: boolean;
  paymentAmount?: number;
  triedHint?: string;
  forQuery?: boolean;
}): string {
  const tried = String(opts?.triedHint ?? '').trim();
  const query = opts?.forQuery === true;
  const lines = [
    opts?.missed
      ? tried
        ? `No di con pedidos de *${tried}*.`
        : 'No di con ese. Probá con otro dato.'
      : query
        ? 'No hace falta el número si no te acordás.'
        : 'No hace falta el número si no te acordás.',
    'Pasame algo de esto:',
    '• el cliente (Sergio)',
    '• el producto (oversize)',
    '• el monto (500)',
    '• el estado (listo, entregado, pendiente)',
    '• o el # del pedido',
  ];
  if (opts?.paymentAmount && opts.paymentAmount > 0) {
    lines.push(`Tengo el pago de $${money(opts.paymentAmount)}.`);
  }
  return waCard({
    title: query || opts?.missed ? '¿Cuál pedido?' : '¿De qué pedido es?',
    lines,
    ask: query
      ? 'Con eso lo busco de nuevo.'
      : 'Con el número de la lista cobrás, lo asociás o le cambiás el *estado*.',
  });
}

export function formatOrderActionAsk(item: OrderStatusTarget): string {
  const lines = [
    `• Cliente: ${item.clientName}`,
    item.productSummary ? `• Producto: ${item.productSummary}` : '',
    `• Estado: ${getOrderEstadoLabel(item.estado)}`,
    item.total > 0 ? `• Total: $${money(item.total)}` : '',
    `• Saldo: ${item.saldo > 0 ? `$${money(item.saldo)}` : 'saldado'}`,
  ].filter(Boolean);
  return waCard({
    title: `Pedido #${item.label}`,
    lines,
    ask: `¿Qué hago?\n• *1* registrar un pago\n• *2* cambiar el estado`,
  });
}

export function formatOrderStatusAsk(item: OrderStatusTarget): string {
  return waCard({
    title: `Pedido #${item.label}`,
    lines: [`• Estado ahora: ${getOrderEstadoLabel(item.estado)}`],
    ask: `¿A cuál lo paso?\n• *1* pendiente\n• *2* en producción\n• *3* listo\n• *4* entregado`,
  });
}

export function formatPaymentAmountAsk(item: OrderStatusTarget): string {
  const saldo = item.saldo > 0 ? `$${money(item.saldo)}` : 'saldado';
  return waCard({
    title: `Pedido #${item.label}`,
    lines: [`• Cliente: ${item.clientName}`, `• Saldo: ${saldo}`],
    ask:
      item.saldo > 0
        ? '¿Cuánto cobro?\nUn monto, o *saldalo* para el total.'
        : 'Este pedido no tiene saldo. Decime un monto si cobrás igual.',
  });
}

export function formatSettleAsk(label: string, clientName: string, saldo: number): string {
  return waCard({
    title: '¿Cobro el saldo?',
    lines: [
      `• Pedido #${label}${clientName ? ` · ${clientName}` : ''}`,
      `• Voy a cobrar: $${money(saldo)} (entra a caja)`,
      '• El pedido queda en $0',
    ],
    ask: `${waBold('SÍ')} = cobro todo\nUn número = cobro esa plata\n${waBold('NO')} = no cobro, queda el saldo`,
  });
}

/** Un pedido cerrado no admite cambios de estado: conviene decirlo antes de pedir confirmación. */
export function closedOrderReason(estado: string): 'cancelado' | 'entregado' | null {
  if (isCancelledStatus(estado)) return 'cancelado';
  if (isDeliveredEstado(resolveOrderEstado(estado))) return 'entregado';
  return null;
}

/** Después de este rato, «marcalo listo» ya no puede referirse a lo de antes. */
const CONTEXT_TTL_MS = 12 * 60 * 60 * 1000;

function isFreshContext(at: unknown): boolean {
  const ts = Date.parse(String(at ?? ''));
  return Number.isFinite(ts) && Date.now() - ts < CONTEXT_TTL_MS;
}

/** El pedido recordado solo sirve si sigue abierto; si no, mejor preguntar. */
async function openTargetById(
  businessId: string,
  id: string,
  fallbackClient = ''
): Promise<OrderStatusTarget | null> {
  if (!id) return null;
  const snap = await db.doc(`negocios/${businessId}/pedidos/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (closedOrderReason(String(data.estado ?? ''))) return null;
  return targetFromDoc(snap.id, data, fallbackClient);
}

/** El pedido al que se le cambia el estado: número, cliente, «ese», o el último del chat. */
export async function resolveOrderForStatus(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<OrderStatusResolution> {
  const col = db.collection(`negocios/${businessId}/pedidos`);

  const targetId = String(entities.targetOrderId ?? '').trim();
  if (targetId) {
    const snap = await col.doc(targetId).get();
    if (snap.exists) return { status: 'unique', order: targetFromDoc(snap.id, snap.data() ?? {}) };
  }

  const orderNumber = String(entities.orderNumber ?? '').replace(/\D/g, '');
  if (orderNumber) {
    const numero = Number(orderNumber);
    const byNumero = await col.where('numeroPedido', '==', numero).limit(1).get();
    const found = byNumero.empty
      ? await col.where('numeroPedidoLabel', '==', formatOrderNumber(numero)).limit(1).get()
      : byNumero;
    const doc = found.docs[0];
    if (doc) return { status: 'unique', order: targetFromDoc(doc.id, doc.data()) };
    return { status: 'none' };
  }

  const state = await getConversationState(businessId, phone);
  const locked = lockedOrderFromFocus(state?.focusOrder);
  const source = String(entities.sourceText ?? '');
  if (locked && shouldUseLockedOrder(source, entities, locked)) {
    const snap = await col.doc(locked.id).get();
    if (snap.exists) {
      return { status: 'unique', order: targetFromDoc(snap.id, snap.data() ?? {}, String(locked.clientName ?? '')) };
    }
  }

  const clientQuery = String(entities.clientName ?? '').trim();
  if (clientQuery) {
    const resolved = await resolveClientMatch(businessId, clientQuery, {
      utterance: String(entities.sourceText ?? clientQuery),
    });
    if (resolved.status === 'unique') {
      const snap = await col.where('clienteId', '==', resolved.client.id).limit(20).get();
      const open = openOrdersFrom(snap.docs, resolved.client.nombre);
      if (open.length === 1) return { status: 'unique', order: open[0]! };
      if (open.length > 1) return { status: 'ambiguous', candidates: open.slice(0, 5) };
    }
    if (resolved.status === 'ambiguous' && resolved.candidates.length) {
      const bags = await Promise.all(
        resolved.candidates.slice(0, 6).map(async (candidate) => {
          const snap = await col.where('clienteId', '==', candidate.id).limit(20).get();
          return snap.docs;
        })
      );
      const open = openOrdersFrom(bags.flat());
      if (open.length === 1) return { status: 'unique', order: open[0]! };
      if (open.length > 1) return { status: 'ambiguous', candidates: open.slice(0, 5) };
    }
    const listed = await listOpenOrdersForWhatsapp(businessId, {
      clientHint: clientQuery,
      sourceText: String(entities.sourceText ?? ''),
      limit: 5,
    });
    if (listed.length === 1) return { status: 'unique', order: listed[0]! };
    if (listed.length > 1) return { status: 'ambiguous', candidates: listed };
    return { status: 'none' };
  }

  const focus = state?.focusOrder;
  if (focus?.id && isFreshContext(focus.at)) {
    const focused = await openTargetById(businessId, focus.id, String(focus.clientName ?? ''));
    if (focused) return { status: 'unique', order: focused };
  }
  const last: LastWhatsappOperation | null | undefined = state?.lastOperation;
  if (last?.kind === 'order' && last.id && isFreshContext(last.at)) {
    const fromLast = await openTargetById(businessId, last.id, String(last.clientName ?? ''));
    if (fromLast) return { status: 'unique', order: fromLast };
  }

  const waSnap = await col.where('whatsappPhone', '==', phone).limit(20).get();
  const open = openOrdersFrom(waSnap.docs);
  if (open.length === 1) return { status: 'unique', order: open[0]! };
  if (open.length > 1) return { status: 'ambiguous', candidates: open.slice(0, 5) };
  return { status: 'none' };
}

/** Qué va a pasar si confirma, para mostrarlo antes de tocar stock y caja. */
export async function previewOrderStatusChange(
  businessId: string,
  target: OrderStatusTarget,
  nextEstado: WhatsappOrderStatus
): Promise<{
  estadoLabel: string;
  previousLabel: string;
  stockWillDrop: boolean;
  stockAlreadyDropped: boolean;
  hasStockLines: boolean;
  sameEstado: boolean;
}> {
  const config = await loadOrderPedidosConfig(businessId);
  const previous = resolveOrderEstado(target.estado);
  const next = resolveOrderEstado(nextEstado);
  const snap = await db.doc(`negocios/${businessId}/pedidos/${target.id}`).get();
  const order = (snap.data() ?? {}) as OrderRecord;

  const crosses = shouldConsumeStockOnStatusChange({
    previousEstado: previous,
    nextEstado: next,
    triggerEstado: config.estadoDescuentaStock,
    stockDescontado: order.stockDescontado ?? false,
    stockFullyConsumed: orderStockFullyConsumed(stockLines(order)),
    estados: config.estados,
  });
  const isDelivery = isDeliveredEstado(next) && !isDeliveredEstado(previous);
  const hasStockLines = stockLines(order).some((line) => line.controlaStock === true);
  const stockPending =
    hasStockLines &&
    !(order.stockDescontado ?? false) &&
    !orderStockFullyConsumed(stockLines(order));
  const nextRank = getOrderStockDiscountRank(next, config.estados);
  const triggerRank = getOrderStockDiscountRank(config.estadoDescuentaStock, config.estados);
  const atOrPastTrigger = triggerRank >= 0 && nextRank >= triggerRank;
  const stockWillDrop =
    hasStockLines &&
    (crosses || (isDelivery && !order.stockDescontado) || (stockPending && atOrPastTrigger));

  return {
    estadoLabel: getOrderEstadoLabel(nextEstado, config.estados),
    previousLabel: getOrderEstadoLabel(target.estado, config.estados),
    stockWillDrop,
    stockAlreadyDropped: hasStockLines && Boolean(order.stockDescontado) && !stockWillDrop,
    hasStockLines,
    sameEstado: previous === next,
  };
}

/**
 * Cambia el estado del pedido con la misma lógica del panel: descuenta stock cuando
 * cruza el estado disparador, y en la entrega crea la venta y liquida el saldo.
 */
export async function updateOrderStatusFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{
  reply: string;
  orderId: string;
  label: string;
  clientName: string;
  clientId: string;
  amount: number;
  status: string;
  needsStockDecision?: StockDiscountAsk;
}> {
  const nextEstadoValue: WhatsappOrderStatus = entities.orderStatus ?? 'listo';
  const resolution = await resolveOrderForStatus(tenant.businessId, tenant.phone, entities);
  if (resolution.status === 'ambiguous') {
    throw new Error(
      `Tenés varios pedidos abiertos: ${resolution.candidates
        .map((item) => `#${item.label}`)
        .join(', ')}. Decime cuál.`
    );
  }
  if (resolution.status !== 'unique') {
    throw new Error(
      'No encontré el pedido. Decime el número (#00223) o el cliente, y lo marco.'
    );
  }
  const target = resolution.order;

  const orderRef = db.doc(`negocios/${tenant.businessId}/pedidos/${target.id}`);
  const snap = await orderRef.get();
  if (!snap.exists) throw new Error('No encontré ese pedido.');
  const order = snap.data() as OrderRecord;

  if (isCancelledStatus(order.estado)) {
    throw new Error(`El pedido #${target.label} está cancelado.`);
  }

  const previousEstado = resolveOrderEstado(order.estado);
  const nextEstado = resolveOrderEstado(nextEstadoValue);

  if (isDeliveredEstado(previousEstado)) {
    if (isDeliveredEstado(nextEstado)) {
      return {
        orderId: target.id,
        label: target.label,
        clientName: target.clientName,
        clientId: target.clientId,
        amount: target.total,
        status: nextEstadoValue,
        reply: `El pedido #${target.label} ya estaba entregado.`,
      };
    }
    throw new Error(`El pedido #${target.label} ya estaba entregado y cerrado.`);
  }

  const config = await loadOrderPedidosConfig(tenant.businessId);
  const trigger = config.estadoDescuentaStock;
  const merged: OrderRecord = { ...order };
  let stockDescontado = order.stockDescontado ?? false;
  let stockPatch: Partial<OrderRecord> = {};
  let stockWarning: string | undefined;
  const hasStockLines = stockLines(merged).some((line) => line.controlaStock === true);
  const stockPending =
    hasStockLines && !stockDescontado && !orderStockFullyConsumed(stockLines(merged));
  const nextRank = getOrderStockDiscountRank(nextEstado, config.estados);
  const triggerRank = getOrderStockDiscountRank(trigger, config.estados);
  const catchUpStock =
    stockPending && triggerRank >= 0 && nextRank >= triggerRank;

  if (previousEstado === nextEstado && !catchUpStock) {
    return {
      orderId: target.id,
      label: target.label,
      clientName: target.clientName,
      clientId: target.clientId,
      amount: target.total,
      status: nextEstadoValue,
      reply: `El pedido #${target.label} ya estaba en ${getOrderEstadoLabel(
        nextEstadoValue,
        config.estados
      )}.`,
    };
  }

  const transition = validateOrderEstadoTransition({
    previousEstado: order.estado,
    nextEstado: nextEstadoValue,
    triggerEstado: trigger,
    stockDescontado,
    estados: config.estados,
  });
  if (!transition.allowed) {
    throw new Error(transition.error ?? 'No puedo hacer ese cambio de estado.');
  }

  if (transition.requiresStockRestore) {
    const rollback = await restoreStockForOrderEstadoRollback(
      tenant.businessId,
      target.id,
      merged,
      nextEstadoValue,
      config.estados
    );
    stockPatch = {
      items: rollback.items,
      stockDescontado: false,
      estadoStock: computeOrderStockStatus((rollback.items ?? []) as OrderLineStock[]),
    };
    Object.assign(merged, stockPatch);
    stockDescontado = false;
  }

  const crossesTrigger = shouldConsumeStockOnStatusChange({
    previousEstado,
    nextEstado,
    triggerEstado: trigger,
    stockDescontado,
    stockFullyConsumed: orderStockFullyConsumed(stockLines(merged)),
    estados: config.estados,
  });
  const chosenScope =
    parseRequestedStockScope(entities.descuentoFisicoAlcance) ??
    parseRequestedStockScope(entities.stockResolution);
  let appliedScope: OrderPhysicalStockScope | undefined;

  if (crossesTrigger || catchUpStock) {
    const preview = await buildOrderStockDiscountPreview(
      tenant.businessId,
      asStockRecord(merged),
      config,
      nextEstado
    );
    if (preview.blocked) {
      throw new Error(preview.blockReason ?? 'No podés guardar con este estado todavía.');
    }
    const ask = resolveStockDiscountAsk(preview);
    if (ask && !chosenScope) {
      return {
        orderId: target.id,
        label: target.label,
        clientName: target.clientName,
        clientId: target.clientId,
        amount: target.total,
        status: nextEstadoValue,
        reply: formatStockResolutionAsk(ask),
        needsStockDecision: ask,
      };
    }
    appliedScope = chosenScope ?? preview.defaultScope ?? resolveOrderPhysicalStockScope(config, nextEstado);
    try {
      const consumption = await consumeOrderStockOnStatusChange(
        tenant.businessId,
        target.id,
        asStockRecord(merged),
        {
          pedidosConfig: config,
          targetEstado: nextEstado,
          scope: appliedScope,
        }
      );
      stockPatch = {
        items: consumption.items,
        stockDescontado: consumption.stockDescontado,
        estadoStock: consumption.estadoStock,
        stockPreparado: consumption.stockPreparado ?? merged.stockPreparado,
      };
      Object.assign(merged, stockPatch);
      stockDescontado = consumption.stockDescontado;
      stockWarning = consumption.stockWarning;
    } catch (error) {
      if (isNoReservedUnitsStockError(error) && !chosenScope) {
        const fallbackAsk = resolveStockDiscountAsk({
          willConsume: preview.totalCompleto > 0,
          blocked: false,
          canChooseScope: preview.canChooseScope,
          requiresFullStock: preview.requiresFullStock,
          defaultScope: 'solo_reservado',
          totalReservado: 0,
          totalCompleto: preview.totalCompleto,
        }) ?? {
          reason: 'no_reserved_units' as const,
          options: ['pedido_completo' as const],
          defaultScope: 'pedido_completo' as const,
          totalReservado: 0,
          totalCompleto: preview.totalCompleto,
        };
        return {
          orderId: target.id,
          label: target.label,
          clientName: target.clientName,
          clientId: target.clientId,
          amount: target.total,
          status: nextEstadoValue,
          reply: formatStockResolutionAsk(fallbackAsk),
          needsStockDecision: fallbackAsk,
        };
      }
      throw error;
    }
  }

  const isDelivery = isDeliveredEstado(nextEstado) && !isDeliveredEstado(previousEstado);
  let deliveryPatch: Partial<OrderRecord> & {
    ventaLabel?: string;
    gananciaEstimada?: number;
  } = {};
  let entregaConSaldo: boolean | undefined;
  let cobrado = 0;

  if (isDelivery) {
    const deliveryConsumption = await consumeOrderStockOnDelivery(
      tenant.businessId,
      target.id,
      asStockRecord(merged)
    );
    stockPatch = {
      ...stockPatch,
      items: deliveryConsumption.items,
      stockDescontado: deliveryConsumption.stockDescontado,
      estadoStock: deliveryConsumption.estadoStock,
      stockPreparado: deliveryConsumption.stockPreparado ?? merged.stockPreparado,
    };
    Object.assign(merged, stockPatch);
    stockDescontado = deliveryConsumption.stockDescontado;
    if (deliveryConsumption.stockWarning) {
      stockWarning = stockWarning
        ? `${stockWarning}\n${deliveryConsumption.stockWarning}`
        : deliveryConsumption.stockWarning;
    }

    const saldoPrevio = Math.max(
      0,
      resolveOrderBalance(merged as Parameters<typeof resolveOrderBalance>[0]).saldo
    );
    // «ya pagó» cierra el pedido; si no dijo nada del pago, la entrega queda con saldo.
    const cobraTodo = entities.paid !== false && (entities.paid === true || saldoPrevio <= 0);
    if (cobraTodo) {
      deliveryPatch = await applyEntregaCompletaPayment(tenant.businessId, target.id, merged);
      entregaConSaldo = false;
      cobrado = saldoPrevio;
    } else {
      deliveryPatch = await applyEntregaConSaldoVenta(tenant.businessId, target.id, merged);
      entregaConSaldo = true;
    }
    Object.assign(merged, deliveryPatch);
  }

  const total = Number(merged.total) || 0;
  const updatePayload: Record<string, unknown> = {
    ...stockPatch,
    estado: isDelivery ? 'entregado' : nextEstadoValue,
    stockDescontado,
    gananciaEstimada: resolveOrderGananciaForStorage(
      total,
      Number(merged.costoReal) || 0,
      isDelivery ? 'entregado' : nextEstadoValue,
      deliveryPatch.gananciaEstimada
    ),
    updatedAt: new Date().toISOString(),
  };
  if (deliveryPatch.pagos) {
    updatePayload.pagos = deliveryPatch.pagos.map(sanitizePagoForFirestore);
    updatePayload.totalPagado = deliveryPatch.totalPagado;
    updatePayload.saldo = deliveryPatch.saldo;
    updatePayload.seniaBloqueada = deliveryPatch.seniaBloqueada;
  } else {
    if (deliveryPatch.saldo !== undefined) updatePayload.saldo = deliveryPatch.saldo;
    if (deliveryPatch.totalPagado !== undefined) {
      updatePayload.totalPagado = deliveryPatch.totalPagado;
    }
  }
  if (deliveryPatch.entregadoAt) updatePayload.entregadoAt = deliveryPatch.entregadoAt;
  if (deliveryPatch.ventaId) updatePayload.ventaId = deliveryPatch.ventaId;
  if (entregaConSaldo !== undefined) updatePayload.entregaConSaldo = entregaConSaldo;

  await orderRef.update(updatePayload);

  const estadoLabel = getOrderEstadoLabel(
    isDelivery ? 'entregado' : nextEstadoValue,
    config.estados
  );
  const stockDropped = Boolean(
    appliedScope || stockDescontado || crossesTrigger || catchUpStock || (isDelivery && stockDescontado)
  );
  const lines = [
    previousEstado === nextEstado
      ? `Pedido #${target.label} ya estaba ${estadoLabel}.`
      : 'Pedido actualizado ✅',
  ];
  if (previousEstado !== nextEstado) {
    lines.push(stockDropped ? `Estado: ${estadoLabel} · Stock descontado` : `Estado: ${estadoLabel}`);
  }
  if (isDelivery) {
    if (cobrado > 0) {
      lines.push(`Cobré el saldo de $${money(cobrado)} y quedó saldado.`);
    } else if (entregaConSaldo) {
      lines.push(`Queda saldo de $${money(Number(updatePayload.saldo) || target.saldo)}.`);
    }
  }
  if (stockWarning) lines.push(stockWarning);

  return {
    orderId: target.id,
    label: target.label,
    clientName: target.clientName,
    clientId: target.clientId,
    amount: total,
    status: isDelivery ? 'entregado' : nextEstadoValue,
    reply: lines.join('\n'),
  };
}
