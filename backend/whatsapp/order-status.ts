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
  computeOrderStockStatus,
  consumeOrderStockOnDelivery,
  consumeOrderStockOnStatusChange,
  orderStockFullyConsumed,
  type OrderLineStock,
  type OrderStockRecord,
} from '../utils/order-stock-reservations.ts';
import {
  getOrderEstadoLabel,
  getOrderStockDiscountRank,
  resolveOrderPhysicalStockScope,
  shouldConsumeStockOnStatusChange,
  validateOrderEstadoTransition,
} from '../utils/order-config.ts';
import { formatOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import { resolveOrderBalance } from '../../shared/order-balance.ts';
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
  limit?: number;
};

function hintTokens(value: string): string[] {
  return foldSearch(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !/^(del|los|las|una|con|por|para)$/.test(token));
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

/** Pedidos abiertos para cuando el dueño no recuerda el número. */
export async function listOpenOrdersForWhatsapp(
  businessId: string,
  options: OpenOrderListOptions = {}
): Promise<OrderStatusTarget[]> {
  const clientHint = String(options.clientHint ?? '').trim();
  const productHint = String(options.productHint ?? '').trim();
  const amountHint = Number(options.amountHint) || 0;
  const cap = Math.min(8, Math.max(1, options.limit ?? 8));
  const includeClosed = options.includeClosed === true;
  let scopedByClient = false;
  let clientId: string | undefined;

  if (clientHint) {
    const resolved = await resolveClientMatch(businessId, clientHint, { utterance: clientHint });
    if (resolved.status === 'unique') {
      clientId = resolved.client.id;
      scopedByClient = true;
    } else if (resolved.status === 'ambiguous' && resolved.candidates.length) {
      const bags = await Promise.all(
        resolved.candidates.slice(0, 6).map((candidate) => loadPedidoDocs(businessId, candidate.id))
      );
      const merged = bags.flat();
      const seen = new Set<string>();
      const uniqueDocs = merged.filter((doc) => {
        if (seen.has(doc.id)) return false;
        seen.add(doc.id);
        return true;
      });
      const clientFoldAmbiguous = '';
      let productFoldAmbiguous = foldSearch(productHint);
      if (
        /^(pedido|pedidos|saldo|pago|pagos|abierto|abiertos|pendiente|pendientes|con saldo|llego|llegó)$/.test(
          productFoldAmbiguous
        )
      ) {
        productFoldAmbiguous = '';
      }
      let openAmbiguous = ordersFromDocs(uniqueDocs, '', includeClosed);
      if (options.withBalance) {
        const withSaldo = openAmbiguous.filter((order) => order.saldo > 0);
        if (withSaldo.length) openAmbiguous = withSaldo;
      }
      let hintedAmbiguous = openAmbiguous.filter((order) =>
        matchesOpenOrderHint(order, clientFoldAmbiguous, productFoldAmbiguous)
      );
      if (amountHint > 0) {
        const byAmount = hintedAmbiguous.filter((order) => matchesAmountHint(order, amountHint));
        if (byAmount.length) {
          hintedAmbiguous = [...byAmount].sort(
            (a, b) => amountDistance(a, amountHint) - amountDistance(b, amountHint)
          );
        }
      }
      return (hintedAmbiguous.length ? hintedAmbiguous : openAmbiguous).slice(0, cap);
    }
  }

  const docs = await loadPedidoDocs(businessId, clientId);
  const clientFold = scopedByClient ? '' : foldSearch(clientHint);
  let productFold = foldSearch(productHint);
  if (
    /^(pedido|pedidos|saldo|pago|pagos|abierto|abiertos|pendiente|pendientes|con saldo|llego|llegó)$/.test(
      productFold
    )
  ) {
    productFold = '';
  }
  let open = ordersFromDocs(docs, '', includeClosed);
  if (options.withBalance) {
    const withSaldo = open.filter((order) => order.saldo > 0);
    if (withSaldo.length) open = withSaldo;
  }

  let hinted = open.filter((order) => matchesOpenOrderHint(order, clientFold, productFold));
  if (!hinted.length && clientHint && !scopedByClient) {
    hinted = open.filter((order) => personNamesLookRelated(clientHint, order.clientName));
  }
  if (amountHint > 0) {
    const byAmount = hinted.filter((order) => matchesAmountHint(order, amountHint));
    if (byAmount.length) {
      hinted = [...byAmount].sort(
        (a, b) => amountDistance(a, amountHint) - amountDistance(b, amountHint)
      );
    }
  }

  const rows =
    productFold && hinted.length
      ? hinted
      : scopedByClient
        ? hinted.length
          ? hinted
          : open
        : clientFold || productFold || amountHint > 0
          ? hinted
          : open;
  return rows.slice(0, cap);
}

export function formatOpenOrderChoices(items: OrderStatusTarget[], ask: string): string {
  const lines = items.map((item, index) => {
    const product = item.productSummary ? ` · ${item.productSummary.slice(0, 36)}` : '';
    const saldo = item.saldo > 0 ? ` · saldo $${money(item.saldo)}` : ' · pago';
    return `${index + 1}) #${item.label} · ${item.clientName}${product}${saldo}`;
  });
  const hasClosed = items.some((item) => isDeliveredEstado(resolveOrderEstado(item.estado)));
  return waCard({
    title: hasClosed ? 'Pedidos' : 'Pedidos abiertos',
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
      : 'Con el número de la lista cobrás, lo asociás o lo marcás *listo*.',
  });
}

export function formatOrderActionAsk(item: OrderStatusTarget): string {
  const lines = [
    `• Cliente: ${item.clientName}`,
    item.productSummary ? `• Producto: ${item.productSummary}` : '',
    `• Saldo: ${item.saldo > 0 ? `$${money(item.saldo)}` : 'saldado'}`,
  ].filter(Boolean);
  const ask =
    item.saldo > 0
      ? `¿Qué hago?\n• *listo*\n• *saldalo* (entra a caja)\n• *pagó 500*`
      : `¿Lo marco *listo*?`;
  return waCard({
    title: `Pedido #${item.label}`,
    lines,
    ask,
  });
}

export function formatSettleAsk(label: string, clientName: string, saldo: number): string {
  return waCard({
    title: '¿Lo saldo?',
    lines: [
      `• Pedido #${label}${clientName ? ` · ${clientName}` : ''}`,
      `• Saldo: $${money(saldo)}`,
    ],
    ask: `${waBold('SÍ')} cobra todo a caja\nUn número = cobro esa plata\n${waBold('NO')} = queda el saldo`,
  });
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
      const recent = ordersFromDocs(snap.docs, resolved.client.nombre, true);
      if (recent.length === 1) return { status: 'unique', order: recent[0]! };
      if (recent.length > 1) return { status: 'ambiguous', candidates: recent.slice(0, 5) };
      return { status: 'none' };
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
      includeClosed: true,
      limit: 5,
    });
    if (listed.length === 1) return { status: 'unique', order: listed[0]! };
    if (listed.length > 1) return { status: 'ambiguous', candidates: listed };
    return { status: 'none' };
  }

  const state = await getConversationState(businessId, phone);
  const last: LastWhatsappOperation | null | undefined = state?.lastOperation;
  if (last?.kind === 'order' && last.id) {
    const snap = await col.doc(last.id).get();
    if (snap.exists) {
      return {
        status: 'unique',
        order: targetFromDoc(snap.id, snap.data() ?? {}, String(last.clientName ?? '')),
      };
    }
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
  amount: number;
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
      amount: target.total,
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
  if (crossesTrigger || catchUpStock) {
    const consumption = await consumeOrderStockOnStatusChange(
      tenant.businessId,
      target.id,
      asStockRecord(merged),
      {
        pedidosConfig: config,
        targetEstado: nextEstado,
        scope: resolveOrderPhysicalStockScope(config, nextEstado),
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
  const parts = [
    previousEstado === nextEstado
      ? `Pedido #${target.label} de ${target.clientName}: ya estaba ${estadoLabel}.`
      : `Listo. Pedido #${target.label} de ${target.clientName}: ${estadoLabel}.`,
  ];
  if (crossesTrigger || catchUpStock || (isDelivery && stockDescontado)) {
    parts.push('Descontado del stock.');
  }
  if (isDelivery) {
    if (cobrado > 0) {
      parts.push(`Cobré el saldo de $${money(cobrado)} y quedó saldado.`);
    } else if (entregaConSaldo) {
      parts.push(`Queda saldo de $${money(Number(updatePayload.saldo) || target.saldo)}.`);
    }
    if (deliveryPatch.ventaLabel) parts.push(`Venta #${deliveryPatch.ventaLabel}.`);
  }
  if (stockWarning) parts.push(stockWarning);

  return {
    orderId: target.id,
    label: target.label,
    clientName: target.clientName,
    amount: total,
    reply: parts.join(' '),
  };
}
