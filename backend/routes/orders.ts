import express from 'express';
import { db } from '../firebase.ts';
import {
  mapDeletionError,
  validateOrderCancellation,
} from '../utils/deletion-guards.ts';
import { allocateOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import { formatOrderStockMotivo } from '../utils/stock-movimientos.ts';
import { productControlsStock } from '../utils/stock-product.ts';
import { createSaleFromOrder } from '../utils/create-sale-from-order.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  applyOrderStockPreparation,
  buildStockPreparationView,
  buildOrderStockDiscountPreview,
  consumeOrderStockForProduction,
  consumeOrderReservedStockManual,
  consumeOrderStockOnStatusChange,
  consumeOrderStockOnDelivery,
  ensureStockReservationsSynced,
  orderStockFullyConsumed,
  listReservationSourcesForProduct,
  listReservationTargetsForProduct,
  mergeOrderItemsPreservingStock,
  normalizeOrderItemsStock,
  autoReserveIncomingStockForProduct,
  OrderStockError,
  releaseOrderStockReservations,
  transferReservedStockBetweenOrders,
  computeLineStockFields,
  computeOrderStockStatus,
} from '../utils/order-stock-reservations.ts';
import {
  normalizeOrderPedidosConfig,
  orderEstadoMatchesTrigger,
  orderUsesReservedStock,
  resolveOrderPhysicalStockScope,
  shouldConsumeStockOnStatusChange,
  validateOrderEstadoTransition,
  getOrderEstadoLabel,
  type OrderPhysicalStockScope,
} from '../utils/order-config.ts';
import {
  getBusinessCashAmbitoId,
  resolveCashReversalAmbito,
} from '../utils/caja-ambitos.ts';

const router = createCompanyRouter();

async function loadOrderPedidosConfig(businessId: string) {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const data = appDoc.exists ? (appDoc.data() as Record<string, unknown>) : {};
  const pedidos = (data.pedidos as Record<string, unknown>) ?? {};
  return normalizeOrderPedidosConfig(pedidos);
}

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return {};
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
}

function estadoMatchesStockTrigger(estado: string | undefined, trigger: string): boolean {
  return orderEstadoMatchesTrigger(estado, trigger);
}

type OrderPayment = {
  id: string;
  tipo: 'seña' | 'cuota' | 'pago' | 'extra';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
};

type OrderLine = {
  stockItemId?: string;
  cantidad?: number;
  nombre?: string;
  precioVenta?: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: Array<{ nombre?: string; costo?: number }>;
  cantidadReservada?: number;
  cantidadUsada?: number;
  cantidadFaltante?: number;
  estadoStockItem?: string;
};

type OrderRecord = {
  senia?: number;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  clienteId?: string;
  estado?: string;
  total?: number;
  saldo?: number;
  totalPagado?: number;
  pagos?: OrderPayment[];
  items?: OrderLine[];
  stockDescontado?: boolean;
  stockPreparado?: boolean;
  stockRestaurado?: boolean;
  estadoStock?: string;
  cajaRevertida?: boolean;
  cancelledAt?: string;
  entregadoAt?: string;
  ventaId?: string;
  costoReal?: number;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  stockOperaciones?: Array<{
    fecha: string;
    tipo: string;
    total: number;
    detalle: string;
  }>;
};

function sumPagos(pagos: OrderPayment[] = []) {
  return pagos.reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

function sumPagosHaciaTotal(pagos: OrderPayment[] = []) {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

/** Respuesta liviana para la grilla de pedidos (sin detalle de líneas ni costos extra). */
function toOrderListSummary(id: string, data: Record<string, unknown>) {
  const items = Array.isArray(data.items) ? data.items : [];
  const pagos = Array.isArray(data.pagos) ? data.pagos : [];

  return {
    id,
    clienteId: data.clienteId ?? '',
    estado: data.estado ?? '',
    fechaEntrega: data.fechaEntrega ?? null,
    createdAt: data.createdAt ?? null,
    numeroPedido: data.numeroPedido ?? null,
    numeroPedidoLabel: data.numeroPedidoLabel ?? null,
    descripcion: data.descripcion ?? '',
    total: data.total ?? 0,
    saldo: data.saldo ?? 0,
    totalPagado: data.totalPagado ?? null,
    senia: data.senia ?? 0,
    seniaBloqueada: data.seniaBloqueada ?? false,
    movimientoSeniaId: data.movimientoSeniaId ?? null,
    stockPreparado: data.stockPreparado ?? false,
    estadoStock: data.estadoStock ?? null,
    stockDescontado: data.stockDescontado ?? false,
    ventaId: data.ventaId ?? null,
    pagos: pagos.map((pago) => {
      const row = (pago ?? {}) as Record<string, unknown>;
      return {
        tipo: row.tipo ?? 'pago',
        monto: row.monto ?? 0,
      };
    }),
    productoNombres: items
      .map((line) => String((line as Record<string, unknown>).nombre ?? '').trim())
      .filter(Boolean),
    items: [],
  };
}

function normalizePagos(order: OrderRecord): OrderPayment[] {
  const pagos = [...(order.pagos ?? [])];
  if (
    pagos.length === 0 &&
    order.movimientoSeniaId &&
    Number(order.senia) > 0
  ) {
    pagos.push({
      id: `pago_senia_${order.movimientoSeniaId}`,
      tipo: 'seña',
      monto: Number(order.senia),
      fecha: new Date().toISOString(),
      movimientoCajaId: order.movimientoSeniaId,
    });
  }
  return pagos;
}

function getPagadoHaciaPedido(order: OrderRecord): number {
  const pagos = normalizePagos(order);
  if (pagos.length > 0) return sumPagosHaciaTotal(pagos);
  return 0;
}

function orderAllowsPayments(order: OrderRecord): boolean {
  if (isDraftStatus(order.estado) || isCancelledStatus(order.estado)) {
    return false;
  }
  return true;
}

function sanitizePagoForFirestore(pago: OrderPayment): Record<string, unknown> {
  const clean: Record<string, unknown> = {
    id: pago.id,
    tipo: pago.tipo,
    monto: pago.monto,
    fecha: pago.fecha,
  };
  if (pago.movimientoCajaId) clean.movimientoCajaId = pago.movimientoCajaId;
  if (pago.notas) clean.notas = pago.notas;
  return clean;
}

function normalizeEstado(estado?: string) {
  return String(estado ?? '').toLowerCase().trim();
}

function isDraftStatus(estado?: string) {
  const value = normalizeEstado(estado);
  return value === 'borrador' || value.includes('borrador');
}

function isCancelledStatus(estado?: string) {
  const value = normalizeEstado(estado);
  return value === 'cancelado' || value.includes('cancelad');
}

function isEntregadoTotalStatus(estado?: string) {
  return resolveOrderEstado(estado) === 'entregado';
}

function isDeliveredEstado(estado: ResolvedOrderEstado): boolean {
  return estado === 'entregado' || estado === 'entregado_con_saldo';
}

function orderCanCreateDeliverySale(order: OrderRecord): boolean {
  if (order.ventaId) return false;
  if (isCancelledStatus(order.estado)) return false;
  if (isDraftStatus(order.estado)) return false;
  return orderAllowsPayments(order) || !!order.stockDescontado;
}

type ResolvedOrderEstado =
  | 'borrador'
  | 'pendiente'
  | 'en_produccion'
  | 'listo'
  | 'entregado'
  | 'entregado_con_saldo'
  | 'cancelado'
  | 'otro';

function resolveOrderEstado(estado?: string): ResolvedOrderEstado {
  const value = normalizeEstado(estado);

  if (value === 'borrador' || value.includes('borrador')) return 'borrador';
  if (value === 'cancelado' || value.includes('cancelad')) return 'cancelado';
  if (
    value === 'entregado_con_saldo' ||
    value.includes('entregado_con_saldo') ||
    value.includes('entregado con saldo')
  ) {
    return 'entregado_con_saldo';
  }
  if (value === 'entregado' || value.includes('entregado total') || (value.includes('entregad') && !value.includes('saldo'))) {
    return 'entregado';
  }
  if (value === 'pendiente' || value.includes('pendiente')) return 'pendiente';
  if (value === 'en_produccion' || value.includes('produccion') || value.includes('producción')) {
    return 'en_produccion';
  }
  if (value === 'listo' || value.includes('listo')) return 'listo';

  return 'otro';
}

async function applyEntregaCompletaPayment(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<Partial<OrderRecord> & { ventaLabel?: string }> {
  const total = Number(order.total) || 0;
  const pagosBase = normalizePagos(order);
  const totalPagadoAnterior = sumPagosHaciaTotal(pagosBase);
  const saldoPedido = Math.max(0, total - totalPagadoAnterior);

  const basePatch: Partial<OrderRecord> = {
    entregadoAt: new Date().toISOString(),
    saldo: 0,
    totalPagado: total,
    seniaBloqueada: true,
  };

  if (order.ventaId) {
    if (saldoPedido <= 0 || !orderAllowsPayments(order)) {
      return basePatch;
    }

    const orderLabel = resolveOrderLabel(order);
    const movimientoCajaId = await createCashIncome(businessId, {
      monto: saldoPedido,
      concepto: `Pago pedido #${orderLabel}`,
      origenId: orderId,
      origenTipo: 'pedido_pago',
      clienteId: order.clienteId,
      pedidoId: orderId,
      numeroPedido: order.numeroPedido,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
    });

    const pagos: OrderPayment[] = [
      ...pagosBase,
      {
        id: `pago_entrega_${Date.now()}`,
        tipo: 'pago',
        monto: saldoPedido,
        fecha: new Date().toISOString(),
        movimientoCajaId,
        notas: 'Pago total',
      },
    ];

    return {
      ...basePatch,
      pagos,
      totalPagado: sumPagos(pagos),
      saldo: 0,
    };
  }

  if (!orderCanCreateDeliverySale(order)) {
    if (saldoPedido <= 0) {
      return basePatch;
    }
    if (!orderAllowsPayments(order)) {
      return basePatch;
    }

    const orderLabel = resolveOrderLabel(order);
    const movimientoCajaId = await createCashIncome(businessId, {
      monto: saldoPedido,
      concepto: `Pago pedido #${orderLabel}`,
      origenId: orderId,
      origenTipo: 'pedido_pago',
      clienteId: order.clienteId,
      pedidoId: orderId,
      numeroPedido: order.numeroPedido,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
    });

    const pagos: OrderPayment[] = [
      ...pagosBase,
      {
        id: `pago_entrega_${Date.now()}`,
        tipo: 'pago',
        monto: saldoPedido,
        fecha: new Date().toISOString(),
        movimientoCajaId,
        notas: 'Pago total',
      },
    ];

    return {
      ...basePatch,
      pagos,
      totalPagado: sumPagos(pagos),
      saldo: 0,
    };
  }

  if (!(order.items?.length ?? 0)) {
    throw new Error('El pedido no tiene productos para registrar la venta.');
  }

  const sale = await createSaleFromOrder(businessId, orderId, order, {
    montoCobrado: saldoPedido,
    totalPagadoAnterior,
    medioPago: 'efectivo',
    notas: saldoPedido > 0 ? 'Entrega total' : 'Entrega total (ya estaba pago)',
  });

  const pagos: OrderPayment[] = [...pagosBase];
  if (saldoPedido > 0 && sale.movimientoCajaId) {
    pagos.push({
      id: `pago_entrega_${Date.now()}`,
      tipo: 'pago',
      monto: saldoPedido,
      fecha: new Date().toISOString(),
      movimientoCajaId: sale.movimientoCajaId,
      notas: 'Pago total (entrega)',
    });
  }

  return {
    ...basePatch,
    ventaId: sale.ventaId,
    ventaLabel: sale.ventaLabel,
    pagos,
    totalPagado: sumPagos(pagos),
    saldo: 0,
  };
}

async function applyEntregaConSaldoVenta(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<Partial<OrderRecord> & { ventaLabel?: string }> {
  if (order.ventaId) {
    return { entregadoAt: new Date().toISOString() };
  }

  if (!orderCanCreateDeliverySale(order)) {
    throw new Error('El pedido no está listo para registrar la entrega como venta.');
  }
  if (!(order.items?.length ?? 0)) {
    throw new Error('El pedido no tiene productos para registrar la venta.');
  }

  const total = Number(order.total) || 0;
  const pagosBase = normalizePagos(order);
  const totalPagadoAnterior = sumPagosHaciaTotal(pagosBase);
  const saldoPedido = Math.max(0, total - totalPagadoAnterior);

  const sale = await createSaleFromOrder(businessId, orderId, order, {
    montoCobrado: 0,
    totalPagadoAnterior,
    medioPago: 'efectivo',
    notas: 'Entrega con saldo pendiente',
  });

  return {
    ventaId: sale.ventaId,
    ventaLabel: sale.ventaLabel,
    entregadoAt: new Date().toISOString(),
    saldo: saldoPedido,
    totalPagado: totalPagadoAnterior,
  };
}

class StockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockValidationError';
  }
}

async function validateStockForOrder(
  businessId: string,
  order: OrderRecord
): Promise<void> {
  for (const line of order.items ?? []) {
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) continue;

    const currentStock = Number(data.stockActual) || 0;
    if (currentStock - qty < 0) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      throw new StockValidationError(
        `Stock insuficiente para "${nombre}": hay ${currentStock} u., pediste ${qty} u.`
      );
    }
  }
}

async function applyStockForOrder(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<boolean> {
  if (order.stockDescontado || isDraftStatus(order.estado)) {
    return false;
  }

  await validateStockForOrder(businessId, order);

  for (const line of order.items ?? []) {
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) continue;

    const currentStock = Number(data.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock - qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'salida',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: formatOrderStockMotivo(resolveOrderLabel(order), 'Confirmado'),
      origenId: orderId,
      origenTipo: 'pedido',
      origenGrupo: 'pedido',
      usuarioId: 'admin',
      negocioId: businessId,
    });
  }

  return true;
}

async function createCashIncome(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    origenTipo: string;
    clienteId?: string;
    pedidoId?: string;
    numeroPedido?: number;
    numeroPedidoLabel?: string;
  }
) {
  const caja = await loadCajaConfig(businessId);
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: 'efectivo',
    concepto: params.concepto,
    ambito: getBusinessCashAmbitoId(caja),
    fecha: new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: params.pedidoId ? 'pedido' : 'otro',
    pedidoId: params.pedidoId ?? null,
    numeroPedido: params.numeroPedido ?? null,
    numeroPedidoLabel: params.numeroPedidoLabel ?? null,
    clienteId: params.clienteId ?? null,
    negocioId: businessId,
  });
  return docRef.id;
}

async function registerInitialSenia(
  businessId: string,
  orderId: string,
  orderData: OrderRecord
): Promise<Partial<OrderRecord>> {
  const senia = Number(orderData.senia) || 0;
  if (senia <= 0) {
    return {
      pagos: [],
      totalPagado: 0,
      saldo: Number(orderData.total) || 0,
      seniaBloqueada: false,
      movimientoSeniaId: null,
    };
  }

  const orderLabel = resolveOrderLabel(orderData);
  const movimientoCajaId = await createCashIncome(businessId, {
    monto: senia,
    concepto: `Seña pedido #${orderLabel}`,
    origenId: orderId,
    origenTipo: 'pedido_senia',
    clienteId: orderData.clienteId,
    pedidoId: orderId,
    numeroPedido: orderData.numeroPedido,
    numeroPedidoLabel: orderData.numeroPedidoLabel ?? orderLabel,
  });

  const pago: OrderPayment = {
    id: `pago_${Date.now()}`,
    tipo: 'seña',
    monto: senia,
    fecha: new Date().toISOString(),
    movimientoCajaId,
  };

  const totalPagado = senia;
  const total = Number(orderData.total) || 0;

  return {
    pagos: [pago],
    totalPagado,
    saldo: total - totalPagado,
    senia,
    seniaBloqueada: true,
    movimientoSeniaId: movimientoCajaId,
  };
}

async function reverseCashMovementsForOrder(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<boolean> {
  if (order.cajaRevertida) return false;

  const movimientoIds = new Set<string>();
  if (order.movimientoSeniaId) movimientoIds.add(order.movimientoSeniaId);
  for (const pago of normalizePagos(order)) {
    if (pago.movimientoCajaId) movimientoIds.add(pago.movimientoCajaId);
  }

  if (movimientoIds.size === 0) return false;

  const orderLabel = resolveOrderLabel(order);
  const caja = await loadCajaConfig(businessId);
  const movimientosRef = db.collection(`negocios/${businessId}/movimientos_caja`);
  let reverted = false;

  for (const movimientoId of movimientoIds) {
    const snap = await movimientosRef.doc(movimientoId).get();
    if (!snap.exists) continue;

    const data = snap.data() ?? {};
    if (data.tipo !== 'ingreso') continue;

    const conceptoBase = String(data.concepto ?? 'Pago pedido').trim();
    await movimientosRef.add({
      tipo: 'egreso',
      monto: Number(data.monto) || 0,
      medio: data.medio ?? 'efectivo',
      concepto: `Anulación ${conceptoBase}`,
      ambito: resolveCashReversalAmbito(data.ambito, caja),
      fecha: new Date().toISOString(),
      origenId: orderId,
      origenTipo: 'pedido_cancelacion',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedido: order.numeroPedido ?? null,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      movimientoAnuladoId: movimientoId,
      clienteId: order.clienteId ?? null,
      negocioId: businessId,
    });
    reverted = true;
  }

  return reverted;
}

async function restoreStockForOrder(
  businessId: string,
  orderId: string,
  order: OrderRecord
): Promise<boolean> {
  if (!order.stockDescontado || order.stockRestaurado) return false;

  const orderLabel = resolveOrderLabel(order);
  let restored = false;

  for (const line of order.items ?? []) {
    const qty = Math.max(0, Number(line.cantidadUsada) || Number(line.cantidad) || 0);
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) continue;

    const currentStock = Number(data.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: formatOrderStockMotivo(orderLabel, 'Cancelado'),
      origenId: orderId,
      origenTipo: 'pedido_cancelado',
      origenGrupo: 'pedido',
      usuarioId: 'admin',
      negocioId: businessId,
    });
    restored = true;
  }

  return restored;
}

async function restoreStockForOrderEstadoRollback(
  businessId: string,
  orderId: string,
  order: OrderRecord,
  nextEstado: string,
  estados: ReturnType<typeof normalizeOrderPedidosConfig>['estados']
): Promise<{ restored: boolean; items: OrderRecord['items'] }> {
  if (!order.stockDescontado) {
    return { restored: false, items: order.items ?? [] };
  }

  const orderLabel = resolveOrderLabel(order);
  const estadoLabel = getOrderEstadoLabel(nextEstado, estados);
  const items = (order.items ?? []).map((line) => ({ ...line }));
  let restored = false;

  for (let index = 0; index < items.length; index++) {
    const line = items[index];
    const qty = Math.max(0, Number(line.cantidadUsada) || 0);
    if (!line.stockItemId || qty <= 0) {
      items[index] = computeLineStockFields(line);
      continue;
    }

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      items[index] = computeLineStockFields({ ...line, cantidadUsada: 0 });
      continue;
    }

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) {
      items[index] = computeLineStockFields({ ...line, cantidadUsada: 0 });
      continue;
    }

    const currentStock = Number(data.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: formatOrderStockMotivo(orderLabel, estadoLabel),
      origenId: orderId,
      origenTipo: 'pedido_estado_reversion',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      afectaStockReal: true,
      negocioId: businessId,
    });

    items[index] = computeLineStockFields({ ...line, cantidadUsada: 0 });
    restored = true;
  }

  return {
    restored,
    items: normalizeOrderItemsStock(items),
  };
}

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const paged = String(req.query.paged ?? '') === '1';

    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : 120;
      const cursor = String(req.query.cursor ?? '').trim();

      let query = db
        .collection(`negocios/${businessId}/pedidos`)
        .orderBy('createdAt', 'desc')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/pedidos`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const pageDocs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const items = pageDocs.map((doc) =>
        toOrderListSummary(doc.id, doc.data() as Record<string, unknown>)
      );
      const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;

      return res.json({ items, nextCursor, hasMore });
    }

    const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
    const orders = snapshot.docs
      .map((doc) => toOrderListSummary(doc.id, doc.data() as Record<string, unknown>))
      .sort((a, b) => {
        const numA = Number(a.numeroPedido) || 0;
        const numB = Number(b.numeroPedido) || 0;
        if (numA !== numB) return numB - numA;
        const dateA = Date.parse(String(a.createdAt ?? a.fechaEntrega ?? '')) || 0;
        const dateB = Date.parse(String(b.createdAt ?? b.fechaEntrega ?? '')) || 0;
        return dateB - dateA;
      });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

router.get('/:businessId/stock-reservation-sources', async (req, res) => {
  try {
    const { businessId } = req.params;
    const stockItemId = String(req.query.stockItemId ?? '').trim();
    const excludeOrderId = String(req.query.excludeOrderId ?? '').trim() || undefined;

    if (!stockItemId) {
      return res.status(400).json({ error: 'Indicá el producto de stock.' });
    }

    const sources = await listReservationSourcesForProduct(businessId, stockItemId, excludeOrderId);
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: 'Error listing reservation sources' });
  }
});

router.get('/:businessId/stock-reservation-targets', async (req, res) => {
  try {
    const { businessId } = req.params;
    const stockItemId = String(req.query.stockItemId ?? '').trim();
    const sourceOrderId = String(req.query.sourceOrderId ?? '').trim() || undefined;

    if (!stockItemId) {
      return res.status(400).json({ error: 'Indicá el producto de stock.' });
    }

    const targets = await listReservationTargetsForProduct(businessId, stockItemId, sourceOrderId);
    res.json(targets);
  } catch (error) {
    res.status(500).json({ error: 'Error listing reservation targets' });
  }
});

router.get('/:businessId/:orderId', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });
    const data = doc.data() as Record<string, unknown>;
    const items = normalizeOrderItemsStock((data.items as OrderLine[] | undefined) ?? []);

    let clienteNombre = '';
    const clienteId = String(data.clienteId ?? '').trim();
    if (clienteId) {
      const clientSnap = await db.collection(`negocios/${businessId}/clientes`).doc(clienteId).get();
      if (clientSnap.exists) {
        clienteNombre = String(clientSnap.data()?.nombre ?? '').trim();
      }
    }

    res.json({
      id: doc.id,
      ...data,
      items,
      clienteNombre,
      estadoStock: computeOrderStockStatus(items),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching order' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { senia, ...orderData } = req.body;
    const seniaAmount = Number(senia) || 0;
    const isDraft = isDraftStatus(orderData.estado);

    const total = Number(orderData.total) || 0;
    const normalizedItems = normalizeOrderItemsStock(orderData.items ?? []);

    let orderNumberPatch: Partial<OrderRecord> = {};
    if (!isDraft) {
      const allocated = await allocateOrderNumber(businessId);
      orderNumberPatch = {
        numeroPedido: allocated.numero,
        numeroPedidoLabel: allocated.label,
      };
    }

    const docRef = await db.collection(`negocios/${businessId}/pedidos`).add({
      ...orderData,
      items: normalizedItems,
      ...orderNumberPatch,
      senia: isDraft ? seniaAmount : 0,
      totalPagado: 0,
      saldo: total,
      pagos: [],
      seniaBloqueada: false,
      stockDescontado: false,
      stockPreparado: false,
      estadoStock: 'sin_preparar',
      negocioId: businessId,
      createdAt: new Date().toISOString(),
    });

    let seniaPatch: Partial<OrderRecord> = {};
    if (!isDraft && seniaAmount > 0) {
      seniaPatch = await registerInitialSenia(businessId, docRef.id, {
        ...orderData,
        ...orderNumberPatch,
        senia: seniaAmount,
      });
    }

    const mergedOrder: OrderRecord = {
      ...orderData,
      ...orderNumberPatch,
      ...seniaPatch,
      items: normalizedItems,
      estado: orderData.estado,
    };

    const postCreatePatch: Partial<OrderRecord> = {
      ...seniaPatch,
      ...orderNumberPatch,
    };
    if (Object.keys(postCreatePatch).length > 0) {
      await docRef.update(postCreatePatch);
    }

    const orderLabel = orderNumberPatch.numeroPedidoLabel ?? docRef.id;
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'create',
      entityType: 'pedido',
      entityId: docRef.id,
      entityLabel: orderLabel,
      summary: isDraft
        ? `Guardó borrador de pedido`
        : `Creó el pedido #${orderLabel}`,
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    if (error instanceof StockValidationError || error instanceof OrderStockError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Error creating order' });
  }
});

router.post('/:businessId/:orderId/pagos', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const monto = Number(req.body.monto) || 0;
    const tipo = req.body.tipo === 'cuota' ? 'cuota' : 'pago';
    const allowExtra = req.body.allowExtra === true;
    const notas = String(req.body.notas ?? '').trim();

    if (monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }

    const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

    const order = orderSnap.data() as OrderRecord;
    if (isCancelledStatus(order.estado)) {
      return res.status(403).json({ error: 'No se pueden registrar pagos en un pedido cancelado.' });
    }
    if (isEntregadoTotalStatus(order.estado)) {
      return res.status(403).json({ error: 'No se pueden registrar pagos en un pedido entregado total.' });
    }
    if (!orderAllowsPayments(order)) {
      return res.status(400).json({ error: 'Confirmá el pedido antes de registrar pagos.' });
    }

    const total = Number(order.total) || 0;
    const pagosBase = normalizePagos(order);
    const pagadoActual = sumPagosHaciaTotal(pagosBase);
    const saldoPedido = Math.max(0, total - pagadoActual);

    if (monto > saldoPedido && !allowExtra) {
      return res.status(400).json({
        error: `El monto supera el saldo pendiente ($${saldoPedido}).`,
        saldoPedido,
        extra: monto - saldoPedido,
      });
    }

    const orderLabel = resolveOrderLabel(order);
    const nuevosPagos: OrderPayment[] = [];
    const timestamp = Date.now();

    if (monto > saldoPedido && allowExtra) {
      if (saldoPedido > 0) {
        const movimientoSaldoId = await createCashIncome(businessId, {
          monto: saldoPedido,
          concepto: `${tipo === 'cuota' ? 'Cuota' : 'Pago'} pedido #${orderLabel}`,
          origenId: orderId,
          origenTipo: `pedido_${tipo}`,
          clienteId: order.clienteId,
          pedidoId: orderId,
          numeroPedido: order.numeroPedido,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        });

        nuevosPagos.push({
          id: `pago_${timestamp}`,
          tipo,
          monto: saldoPedido,
          fecha: new Date().toISOString(),
          movimientoCajaId: movimientoSaldoId,
          notas: notas || undefined,
        });
      }

      const extraMonto = monto - saldoPedido;
      const movimientoExtraId = await createCashIncome(businessId, {
        monto: extraMonto,
        concepto: `Pago extra pedido #${orderLabel}`,
        origenId: orderId,
        origenTipo: 'pedido_extra',
        clienteId: order.clienteId,
        pedidoId: orderId,
        numeroPedido: order.numeroPedido,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      });

      nuevosPagos.push({
        id: `pago_${timestamp + 1}`,
        tipo: 'extra',
        monto: extraMonto,
        fecha: new Date().toISOString(),
        movimientoCajaId: movimientoExtraId,
      });
    } else {
      const label = tipo === 'cuota' ? 'Cuota' : 'Pago';
      const movimientoCajaId = await createCashIncome(businessId, {
        monto,
        concepto: `${label} pedido #${orderLabel}`,
        origenId: orderId,
        origenTipo: `pedido_${tipo}`,
        clienteId: order.clienteId,
        pedidoId: orderId,
        numeroPedido: order.numeroPedido,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      });

      nuevosPagos.push({
        id: `pago_${timestamp}`,
        tipo,
        monto,
        fecha: new Date().toISOString(),
        movimientoCajaId,
        notas: notas || undefined,
      });
    }

    const pagos = [...pagosBase, ...nuevosPagos].map(sanitizePagoForFirestore);
    const totalPagado = sumPagos(pagos);
    const saldo = Math.max(0, total - sumPagosHaciaTotal(pagos));

    await orderRef.update({
      pagos,
      totalPagado,
      saldo,
      seniaBloqueada: true,
      updatedAt: new Date().toISOString(),
    });

    const ventaId = order.ventaId ? String(order.ventaId).trim() : '';
    if (ventaId) {
      const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
      const ventaSnap = await ventaRef.get();
      if (ventaSnap.exists) {
        const ventaData = ventaSnap.data() ?? {};
        const totalVenta = Number(ventaData.total) || total;
        const montoCobrado = Math.max(0, totalVenta - saldo);
        await ventaRef.update({
          montoCobrado,
          saldoPendiente: saldo,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'payment',
      entityType: 'pedido',
      entityId: orderId,
      entityLabel: orderLabel,
      summary: `Registró pago de $${monto} en pedido #${orderLabel}`,
    });

    res.status(201).json({
      id: orderId,
      pago: nuevosPagos[0],
      pagos: nuevosPagos,
      allPagos: pagos,
      totalPagado,
      saldo,
    });
  } catch (error) {
    console.error('Error registering payment:', error);
    const message = error instanceof Error ? error.message : 'Error registering payment';
    res.status(500).json({ error: message });
  }
});

router.patch('/:businessId/:orderId', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const incomingSenia = req.body.senia;
    const { id, createdAt, senia, movimientoSeniaId, pagos, totalPagado, seniaBloqueada, ...orderData } =
      req.body;

    const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
    const existingDoc = await orderRef.get();
    if (!existingDoc.exists) return res.status(404).json({ error: 'Order not found' });

    const existingOrder = existingDoc.data() as OrderRecord;
    if (isCancelledStatus(existingOrder.estado)) {
      return res.status(403).json({ error: 'No se puede modificar un pedido cancelado.' });
    }
    if (isEntregadoTotalStatus(existingOrder.estado)) {
      return res.status(403).json({
        error: 'Este pedido fue entregado total y no se puede modificar.',
      });
    }

    const mergedEstado = orderData.estado ?? existingOrder.estado;
    const mergedOrder: OrderRecord = {
      ...existingOrder,
      ...orderData,
      estado: mergedEstado,
      senia: existingOrder.senia,
      pagos: existingOrder.pagos,
      totalPagado: existingOrder.totalPagado,
      seniaBloqueada: existingOrder.seniaBloqueada,
      movimientoSeniaId: existingOrder.movimientoSeniaId,
      stockDescontado: existingOrder.stockDescontado,
    };

    if (isDraftStatus(mergedEstado) && !existingOrder.seniaBloqueada && incomingSenia !== undefined) {
      orderData.senia = Number(incomingSenia) || 0;
      mergedOrder.senia = orderData.senia;
    }

    let orderNumberPatch: Partial<OrderRecord> = {};
    if (!isDraftStatus(mergedEstado) && !existingOrder.numeroPedido) {
      const allocated = await allocateOrderNumber(businessId);
      orderNumberPatch = {
        numeroPedido: allocated.numero,
        numeroPedidoLabel: allocated.label,
      };
      Object.assign(mergedOrder, orderNumberPatch);
      orderData.numeroPedido = allocated.numero;
      orderData.numeroPedidoLabel = allocated.label;
    }

    let seniaPatch: Partial<OrderRecord> = {};
    if (
      !existingOrder.seniaBloqueada &&
      Number(incomingSenia) > 0 &&
      !isDraftStatus(mergedEstado)
    ) {
      seniaPatch = await registerInitialSenia(businessId, orderId, {
        ...mergedOrder,
        senia: Number(incomingSenia),
        total: orderData.total ?? existingOrder.total,
        clienteId: orderData.clienteId ?? existingOrder.clienteId,
      });
      Object.assign(mergedOrder, seniaPatch);
    }

    if (orderData.total !== undefined) {
      const total = Number(orderData.total) || 0;
      const pagado = sumPagosHaciaTotal(normalizePagos(mergedOrder));
      mergedOrder.saldo = Math.max(0, total - pagado);
      orderData.saldo = mergedOrder.saldo;
    } else if (!existingOrder.seniaBloqueada && (mergedOrder.pagos?.length ?? 0) === 0) {
      const total = Number(orderData.total ?? existingOrder.total) || 0;
      orderData.saldo = total;
      mergedOrder.saldo = total;
      orderData.totalPagado = 0;
      mergedOrder.totalPagado = 0;
    } else if (isDraftStatus(mergedEstado) && !existingOrder.seniaBloqueada) {
      orderData.saldo = Number(orderData.total ?? existingOrder.total) || 0;
      mergedOrder.saldo = orderData.saldo;
    }

    let stockDescontado = mergedOrder.stockDescontado ?? false;

    if (orderData.items !== undefined) {
      orderData.items = mergeOrderItemsPreservingStock(
        orderData.items ?? [],
        existingOrder.items ?? []
      );
      mergedOrder.items = orderData.items;
    }

    let deliveryPatch: Partial<OrderRecord> = {};
    let productionStockPatch: Partial<OrderRecord> = {};
    const previousEstado = resolveOrderEstado(existingOrder.estado);
    const nextEstado = resolveOrderEstado(mergedEstado);
    const pedidosConfig = await loadOrderPedidosConfig(businessId);
    const stockTrigger = pedidosConfig.estadoDescuentaStock;

    if (existingOrder.estado !== mergedEstado) {
      const transition = validateOrderEstadoTransition({
        previousEstado: existingOrder.estado,
        nextEstado: mergedEstado,
        triggerEstado: stockTrigger,
        stockDescontado,
        estados: pedidosConfig.estados,
      });

      if (!transition.allowed) {
        return res.status(400).json({ error: transition.error });
      }

      if (transition.requiresStockRestore) {
        const rollback = await restoreStockForOrderEstadoRollback(
          businessId,
          orderId,
          mergedOrder,
          mergedEstado,
          pedidosConfig.estados
        );
        productionStockPatch = {
          items: rollback.items,
          stockDescontado: false,
          estadoStock: computeOrderStockStatus(rollback.items ?? []),
        };
        Object.assign(mergedOrder, productionStockPatch);
        stockDescontado = false;
      }
    }

    const stockFullyConsumed = orderStockFullyConsumed(mergedOrder.items ?? []);
    const crossesStockTrigger =
      shouldConsumeStockOnStatusChange({
        previousEstado,
        nextEstado,
        triggerEstado: stockTrigger,
        stockDescontado,
        stockFullyConsumed,
        estados: pedidosConfig.estados,
      });
    let stockWarning: string | undefined;

    if (crossesStockTrigger) {
      const requestedScope = String(req.body?.descuentoFisicoAlcance ?? '')
        .trim()
        .toLowerCase() as OrderPhysicalStockScope;
      const scope =
        requestedScope === 'solo_reservado' || requestedScope === 'pedido_completo'
          ? requestedScope
          : resolveOrderPhysicalStockScope(pedidosConfig, nextEstado);

      const consumption = await consumeOrderStockOnStatusChange(businessId, orderId, mergedOrder, {
        pedidosConfig,
        targetEstado: nextEstado,
        scope,
      });
      productionStockPatch = {
        items: consumption.items,
        stockDescontado: consumption.stockDescontado,
        estadoStock: consumption.estadoStock,
        stockPreparado: consumption.stockPreparado ?? mergedOrder.stockPreparado,
      };
      Object.assign(mergedOrder, productionStockPatch);
      stockDescontado = consumption.stockDescontado;
      stockWarning = consumption.stockWarning;
    }

    const isDeliveryTransition = isDeliveredEstado(nextEstado) && !isDeliveredEstado(previousEstado);
    if (isDeliveryTransition) {
      const deliveryConsumption = await consumeOrderStockOnDelivery(businessId, orderId, mergedOrder);
      productionStockPatch = {
        ...productionStockPatch,
        items: deliveryConsumption.items,
        stockDescontado: deliveryConsumption.stockDescontado,
        estadoStock: deliveryConsumption.estadoStock,
        stockPreparado: deliveryConsumption.stockPreparado ?? mergedOrder.stockPreparado,
      };
      Object.assign(mergedOrder, productionStockPatch);
      stockDescontado = deliveryConsumption.stockDescontado;
      if (deliveryConsumption.stockWarning) {
        stockWarning = stockWarning
          ? `${stockWarning}\n${deliveryConsumption.stockWarning}`
          : deliveryConsumption.stockWarning;
      }
    }

    if (nextEstado === 'entregado' && previousEstado !== 'entregado') {
      deliveryPatch = await applyEntregaCompletaPayment(businessId, orderId, {
        ...mergedOrder,
        total: orderData.total ?? mergedOrder.total,
        saldo: mergedOrder.saldo,
      });
      Object.assign(mergedOrder, deliveryPatch);
    } else if (nextEstado === 'entregado_con_saldo' && previousEstado !== 'entregado_con_saldo') {
      deliveryPatch = await applyEntregaConSaldoVenta(businessId, orderId, {
        ...mergedOrder,
        total: orderData.total ?? mergedOrder.total,
        costoReal: orderData.costoReal ?? mergedOrder.costoReal,
      });
      Object.assign(mergedOrder, deliveryPatch);
    }

    const updatePayload: Record<string, unknown> = {
      ...orderData,
      ...orderNumberPatch,
      ...seniaPatch,
      ...productionStockPatch,
      stockDescontado,
      updatedAt: new Date().toISOString(),
    };

    if (deliveryPatch.pagos) {
      updatePayload.pagos = deliveryPatch.pagos.map(sanitizePagoForFirestore);
      updatePayload.totalPagado = deliveryPatch.totalPagado;
      updatePayload.saldo = deliveryPatch.saldo;
      updatePayload.seniaBloqueada = deliveryPatch.seniaBloqueada;
    }
    if (deliveryPatch.entregadoAt) {
      updatePayload.entregadoAt = deliveryPatch.entregadoAt;
    }
    if (deliveryPatch.ventaId) {
      updatePayload.ventaId = deliveryPatch.ventaId;
    }
    if (deliveryPatch.saldo !== undefined && !deliveryPatch.pagos) {
      updatePayload.saldo = deliveryPatch.saldo;
    }
    if (deliveryPatch.totalPagado !== undefined && !deliveryPatch.pagos) {
      updatePayload.totalPagado = deliveryPatch.totalPagado;
    }

    await orderRef.update(updatePayload);

    const updatedSnap = await orderRef.get();
    const updated = updatedSnap.data() as OrderRecord | undefined;
    const orderLabel = resolveOrderLabel(updated ?? existingOrder);

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'update',
      entityType: 'pedido',
      entityId: orderId,
      entityLabel: orderLabel,
      summary: `Editó el pedido #${orderLabel}${mergedEstado ? ` · estado ${mergedEstado}` : ''}`,
    });

    res.json({
      id: orderId,
      estado: updated?.estado ?? mergedEstado,
      pagos: updated?.pagos ?? [],
      totalPagado: updated?.totalPagado,
      saldo: updated?.saldo,
      entregadoAt: updated?.entregadoAt,
      ventaId: updated?.ventaId,
      ventaLabel: (deliveryPatch as { ventaLabel?: string }).ventaLabel,
      deliveryPaymentApplied: !!deliveryPatch.pagos,
      saleCreated: !!deliveryPatch.ventaId,
      locked: resolveOrderEstado(updated?.estado ?? mergedEstado) === 'entregado',
      items: updated?.items ?? productionStockPatch.items,
      estadoStock: updated?.estadoStock ?? productionStockPatch.estadoStock,
      stockPreparado: updated?.stockPreparado ?? productionStockPatch.stockPreparado,
      stockDescontado: updated?.stockDescontado ?? stockDescontado,
      stockWarning,
    });
  } catch (error) {
    if (error instanceof StockValidationError || error instanceof OrderStockError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Error updating order';
    res.status(500).json({ error: message });
  }
});

router.get('/:businessId/:orderId/stock-discount-preview', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const nextEstado = String(req.query.nextEstado ?? '').trim();
    if (!nextEstado) {
      return res.status(400).json({ error: 'Falta el parámetro nextEstado.' });
    }

    const pedidosConfig = await loadOrderPedidosConfig(businessId);
    const doc = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data() as OrderRecord;
    const preview = await buildOrderStockDiscountPreview(
      businessId,
      {
        items: order.items,
        stockDescontado: order.stockDescontado,
        stockPreparado: order.stockPreparado,
        numeroPedido: order.numeroPedido,
        numeroPedidoLabel: order.numeroPedidoLabel,
        clienteId: order.clienteId,
      },
      pedidosConfig,
      nextEstado
    );

    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: 'Error loading stock discount preview' });
  }
});

router.get('/:businessId/:orderId/stock-preparation', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const pedidosConfig = await loadOrderPedidosConfig(businessId);
    if (!orderUsesReservedStock(pedidosConfig)) {
      return res.status(403).json({
        error: 'La reserva de stock está desactivada. Configurá «Stock reservado» en Ajustes → Pedidos.',
      });
    }

    await ensureStockReservationsSynced(businessId);

    const doc = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data() as OrderRecord;
    const lines = await buildStockPreparationView(businessId, order);

    res.json({
      orderId,
      orderLabel: resolveOrderLabel(order),
      estado: order.estado ?? '',
      estadoStock: order.estadoStock ?? 'sin_preparar',
      stockPreparado: !!order.stockPreparado,
      lines,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error loading stock preparation' });
  }
});

router.post('/:businessId/:orderId/stock-preparation', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const pedidosConfig = await loadOrderPedidosConfig(businessId);
    if (!orderUsesReservedStock(pedidosConfig)) {
      return res.status(403).json({
        error: 'La reserva de stock está desactivada. Configurá «Stock reservado» en Ajustes → Pedidos.',
      });
    }

    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];

    const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

    const order = orderSnap.data() as OrderRecord;
    if (isCancelledStatus(order.estado)) {
      return res.status(403).json({ error: 'No se puede preparar stock de un pedido cancelado.' });
    }

    const result = await applyOrderStockPreparation(businessId, orderId, order, allocations);

    await orderRef.update({
      items: result.items,
      estadoStock: result.estadoStock,
      stockPreparado: result.stockPreparado,
      updatedAt: new Date().toISOString(),
    });

    const orderLabel = resolveOrderLabel(order);
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'update',
      entityType: 'pedido',
      entityId: orderId,
      entityLabel: orderLabel,
      summary: `Preparó stock del pedido #${orderLabel} · ${result.estadoStock}`,
    });

    res.json({
      id: orderId,
      items: result.items,
      estadoStock: result.estadoStock,
      stockPreparado: result.stockPreparado,
    });
  } catch (error) {
    if (error instanceof OrderStockError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Error preparing order stock' });
  }
});

router.post('/:businessId/:orderId/stock-transfer', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const targetOrderId = String(req.body.targetOrderId ?? '').trim();
    const stockItemId = String(req.body.stockItemId ?? '').trim();
    const cantidad = Number(req.body.cantidad) || 0;
    const sourceLineIndex =
      req.body.sourceLineIndex === undefined ? undefined : Number(req.body.sourceLineIndex);
    const targetLineIndex =
      req.body.targetLineIndex === undefined ? undefined : Number(req.body.targetLineIndex);

    if (!targetOrderId || !stockItemId) {
      return res.status(400).json({ error: 'Indicá pedido destino y producto.' });
    }

    const sourceSnap = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    const targetSnap = await db.collection(`negocios/${businessId}/pedidos`).doc(targetOrderId).get();
    if (!sourceSnap.exists || !targetSnap.exists) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    await transferReservedStockBetweenOrders({
      businessId,
      sourceOrderId: orderId,
      sourceOrder: sourceSnap.data() as OrderRecord,
      targetOrderId,
      targetOrder: targetSnap.data() as OrderRecord,
      stockItemId,
      cantidad,
      sourceLineIndex,
      targetLineIndex,
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof OrderStockError) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Error transferring stock reservation' });
  }
});

router.post('/:businessId/:orderId/consume-pending-stock', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return res.status(404).json({ error: 'Order not found' });

    const order = orderSnap.data() as OrderRecord;
    if (isCancelledStatus(order.estado) || isDraftStatus(order.estado)) {
      return res.status(400).json({ error: 'El pedido no permite descontar stock.' });
    }
    if (resolveOrderEstado(order.estado) !== 'en_produccion') {
      return res.status(400).json({
        error: 'Este atajo solo está disponible para pedidos en producción.',
      });
    }

    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const lines = rawLines
      .map((entry: Record<string, unknown>) => ({
        lineIndex: Number(entry.lineIndex),
        cantidad: Math.max(0, Number(entry.cantidad) || 0),
      }))
      .filter((entry: { lineIndex: number }) => !Number.isNaN(entry.lineIndex));

    const consumption =
      lines.length > 0
        ? await consumeOrderReservedStockManual(businessId, orderId, order, lines)
        : await consumeOrderReservedStockManual(businessId, orderId, order, []);

    const detalle = consumption.consumedLines
      .map((l) => `${l.nombre}: ${l.cantidad} u.`)
      .join(' | ');
    const operation = {
      fecha: new Date().toISOString(),
      tipo: 'descuento_produccion_manual',
      total: consumption.totalConsumed,
      detalle,
    };

    const previousOps = Array.isArray(order.stockOperaciones) ? order.stockOperaciones : [];
    const stockOperaciones = [...previousOps, operation].slice(-25);

    await orderRef.update({
      items: consumption.items,
      stockDescontado: consumption.stockDescontado,
      estadoStock: consumption.estadoStock,
      stockPreparado: true,
      stockOperaciones,
      updatedAt: new Date().toISOString(),
    });

    const updatedSnap = await orderRef.get();
    const updated = updatedSnap.data() as OrderRecord | undefined;
    const orderLabel = resolveOrderLabel(updated ?? order);
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'update',
      entityType: 'pedido',
      entityId: orderId,
      entityLabel: orderLabel,
      summary: `Descontó faltantes reservados del pedido #${orderLabel}`,
    });

    res.json({
      id: orderId,
      items: updated?.items ?? consumption.items,
      estadoStock: updated?.estadoStock ?? consumption.estadoStock,
      stockPreparado: updated?.stockPreparado ?? consumption.stockPreparado,
      stockDescontado: updated?.stockDescontado ?? consumption.stockDescontado,
      stockWarning: consumption.stockWarning,
      stockOperaciones: updated?.stockOperaciones ?? stockOperaciones,
    });
  } catch (error) {
    if (error instanceof OrderStockError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Error consuming pending order stock';
    res.status(500).json({ error: message });
  }
});

router.delete('/:businessId/:orderId', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data() as OrderRecord;

    if (isCancelledStatus(order.estado)) {
      return res.status(400).json({ error: 'El pedido ya está cancelado.' });
    }

    await validateOrderCancellation(businessId, orderId, order as Record<string, unknown>);

    const stockRestored = await restoreStockForOrder(businessId, orderId, order);
    const reservationsReleased =
      order.stockPreparado && !order.stockDescontado
        ? await releaseOrderStockReservations(businessId, orderId, order)
        : false;
    const cajaReverted = await reverseCashMovementsForOrder(businessId, orderId, order);

    await doc.ref.update({
      estado: 'cancelado',
      cancelledAt: new Date().toISOString(),
      stockRestaurado: stockRestored || order.stockRestaurado || false,
      stockDescontado: stockRestored ? false : order.stockDescontado ?? false,
      stockPreparado: reservationsReleased ? false : order.stockPreparado ?? false,
      cajaRevertida: cajaReverted || order.cajaRevertida || false,
      updatedAt: new Date().toISOString(),
    });

    const orderLabel = resolveOrderLabel(order);
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'orders',
      action: 'cancel',
      entityType: 'pedido',
      entityId: orderId,
      entityLabel: orderLabel,
      summary: `Canceló el pedido #${orderLabel}`,
    });

    res.json({ id: orderId, estado: 'cancelado', stockRestored, cajaReverted });
  } catch (error) {
    const mapped = mapDeletionError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    res.status(500).json({ error: 'Error cancelling order' });
  }
});

export default router;
