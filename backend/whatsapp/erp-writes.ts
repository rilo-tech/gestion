import { db } from '../firebase.ts';
import { allocateOrderNumber, formatOrderNumber } from '../utils/order-number.ts';
import { allocateSaleNumber } from '../utils/sale-number.ts';
import { enrichOrderItemsStockControl } from '../utils/order-stock-reservations.ts';
import { normalizeTransactionDateToIso } from '../utils/transaction-date.ts';
import { computeComprobanteSaldoPendiente } from '../../shared/comprobantes-config.ts';
import {
  collectClientBalance,
  getClientPendingDebts,
} from '../utils/client-collections.ts';
import {
  normalizeOrderPhotos,
  uploadOrderPhoto,
  type OrderPhotoRecord,
} from '../utils/order-photos.ts';
import { downloadWhatsappMedia } from './meta-api.ts';
import { findClientByName, findStockItemByName, isGenericWhatsappNotes, resolveClientMatch, type ExtraCostItem } from './lookups.ts';
import { clientLookupQuery } from './entity-name.ts';
import { planRelatedOrderFinance } from './order-finance.ts';
import { resolveOrderGananciaForStorage } from '../routes/orders.ts';
import { whatsappCopyForRubro } from './copy.ts';
import type { WhatsappCommandEntities, WhatsappPurchaseLine } from './ai-command-parser.ts';
import { ensureOrderItems } from './turn-interpreter.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { parsePurchaseInput, persistPurchase, persistPurchaseDraft } from '../utils/purchase-finance.ts';
import { productControlsStock } from '../utils/stock-product.ts';
import {
  findMedioPagoInConfig,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
} from '../utils/finance-config.ts';
import { loadPurchasePaymentContext, matchMedioFromText, purchasePanelUrl } from './purchase-payment.ts';
import { assertCanCreateClient, assertCanCreateProduct } from '../auth/usage-gates.ts';
import { formatClientNombreConCel } from './client-identity.ts';
import { normalizeLineExtraCosts, sumLineExtraCosts } from '../utils/line-extra-costs.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { normalizeOrderPedidosConfig, getOrderEstadoLabel } from '../utils/order-config.ts';
import { getConversationState, type LastWhatsappOperation } from './conversation-state.ts';
import { waCard } from '../../shared/whatsapp-format.ts';
import { looksLikeCashBalanceQuery } from '../../shared/whatsapp-copy.ts';
import { updateOrderStatusFromWhatsapp } from './order-status.ts';
import {
  assertNoUndefinedDeep,
  stripUndefinedDeep,
  toFirestoreCashMovement,
  toFirestoreOrder,
  toFirestoreOrderItem,
  toFirestorePayment,
} from './firestore-mappers.ts';
import {
  getBusinessCashAmbitoId,
  getCashAmbitoLabelFromCaja,
  normalizeMovementAmbito,
} from '../utils/caja-ambitos.ts';
import { loadWhatsappCajaAmbitos, resolveSpokenCashAmbito } from './cash-ambito.ts';
import { calendarDayAr, cashCommandFromOperation } from './semantic-command.ts';
import { isLlmFirstEngine } from './engine-version.ts';
import {
  getCashBalance,
  getCashDayTotals,
  getCashMovements,
  isCashDomainError,
  registerCashMovement,
  type RegisterCashMovementCommand,
} from '../domain/cash/index.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function whatsappDetailDescription(entities: WhatsappCommandEntities): string {
  const notes = String(entities.notes ?? '').trim();
  if (notes && !isGenericWhatsappNotes(notes)) return notes;
  return 'Origen: WhatsApp RILO Bot';
}

async function resolveClient(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<{ id: string; nombre: string } | null> {
  const clientId = String(entities.clientId ?? '').trim();
  if (clientId) {
    const snap = await db.doc(`negocios/${businessId}/clientes/${clientId}`).get();
    if (!snap.exists) return null;
    const data = snap.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) return null;
    return {
      id: snap.id,
      nombre: String(data.nombre ?? entities.clientName ?? '').trim() || 'Cliente',
    };
  }

  const name = clientLookupQuery(entities);
  if (!name) return null;
  return findClientByName(businessId, name);
}

async function buildLineItems(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<{
  items: Array<{
    stockItemId: string;
    nombre: string;
    cantidad: number;
    precioVenta: number;
    costoUnitario: number;
    precioUnitario: number;
    subtotal: number;
    tipoLinea: 'producto' | 'concepto';
    mueveStock: boolean;
    costosExtra?: ExtraCostItem[];
    costoPersonalizacion?: number;
  }>;
  total: number;
}> {
  type BuiltLine = {
    stockItemId: string;
    nombre: string;
    cantidad: number;
    precioVenta: number;
    costoUnitario: number;
    precioUnitario: number;
    subtotal: number;
    tipoLinea: 'producto' | 'concepto';
    mueveStock: boolean;
  };

  const orderRows = ensureOrderItems(entities).filter((item) => !item.skipped);
  const sharedAmount = Number(entities.amount) || 0;

  const buildOne = async (input: {
    productId?: string;
    productName: string;
    quantity: number;
    unitPrice?: number | null;
    asConcept?: boolean;
    shareTotal: boolean;
  }): Promise<BuiltLine> => {
    const quantity = Math.max(1, Number(input.quantity) || 1);
    const productName = String(input.productName ?? '').trim();
    const explicit = Number(input.unitPrice) || 0;
    if (productName && input.productId && !input.asConcept) {
      const snap = await db.doc(`negocios/${businessId}/stock/${input.productId}`).get();
      if (snap.exists) {
        const data = snap.data() as {
          nombre?: string;
          precioVenta?: number;
          precio?: number;
          costo?: number;
          controlaStock?: boolean;
        };
        const nombre = String(data.nombre ?? productName).trim() || productName;
        const stockPrice = Number(data.precioVenta ?? data.precio) || 0;
        const unitPrice = explicit > 0 ? explicit : input.shareTotal && sharedAmount > 0 ? sharedAmount / quantity : stockPrice || sharedAmount;
        const precio = unitPrice > 0 ? unitPrice : stockPrice;
        const subtotal = precio * quantity;
        const controls = productControlsStock(data as Record<string, unknown>);
        return {
          stockItemId: snap.id,
          nombre,
          cantidad: quantity,
          precioVenta: precio,
          costoUnitario: Number(data.costo) || 0,
          precioUnitario: precio,
          subtotal,
          tipoLinea: 'producto' as const,
          mueveStock: controls,
        };
      }
    }
    if (productName && !input.asConcept) {
      const stock = await findStockItemByName(businessId, productName);
      if (stock) {
        const unitPrice = explicit > 0 ? explicit : input.shareTotal && sharedAmount > 0 ? sharedAmount / quantity : stock.precioVenta || sharedAmount;
        const precio = unitPrice > 0 ? unitPrice : stock.precioVenta;
        const subtotal = precio * quantity;
        const stockSnap = await db.doc(`negocios/${businessId}/stock/${stock.id}`).get();
        const controls = productControlsStock(
          (stockSnap.data() ?? {}) as Record<string, unknown>
        );
        return {
          stockItemId: stock.id,
          nombre: stock.nombre,
          cantidad: quantity,
          precioVenta: precio,
          costoUnitario: stock.costo,
          precioUnitario: precio,
          subtotal,
          tipoLinea: 'producto' as const,
          mueveStock: controls,
        };
      }
    }
    const label =
      productName ||
      String(entities.notes ?? '').trim().slice(0, 80) ||
      String(entities.imageSummary ?? '').trim().slice(0, 80) ||
      'Concepto WhatsApp';
    const unit = explicit > 0 ? explicit : input.shareTotal && sharedAmount > 0 ? sharedAmount / quantity : 0;
    return {
      stockItemId: '',
      nombre: label,
      cantidad: quantity,
      precioVenta: unit,
      costoUnitario: 0,
      precioUnitario: unit,
      subtotal: unit * quantity,
      tipoLinea: 'concepto',
      mueveStock: false,
    };
  };

  if (orderRows.length) {
    const built: BuiltLine[] = [];
    for (const row of orderRows) {
      built.push(
        await buildOne({
          productId: row.productId || (orderRows.length === 1 ? entities.productId : undefined),
          productName: String(row.productName || row.productHint || row.rawText || entities.productName || '').trim(),
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          asConcept: row.tipoLinea === 'concepto' || entities.productAsConcept,
          shareTotal: orderRows.length === 1,
        })
      );
    }
    const total = built.reduce((sum, line) => sum + line.subtotal, 0);
    return { items: built, total };
  }

  const fallback = await buildOne({
    productId: entities.productId,
    productName: String(entities.productName ?? '').trim(),
    quantity: Math.max(1, Number(entities.quantity) || 1),
    shareTotal: true,
    asConcept: entities.productAsConcept,
  });
  return { items: [fallback], total: fallback.subtotal };
}

function attachExtraCostsToItems<T extends { nombre?: string; cantidad?: number; costosExtra?: ExtraCostItem[]; costoPersonalizacion?: number }>(
  items: T[],
  extraCosts: ExtraCostItem[] | undefined,
  productHint?: string,
  targetIndex?: number
): T[] {
  if (!items.length || !extraCosts?.length) return items;
  const hint = String(productHint ?? '').trim().toLowerCase();
  let index =
    Number.isInteger(targetIndex) && Number(targetIndex) >= 0 && Number(targetIndex) < items.length
      ? Number(targetIndex)
      : hint
        ? items.findIndex((line) => String(line.nombre ?? '').toLowerCase().includes(hint))
        : 0;
  const target = index >= 0 ? index : 0;
  return items.map((line, i) => {
    if (i !== target) return line;
    const qty = Math.max(1, Number(line.cantidad) || 1);
    const extras = [
      ...normalizeLineExtraCosts(line.costosExtra, line.costoPersonalizacion, qty),
      ...extraCosts.filter((item) => item.costo > 0),
    ];
    return {
      ...line,
      costosExtra: extras,
      costoPersonalizacion: sumLineExtraCosts(qty, extras),
    };
  });
}

function computeItemsCostoReal(
  items: Array<{
    cantidad?: number;
    costoUnitario?: number;
    costosExtra?: ExtraCostItem[];
    costoPersonalizacion?: number;
  }>
): number {
  return Math.round(
    items.reduce((acc, line) => {
      const qty = Number(line.cantidad) || 0;
      const base = qty * (Number(line.costoUnitario) || 0);
      const extra = sumLineExtraCosts(qty, line.costosExtra, line.costoPersonalizacion);
      return acc + base + extra;
    }, 0) * 100
  ) / 100;
}

async function loadPedidosConfig(businessId: string) {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const pedidos = (snap.data()?.pedidos as Record<string, unknown>) ?? {};
  return normalizeOrderPedidosConfig(pedidos);
}

export async function loadBusinessOrderExtraCostsEnabled(businessId: string): Promise<boolean> {
  const config = await loadPedidosConfig(businessId);
  return config.costosPersonalizacionDetallados !== false;
}

function matchCostPreset(
  presets: Array<{ nombre: string; costo: number }>,
  name: string
): { nombre: string; costo: number } | null {
  const query = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!query) return null;
  const hits = presets.filter((preset) => {
    const label = preset.nombre
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return label === query || label.includes(query) || query.includes(label);
  });
  return hits.length === 1 ? hits[0]! : hits.find((p) => p.nombre.toLowerCase() === query) ?? null;
}

export async function fillExtraCostsFromPresets(
  businessId: string,
  extraCosts: ExtraCostItem[] | undefined
): Promise<ExtraCostItem[]> {
  const list = [...(extraCosts ?? [])];
  const config = await loadPedidosConfig(businessId);
  const presets = config.costosExtraPredeterminados ?? [];
  if (!presets.length) return list.filter((item) => item.costo > 0 || item.nombre.trim());
  return list.map((item) => {
    const preset = matchCostPreset(presets, item.nombre);
    if (!preset) return item;
    return {
      nombre: item.nombre.trim() && item.nombre !== 'Costo extra' ? item.nombre : preset.nombre,
      costo: item.costo > 0 ? item.costo : Number(preset.costo) || 0,
    };
  }).filter((item) => item.nombre.trim());
}

async function attachWhatsappPhotoToOrder(
  businessId: string,
  orderId: string,
  mediaId: string | undefined
): Promise<OrderPhotoRecord | null> {
  if (!mediaId) return null;
  const media = await downloadWhatsappMedia(mediaId);
  if (!media) return null;

  let contentType = media.contentType;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    contentType = 'image/jpeg';
  }

  const photo = await uploadOrderPhoto(
    businessId,
    orderId,
    media.buffer,
    contentType,
    'whatsapp-foto'
  );

  const orderRef = db.doc(`negocios/${businessId}/pedidos/${orderId}`);
  const snap = await orderRef.get();
  const existing = normalizeOrderPhotos(snap.data()?.fotos);
  await orderRef.update({ fotos: [...existing, photo] });
  return photo;
}

export async function createOrderFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  _raw: string
): Promise<{
  reply: string;
  orderId: string;
  label: string;
  clientName: string;
  clientId: string;
  amount: number;
  status: string;
}> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}". Creálo en el ERP o escribí el nombre exacto.`
        : `Indicá el cliente, por ejemplo: "${whatsappCopyForRubro(tenant.rubro).exampleOrder}".`
    );
  }

  const built = await buildLineItems(tenant.businessId, entities);
  if (built.total <= 0 && !entities.mediaId && !built.items.length) {
    throw new Error(
      'No pude determinar el monto. Incluí el importe, por ejemplo: "pedido para Juan $5000".'
    );
  }

  const extras = (await fillExtraCostsFromPresets(tenant.businessId, entities.extraCosts)).filter(
    (item) => item.costo > 0
  );
  const productTotal = built.total > 0 ? built.total : 0;
  const total = productTotal;
  const enriched = await enrichOrderItemsStockControl(
    tenant.businessId,
    built.items.map((line) => ({
      stockItemId: line.stockItemId,
      nombre: line.nombre,
      cantidad: line.cantidad,
      precioVenta: line.precioVenta,
      costoUnitario: line.costoUnitario,
      controlaStock: false,
      costosExtra: line.costosExtra ?? [],
      costoPersonalizacion: line.costoPersonalizacion ?? 0,
    }))
  );
  const attached = extras.length
    ? attachExtraCostsToItems(
        enriched,
        extras,
        entities.extraCostsProductHint,
        entities.extraCostsTargetItemIndex ?? (enriched.length <= 1 ? 0 : undefined)
      )
    : enriched;
  const orderItems = attached.map((line) => toFirestoreOrderItem(line));
  const costoReal = computeItemsCostoReal(orderItems);

  if (!entities.deliveryDate) {
    throw new Error('Falta la fecha de entrega.');
  }

  const fechaEntrega = normalizeTransactionDateToIso(entities.deliveryDate);
  const descripcion = whatsappDetailDescription(entities);

  const plan = planRelatedOrderFinance({
    amount: productTotal,
    extraCosts: extras,
    collectionAmount: entities.collectionAmount,
    seniaAmount: entities.seniaAmount,
    paid: entities.paid,
    payFullBalance: entities.payFullBalance,
    sourceText: entities.sourceText,
  });
  const cobro = plan.kind === 'none' ? 0 : plan.cobro;
  const medio = cobro > 0 ? await resolvePaymentMedio(tenant.businessId, entities) : null;

  const { createOrder } = await import('../domain/orders/orders-application-service.ts');
  const created = await createOrder({
    businessId: tenant.businessId,
    source: 'whatsapp',
    clientId: client.id,
    clientName: client.nombre,
    items: orderItems as never,
    total,
    costoReal,
    estado: 'pendiente',
    fechaEntrega,
    descripcion,
    seniaAmount: cobro,
    paymentMethod: medio?.id,
    actorPhone: tenant.phone,
    extras: {
      fotos: [],
      seniaBloqueada: cobro > 0,
    },
  });

  const label = created.numeroPedidoLabel || formatOrderNumber(created.numeroPedido ?? 0);
  const saldo = created.saldo;
  const orderRefId = created.orderId;

  let photoNote = '';
  try {
    const photo = await attachWhatsappPhotoToOrder(tenant.businessId, orderRefId, entities.mediaId);
    if (photo) photoNote = ' Adjunté la foto al pedido.';
  } catch (error) {
    console.warn('[whatsapp] No se pudo adjuntar foto al pedido:', error);
    photoNote = ' (No pude adjuntar la foto; el pedido igual quedó registrado.)';
  }

  const requested = entities.requestedStatus;
  if (requested && requested !== 'pendiente') {
    try {
      await updateOrderStatusFromWhatsapp(tenant, {
        ...entities,
        targetOrderId: orderRefId,
        orderStatus: requested,
        paid: false,
        payFullBalance: false,
        amount: undefined,
      });
    } catch (error) {
      console.error('[whatsapp] Pedido y cobro ok; falló el cambio de estado:', error);
      photoNote += ' El pedido y el cobro quedaron registrados, pero no pude cambiar el estado.';
    }
  }

  const estadoLine = requested
    ? `Estado: ${getOrderEstadoLabel(requested)} · Saldo: $${money(saldo)}`
    : cobro > 0
      ? `Pago: $${money(cobro)} · Saldo: $${money(saldo)}`
      : `Saldo: $${money(saldo)}`;

  const status = requested && requested !== 'pendiente' ? requested : 'pendiente';

  return {
    orderId: orderRefId,
    label,
    clientName: client.nombre,
    clientId: client.id,
    amount: total,
    status,
    reply: `Pedido registrado ✅\n${estadoLine}${photoNote}`.trim(),
  };
}

const ORDER_COST_BLOCKED = /cancelad|entregad/i;

export type OrderCostTarget = {
  id: string;
  label: string;
  clientName: string;
  blockedEstado?: string;
};

function orderCostTargetFromData(
  id: string,
  data: {
    estado?: unknown;
    numeroPedido?: unknown;
    numeroPedidoLabel?: unknown;
    clienteNombre?: unknown;
  },
  fallbackClient = ''
): OrderCostTarget {
  const estado = String(data.estado ?? '');
  return {
    id,
    label: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientName: String(data.clienteNombre ?? fallbackClient),
    ...(ORDER_COST_BLOCKED.test(estado) ? { blockedEstado: estado } : {}),
  };
}

export async function resolveOrderForCost(
  businessId: string,
  phone: string,
  entities: WhatsappCommandEntities
): Promise<OrderCostTarget | null> {
  if (entities.targetOrderId) {
    const snap = await db.doc(`negocios/${businessId}/pedidos/${entities.targetOrderId}`).get();
    if (!snap.exists) return null;
    return orderCostTargetFromData(snap.id, snap.data() ?? {});
  }

  const orderNumber = String(entities.orderNumber ?? '').replace(/\D/g, '');
  if (orderNumber) {
    const numero = Number(orderNumber);
    const label = formatOrderNumber(numero);
    const col = db.collection(`negocios/${businessId}/pedidos`);
    const byNumero = await col.where('numeroPedido', '==', numero).limit(1).get();
    const byLabel = byNumero.empty
      ? await col.where('numeroPedidoLabel', '==', label).limit(1).get()
      : byNumero;
    const doc = byLabel.docs[0];
    if (doc) return orderCostTargetFromData(doc.id, doc.data());
  }

  const clientQuery = String(entities.clientName ?? '').trim();
  if (clientQuery) {
    const resolved = await resolveClientMatch(businessId, clientQuery, {
      utterance: String(entities.sourceText ?? clientQuery),
    });
    if (resolved.status === 'unique') {
      const snap = await db
        .collection(`negocios/${businessId}/pedidos`)
        .where('clienteId', '==', resolved.client.id)
        .limit(12)
        .get();
      const open = [...snap.docs]
        .filter((doc) => !ORDER_COST_BLOCKED.test(String(doc.data().estado ?? '')))
        .sort((a, b) => String(b.data().createdAt ?? '').localeCompare(String(a.data().createdAt ?? '')));
      const doc = open[0];
      if (doc) {
        return orderCostTargetFromData(doc.id, doc.data(), resolved.client.nombre);
      }
    }
  }

  const state = await getConversationState(businessId, phone);
  const last: LastWhatsappOperation | null | undefined = state?.lastOperation;
  if (last?.kind === 'order' && last.id) {
    const snap = await db.doc(`negocios/${businessId}/pedidos/${last.id}`).get();
    if (snap.exists) {
      const target = orderCostTargetFromData(
        snap.id,
        snap.data() ?? {},
        String(last.clientName ?? '')
      );
      if (!target.blockedEstado) {
        if (last.label) target.label = last.label;
        return target;
      }
    }
  }

  const waSnap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('whatsappPhone', '==', phone)
    .limit(15)
    .get();
  const latest = [...waSnap.docs]
    .filter((doc) => !ORDER_COST_BLOCKED.test(String(doc.data().estado ?? '')))
    .sort((a, b) => String(b.data().createdAt ?? '').localeCompare(String(a.data().createdAt ?? '')))[0];
  if (!latest) return null;
  return orderCostTargetFromData(latest.id, latest.data());
}

export async function addOrderCostFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string; orderId: string; label: string; clientName: string; amount: number }> {
  const extras = (await fillExtraCostsFromPresets(tenant.businessId, entities.extraCosts)).filter(
    (item) => item.costo > 0
  );
  if (!extras.length) {
    throw new Error('Indicá el costo, por ejemplo: «costo estampado 200».');
  }

  const target = await resolveOrderForCost(tenant.businessId, tenant.phone, entities);
  if (!target) {
    throw new Error(
      'No encontré el pedido. Decime el número (#00223), el cliente, o cargá el pedido primero.'
    );
  }

  const ref = db.doc(`negocios/${tenant.businessId}/pedidos/${target.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese pedido.');
  const data = snap.data() ?? {};
  if (ORDER_COST_BLOCKED.test(String(data.estado ?? ''))) {
    throw new Error(`El pedido #${target.label} ya está ${String(data.estado ?? '')}. No le puedo sumar costos.`);
  }

  const items = Array.isArray(data.items) ? [...data.items] : [];
  if (!items.length) {
    throw new Error('Ese pedido no tiene productos para colgarle el costo.');
  }
  const nextItems = attachExtraCostsToItems(
    items as Array<{ nombre?: string; cantidad?: number; costosExtra?: ExtraCostItem[]; costoPersonalizacion?: number }>,
    extras,
    entities.extraCostsProductHint || entities.productName,
    entities.extraCostsTargetItemIndex
  );
  const costoReal = computeItemsCostoReal(nextItems);
  const total = Number(data.total) || 0;
  await ref.update({
    items: nextItems,
    costoReal,
    gananciaEstimada: resolveOrderGananciaForStorage(total, costoReal, String(data.estado ?? '')),
    updatedAt: new Date().toISOString(),
  });

  const detail = extras.map((item) => `${item.nombre} $${money(item.costo)}`).join(', ');
  return {
    orderId: target.id,
    label: target.label,
    clientName: target.clientName,
    amount: extras.reduce((acc, item) => acc + item.costo, 0),
    reply: waCard({
      title: 'Listo',
      lines: [
        `• Costo extra: ${detail}`,
        `• Pedido #${target.label}`,
        ...(target.clientName ? [`• Cliente: ${target.clientName}`] : []),
      ],
    }),
  };
}

export async function createSaleFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  _raw: string
): Promise<{
  reply: string;
  ventaId: string;
  label: string;
  clientName: string;
  amount: number;
}> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "venta a María $2500".'
    );
  }

  const built = await buildLineItems(tenant.businessId, entities);
  if (built.total <= 0) {
    throw new Error('Indicá el monto de la venta, por ejemplo: "venta a María $2500".');
  }

  const paid = entities.paid === true;
  const seniaVenta = Math.min(Math.max(0, Number(entities.seniaAmount) || 0), built.total);
  const montoCobrado = paid ? built.total : seniaVenta;
  const timestamp = normalizeTransactionDateToIso(entities.orderDate ?? new Date().toISOString());

  const { createMostradorSale } = await import('../domain/sales/create-mostrador-sale.ts');
  const result = await createMostradorSale({
    businessId: tenant.businessId,
    clienteId: client.id,
    items: built.items.map((line) => ({
      stockItemId: line.stockItemId,
      nombre: line.nombre,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario,
      subtotal: line.subtotal,
      costoUnitario: line.costoUnitario,
      tipoLinea: line.tipoLinea,
      mueveStock: line.mueveStock,
    })),
    total: built.total,
    montoCobrado,
    paymentMethodHint: entities.paymentMethod ?? null,
    notas: whatsappDetailDescription(entities),
    fechaIso: timestamp,
    source: 'whatsapp',
    whatsappPhone: tenant.phone,
    actorId: 'whatsapp',
  });

  const saldo = result.saldoPendiente;
  return {
    ventaId: result.ventaId,
    label: result.ventaLabel,
    clientName: client.nombre,
    amount: result.total,
    reply: waCard({
      title: 'Listo',
      lines: [
        `• Venta #${result.ventaLabel}`,
        `• Cliente: ${client.nombre}`,
        `• Total: $${money(result.total)}`,
        ...(result.montoCobrado > 0
          ? [`• Cobrado: $${money(result.montoCobrado)} (${result.medioPago})`]
          : []),
        ...(saldo > 0 ? [`• Saldo: $${money(saldo)}`] : ['• Cobrada']),
      ],
    }),
  };
}

type PendingDebtLike = { kind: 'pedido' | 'venta'; id: string; saldo: number; label: string };

function describeDebts(debts: PendingDebtLike[]): string {
  return debts
    .slice(0, 6)
    .map((debt) => `• ${debt.label}: $${money(debt.saldo)}`)
    .join('\n');
}

/** Medio de pago que dijo el dueño (transferencia, mercado pago…). Por defecto efectivo. */
async function resolvePaymentMedio(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<{ id: string; label: string }> {
  if (entities.paymentMedioId) {
    return {
      id: entities.paymentMedioId,
      label: entities.paymentMedioLabel || entities.paymentMedioId,
    };
  }
  const hint = String(
    entities.paymentHint ?? (isLlmFirstEngine() ? '' : entities.sourceText ?? '')
  ).trim();
  if (!hint) return { id: 'efectivo', label: 'Efectivo' };
  const ctx = await loadPurchasePaymentContext(businessId);
  const medio = matchMedioFromText(hint, ctx.medios);
  return medio ? { id: medio.id, label: medio.label } : { id: 'efectivo', label: 'Efectivo' };
}

/**
 * A qué pedido/venta va el cobro. Si es una seña tiene que ir a uno solo:
 * preguntamos antes que adivinar. Un cobro suelto se reparte del más viejo al más nuevo.
 */
async function resolvePaymentTarget(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  debts: PendingDebtLike[],
  isSenia: boolean
): Promise<PendingDebtLike | null> {
  const orderNumber = String(entities.orderNumber ?? '').replace(/\D/g, '');
  if (orderNumber) {
    const label = `Pedido #${formatOrderNumber(Number(orderNumber))}`;
    const hit = debts.find((debt) => debt.kind === 'pedido' && debt.label === label);
    if (!hit) {
      throw new Error(`${label} no tiene saldo pendiente.\nCon saldo tiene:\n${describeDebts(debts)}`);
    }
    return hit;
  }

  const targetId = String(entities.targetOrderId ?? '').trim();
  if (targetId) {
    const hit = debts.find((debt) => debt.id === targetId);
    if (hit) return hit;
  }

  if (debts.length === 1) return debts[0]!;

  const state = await getConversationState(tenant.businessId, tenant.phone);
  const last: LastWhatsappOperation | null | undefined = state?.lastOperation;
  if (last?.id) {
    const hit = debts.find((debt) => debt.id === last.id);
    if (hit && (entities.referToLast || isSenia)) return hit;
  }

  if (isSenia) {
    throw new Error(
      `¿A qué pedido le pongo la seña? Decime el número.\n${describeDebts(debts)}`
    );
  }
  return null;
}

export async function registerPaymentFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string; clientId: string; clientName: string; amount: number }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "seña de Juan $500".'
    );
  }

  const isSenia = entities.paymentKind === 'senia';
  const debts = await getClientPendingDebts(tenant.businessId, client.id);
  if (!debts.length) {
    throw new Error(`${client.nombre} no tiene saldo pendiente, así que no hay dónde imputarlo.`);
  }

  const target = await resolvePaymentTarget(tenant, entities, debts, isSenia);
  const amount =
    Number(entities.amount) > 0
      ? Number(entities.amount)
      : entities.payFullBalance
        ? target
          ? target.saldo
          : debts.reduce((acc, debt) => acc + debt.saldo, 0)
        : 0;
  if (amount <= 0) {
    throw new Error('Indicá el monto, por ejemplo: "seña de Juan $500".');
  }
  const medio = await resolvePaymentMedio(tenant.businessId, entities);

  const result = await collectClientBalance(tenant.businessId, client.id, {
    monto: amount,
    medioPago: medio.id,
    notas: `${isSenia ? 'Seña' : 'Cobro'} vía WhatsApp RILO Bot`,
    ...(target ? { target: { kind: target.kind, id: target.id } } : {}),
    tipo: isSenia ? 'seña' : 'pago',
  });

  const destino = result.allocations.map((item) => item.label).join(' + ');
  const restante = Math.max(0, result.saldoRestante);
  const saldoTxt = target
    ? `Queda un saldo de $${money(restante)} en ese pedido.`
    : `Saldo de ${client.nombre}: $${money(restante)}.`;

  return {
    reply: waCard({
      title: 'Listo',
      lines: [
        `• ${isSenia ? 'Seña' : 'Cobro'}: $${money(result.monto)}`,
        `• Cliente: ${client.nombre}`,
        ...(destino ? [`• En: ${destino}`] : []),
        `• Medio: ${medio.label}`,
        `• ${saldoTxt}`,
      ],
    }),
    clientId: client.id,
    clientName: client.nombre,
    amount,
  };
}

export async function queryBalanceFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const client = await resolveClient(tenant.businessId, entities);
  if (!client) {
    throw new Error(
      entities.clientName
        ? `No encontré el cliente "${entities.clientName}".`
        : 'Indicá el cliente, por ejemplo: "saldo de Pedro".'
    );
  }

  const debts = await getClientPendingDebts(tenant.businessId, client.id);
  const total = debts.reduce((acc, debt) => acc + debt.saldo, 0);
  if (total <= 0) {
    return {
      reply: `${client.nombre} no tiene saldo pendiente.`,
    };
  }

  return {
    reply: waCard({
      title: `Saldo de ${client.nombre}`,
      lines: [`Debe: *$${money(total)}*`],
    }),
  };
}

export async function createClientFromWhatsapp(
  businessId: string,
  nombre: string,
  extras?: { telefono?: string }
): Promise<{ id: string; nombre: string; telefono: string }> {
  const clean = String(nombre ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del cliente.');
  await assertCanCreateClient(businessId);
  const formatted = formatClientNombreConCel(clean, extras?.telefono);

  const docRef = await db.collection(`negocios/${businessId}/clientes`).add({
    nombre: formatted.nombre,
    activo: true,
    telefono: formatted.telefono,
    email: '',
    notas: 'Alta vía WhatsApp RILO Bot',
    origenWhatsapp: true,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre: formatted.nombre, telefono: formatted.telefono };
}

export async function createSupplierFromWhatsapp(
  businessId: string,
  nombre: string
): Promise<{ id: string; nombre: string }> {
  const clean = String(nombre ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del proveedor.');

  const docRef = await db.collection(`negocios/${businessId}/proveedores`).add({
    nombre: clean,
    activo: true,
    telefono: '',
    email: '',
    notas: 'Alta vía WhatsApp RILO Bot',
    origenWhatsapp: true,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre: clean };
}

/** Catálogo para pedidos/ventas (sin stock) o para compras (con control de stock). */
export async function createCatalogProductFromWhatsapp(
  businessId: string,
  input: { nombre: string; precioVenta?: number; costo?: number; controlaStock?: boolean }
): Promise<{ id: string; nombre: string; precioVenta: number }> {
  const nombre = String(input.nombre ?? '').trim();
  if (!nombre) throw new Error('Indicá el nombre del producto.');
  await assertCanCreateProduct(businessId);
  const precioVenta = Number(input.precioVenta) || 0;
  const costo = Number(input.costo) || 0;
  const controlaStock = input.controlaStock === true;

  const docRef = await db.collection(`negocios/${businessId}/stock`).add({
    nombre,
    precioVenta,
    precio: precioVenta,
    costo,
    precioSugerido: precioVenta,
    stockActual: 0,
    stockMinimo: 0,
    stockReservado: 0,
    controlaStock,
    permitirStockNegativo: false,
    activo: true,
    notas: controlaStock
      ? 'Alta vía WhatsApp RILO Bot (compra)'
      : 'Alta vía WhatsApp RILO Bot (sin control de stock)',
    origenWhatsapp: true,
    negocioId: businessId,
    createdAt: new Date().toISOString(),
  });

  return { id: docRef.id, nombre, precioVenta };
}

export async function updateProductCostFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string; productId: string; productName: string; amount: number }> {
  const productId = String(entities.productId ?? '').trim();
  const productName = String(entities.productName ?? '').trim();
  const costo = Number(entities.amount) || 0;
  if (!productId) {
    throw new Error('Indicá el producto del catálogo, por ejemplo: «el costo de Taza AA es 147».');
  }
  if (!(costo > 0)) {
    throw new Error('Indicá el nuevo costo, por ejemplo: «el costo de Taza AA es 147».');
  }
  const ref = db.doc(`negocios/${tenant.businessId}/stock/${productId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.activo === false) {
    throw new Error(`No encontré "${productName || 'ese producto'}" en el catálogo.`);
  }
  const nombre = String(snap.data()?.nombre ?? productName).trim() || productName;
  await ref.update({
    costo,
    updatedAt: new Date().toISOString(),
  });
  return {
    productId,
    productName: nombre,
    amount: costo,
    reply: waCard({
      title: 'Listo',
      lines: [
        `• Producto: ${nombre}`,
        `• Nuevo costo: $${money(costo)}`,
        'El stock no se tocó.',
      ],
    }),
  };
}

export async function queryCashTodayFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities?: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const source = isLlmFirstEngine() ? '' : String(entities?.sourceText ?? '');
  const todayOnly = isLlmFirstEngine()
    ? String(entities?.orderDate ?? '').slice(0, 10) === calendarDayAr()
    : /\b(hoy|vend[ií]|movimientos?|resumen)\b/i.test(source) && !looksLikeCashBalanceQuery(source);
  const wantList = entities?.listWantAll === true;

  const { ambitos } = await loadWhatsappCajaAmbitos(tenant.businessId);
  const spoken = entities ? resolveSpokenCashAmbito(entities, ambitos) : null;
  const ambitoId = spoken && ambitos.length > 1 ? spoken.id : entities?.cashAmbitoId;

  if (wantList) {
    const listed = await getCashMovements(tenant.businessId, { limit: 8, ambitoId });
    const items = Array.isArray(listed) ? listed : listed.items;
    if (!items.length) {
      return {
        reply: waCard({
          title: 'Movimientos',
          lines: ['No hay movimientos de caja.'],
        }),
      };
    }
    return {
      reply: waCard({
        title: 'Últimos movimientos',
        lines: items.map((row) => {
          const tipo = row.tipo === 'egreso' ? 'Egreso' : 'Ingreso';
          const concepto = String(row.concepto ?? '').trim() || tipo;
          return `• ${tipo} $${money(Number(row.monto) || 0)} · ${concepto}`;
        }),
      }),
    };
  }

  if (todayOnly) {
    const day = calendarDayAr();
    const totals = await getCashDayTotals(tenant.businessId, { day, ambitoId });
    return {
      reply: waCard({
        title: 'Caja de hoy',
        lines:
          totals.count === 0
            ? ['Hoy no hay movimientos.']
            : [
                `• Ingresos: $${money(totals.ingresos)}`,
                `• Egresos: $${money(totals.egresos)}`,
                `• Neto: $${money(totals.neto)}`,
                `• Movimientos: ${totals.count}`,
              ],
      }),
    };
  }

  const balance = await getCashBalance(tenant.businessId, { ambitoId });
  const rows = ambitoId
    ? balance.byAmbito.filter((row) => row.id === balance.scope)
    : balance.byAmbito;
  const lines =
    rows.length > 1
      ? [...rows.map((row) => `• ${row.label}: $${money(row.saldo)}`), '', `Neto: $${money(balance.saldo)}`]
      : [`• $${money(balance.saldo)}`];

  return {
    reply: waCard({
      title: 'Saldo de caja',
      lines: balance.empty
        ? ['Las cajas están en *$0*.']
        : lines,
    }),
  };
}

/** @deprecated Persistencia directa eliminada. Adapter de WhatsApp → CashDomainService. */
export async function executeRegisterCashMovement(
  tenant: WhatsappTenantContext,
  command: RegisterCashMovementCommand
): Promise<{ reply: string; scope?: string; movementId?: string }> {
  const tipo = command.type === 'egreso' ? 'egreso' : 'ingreso';
  const concepto =
    String(command.concept || '').trim() || (tipo === 'egreso' ? 'Egreso' : 'Ingreso');
  try {
    const created = await registerCashMovement({
      ...command,
      businessId: tenant.businessId,
      type: tipo,
      concept: concepto,
      medio: command.medio || 'efectivo',
      source: command.source ?? 'whatsapp',
      actor: command.actor ?? {
        type: 'whatsapp_user',
        phone: tenant.phone,
      },
      descripcion: command.descripcion ?? null,
    });
    const { caja, ambitos } = await loadWhatsappCajaAmbitos(tenant.businessId);
    const ambitoLabel = getCashAmbitoLabelFromCaja(created.scope, caja);
    return {
      reply: waCard({
        title: 'Listo',
        lines: [
          `• ${created.type === 'egreso' ? 'Egreso' : 'Ingreso'}: $${money(created.amount)}`,
          ...(ambitos.length > 1 ? [`• Caja: ${ambitoLabel}`] : []),
          `• ${created.concept}`,
        ],
      }),
      scope: created.scope,
      movementId: created.movementId,
    };
  } catch (error) {
    if (isCashDomainError(error) && error.code === 'INVALID_CASH_AMOUNT') {
      throw new Error('Indicá el monto del movimiento de caja.');
    }
    throw error;
  }
}

export async function registerCashFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities
): Promise<{ reply: string }> {
  const op =
    entities.semanticCommand?.operations.find((row) => row.intent === 'register_cash') ??
    entities.semanticCommand?.operations[0];
  const typed = op ? cashCommandFromOperation(tenant.businessId, { ...op, intent: 'register_cash' }, tenant.phone) : null;
  if (typed && !('error' in typed)) {
    return executeRegisterCashMovement(tenant, {
      ...typed,
      scope: entities.cashAmbitoId || typed.scope,
      concept: String(entities.cashConcept || typed.concept).trim() || typed.concept,
      idempotencyKey: entities.idempotencyKey || typed.idempotencyKey,
    });
  }
  if (typed && 'error' in typed) {
    throw new Error(typed.error);
  }
  const tipo = entities.cashType === 'egreso' ? 'egreso' : 'ingreso';
  const amount = Number(entities.amount) || 0;
  if (amount <= 0) {
    throw new Error('Indicá el monto del movimiento de caja.');
  }
  return executeRegisterCashMovement(tenant, {
    businessId: tenant.businessId,
    type: tipo,
    amount,
    concept: String(entities.cashConcept ?? entities.notes ?? '').trim() || (tipo === 'egreso' ? 'Egreso' : 'Ingreso'),
    scope: entities.cashAmbitoId,
    date: String(entities.orderDate || ''),
    source: 'whatsapp',
    actor: { type: 'whatsapp_user', phone: tenant.phone },
    idempotencyKey: entities.idempotencyKey,
  });
}


function purchaseLinesFromEntities(entities: WhatsappCommandEntities): WhatsappPurchaseLine[] {
  const existing = Array.isArray(entities.purchaseLines) ? entities.purchaseLines : [];
  if (existing.length) {
    return existing.filter((line) => {
      if (line.skipped) return false;
      const name = String(line.productName ?? line.invoiceName ?? '').trim();
      if (!name) return false;
      return Number(line.quantity) > 0;
    });
  }
  const name = String(entities.productName ?? '').trim();
  if (!name) return [];
  const quantity = Math.max(1, Number(entities.quantity) || 1);
  const amount = Number(entities.amount) || 0;
  const unitCost = amount > 0 ? amount / quantity : 0;
  return [
    {
      productName: name,
      invoiceName: name,
      productId: entities.productId,
      quantity,
      unitCost,
    },
  ];
}

export async function createPurchaseFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  raw: string
): Promise<{
  reply: string;
  compraId: string;
  draft?: boolean;
  label: string;
  clientName: string;
  amount: number;
}> {
  const supplierName = String(entities.supplierName ?? '').trim();
  if (!supplierName && !entities.supplierId) {
    throw new Error('Indicá el proveedor, por ejemplo: "compra a Distribuidora López" o mandá la foto de la factura.');
  }

  const lines = purchaseLinesFromEntities(entities);
  if (!lines.length) {
    throw new Error(
      'No pude leer los productos de la compra. Mandá la foto del remito/factura o el detalle (producto, cantidad y costo).'
    );
  }

  const cashAmbito = String(entities.cashAccountId ?? '').trim() || 'negocio';
  const items = await Promise.all(
    lines.map(async (line, index) => {
      const cantidad = Math.max(1, Number(line.quantity) || 1);
      const costoUnitario = Math.max(0, Number(line.unitCost) || 0);
      const importe = Math.round(cantidad * costoUnitario * 100) / 100;
      const descripcion = String(line.invoiceName ?? line.productName ?? '').trim();
      let tipoLinea = line.tipoLinea === 'insumo' ? ('insumo' as const) : ('stock' as const);
      const productId = String(line.productId ?? '').trim();
      if (productId && tipoLinea === 'stock') {
        const product = await getProduct(tenant.businessId, productId);
        if (product && product.controlsStock === false) {
          tipoLinea = 'insumo';
        }
      }
      if (tipoLinea === 'insumo') {
        return {
          id: `wa_${index + 1}`,
          tipoLinea: 'insumo' as const,
          ambito: cashAmbito,
          ...(productId ? { productoId: productId, productoNombre: line.productName } : {}),
          descripcion: descripcion || line.productName || 'Insumo / herramienta',
          // Conservar cantidad financiera (artículos del documento); stock = 0 vía afectaStock.
          cantidad,
          costoUnitario,
          importe,
          afectaStock: false,
          enOferta: false,
        };
      }
      if (!productId) {
        throw new Error(`Falta vincular el producto "${line.productName}" al catálogo.`);
      }
      return {
        id: `wa_${index + 1}`,
        tipoLinea: 'stock' as const,
        ambito: cashAmbito,
        productoId: productId,
        productoNombre: line.productName,
        descripcion: line.productName,
        cantidad,
        costoUnitario,
        importe,
        afectaStock: true,
        enOferta: false,
      };
    })
  );

  const saveAsDraft = entities.saveAsDraft === true;
  const finanzas = await loadFinanzasConfig(tenant.businessId);
  const explicitMedio = String(entities.paymentMedioId ?? '').trim();
  const pago = {
    medioPagoId: explicitMedio || 'efectivo',
    tarjetaId: String(entities.paymentTarjetaId ?? '').trim() || undefined,
    cuotas: Math.max(1, Number(entities.paymentCuotas) || 1),
    fechaPrimerVencimiento: String(entities.paymentDueDate ?? '').trim() || undefined,
  };
  console.info(
    '[purchase:payment:selected]',
    JSON.stringify({
      businessId: tenant.businessId,
      paymentMedioId: pago.medioPagoId,
      explicit: Boolean(explicitMedio),
      tarjetaId: pago.tarjetaId ?? null,
      cuotas: pago.cuotas,
    })
  );

  const parsed = await parsePurchaseInput(
    tenant.businessId,
    {
      proveedorId: entities.supplierId ?? '',
      proveedor: supplierName,
      notas: [
        String(entities.notes ?? '').trim() || raw.trim(),
        entities.imageSummary ? `Foto: ${entities.imageSummary}` : '',
        'Origen: WhatsApp RILO Bot',
      ]
        .filter(Boolean)
        .join(' · '),
      numeroComprobante: String(entities.invoiceNumber ?? '').trim(),
      tipoComprobante: 'factura',
      fecha: entities.orderDate ?? new Date().toISOString().slice(0, 10),
      items,
      pago,
      documentNetTotal: Number(entities.documentNetTotal) || undefined,
      documentTaxTotal: Number(entities.documentTaxTotal) || undefined,
      documentGrossTotal: Number(entities.documentGrossTotal ?? entities.amount) || undefined,
      priceTaxMode: entities.priceTaxMode,
      documentTaxRate: Number(entities.documentTaxRate) || undefined,
    },
    saveAsDraft ? { relaxed: true, finanzas } : { finanzas }
  );

  if (parsed.error || !parsed.input) {
    throw new Error(parsed.error || 'No pude armar la compra.');
  }

  if (saveAsDraft) {
    const saved = await persistPurchaseDraft(tenant.businessId, parsed.input);
    const url = purchasePanelUrl(saved.id, true);
    return {
      compraId: saved.id,
      draft: true,
      label: saved.compraLabel,
      clientName: supplierName,
      amount: parsed.input.total,
      reply:
        `Guardé un borrador de compra a ${supplierName || 'proveedor'} por $${money(parsed.input.total)}.\n` +
        `No moví stock ni caja.\n` +
        `Completalo en el panel (pago y confirmar):\n${url}`,
    };
  }

  const timestamp = new Date().toISOString();
  const stockItems = items.filter(
    (line): line is typeof line & { productoId: string } =>
      line.tipoLinea === 'stock' && Boolean(line.productoId)
  );
  if (stockItems.length) {
    await Promise.all(
      stockItems.map((line) =>
        db.doc(`negocios/${tenant.businessId}/stock/${line.productoId}`).update({
          controlaStock: true,
          updatedAt: timestamp,
        })
      )
    );
  }

  const medio = findMedioPagoInConfig(finanzas.mediosPago, parsed.input.pago.medioPagoId);
  const skipCash = !medioPagoGeneratesImmediateCash(medio);
  const purchaseCostPolicy = finanzas.purchase?.purchaseCostPolicy ?? 'initialize_if_missing';

  console.info(
    '[purchase:plan:total]',
    JSON.stringify({
      businessId: tenant.businessId,
      planTotal: Number(entities.amount) || parsed.input.total,
      parsedTotal: parsed.input.total,
    })
  );

  const saved = await persistPurchase(tenant.businessId, parsed.input, {
    skipProductCostUpdate: purchaseCostPolicy === 'never_update_catalog',
    skipCash,
    purchaseCostPolicy,
  });

  const planNet = Number(entities.documentNetTotal) || 0;
  const planTax = Number(entities.documentTaxTotal) || 0;
  const planGross =
    Number(entities.documentGrossTotal) || Number(entities.amount) || parsed.input.total || 0;
  const persistedNet = Number(parsed.input.documentNetTotal ?? planNet) || planNet;
  const persistedTax = Number(parsed.input.documentTaxTotal ?? planTax) || planTax;
  const persistedGross = Number(parsed.input.total) || planGross;
  if (
    (planNet > 0 && Math.abs(persistedNet - planNet) > 0.05) ||
    (planTax > 0 && Math.abs(persistedTax - planTax) > 0.05) ||
    (planGross > 0 && Math.abs(persistedGross - planGross) > 0.05)
  ) {
    console.error(
      '[purchase:execute:total-mismatch]',
      JSON.stringify({
        businessId: tenant.businessId,
        compraId: saved.id,
        planNet,
        planTax,
        planGross,
        persistedNet,
        persistedTax,
        persistedGross,
      })
    );
  }

  console.info(
    '[purchase:execute:success]',
    JSON.stringify({
      businessId: tenant.businessId,
      compraId: saved.id,
      persistedTotal: persistedGross,
      articleCount: items.reduce((acc, row) => acc + (Number(row.cantidad) || 0), 0),
    })
  );

  const label = saved.compraLabel || '';

  return {
    compraId: saved.id,
    label: saved.compraLabel,
    clientName: supplierName,
    amount: persistedGross,
    reply: label
      ? `✅ Compra registrada · ${label}. Listo.`
      : '✅ Compra registrada. Listo.',
  };
}
