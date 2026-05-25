import express from 'express';
import { db } from '../firebase.ts';
import {
  mapDeletionError,
  validateOrderCancellation,
} from '../utils/deletion-guards.ts';
import { allocateOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import { createSaleFromOrder } from '../utils/create-sale-from-order.ts';
import { createCompanyRouter } from './create-company-router.ts';

const router = createCompanyRouter();

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
  stockRestaurado?: boolean;
  cajaRevertida?: boolean;
  cancelledAt?: string;
  entregadoAt?: string;
  ventaId?: string;
  costoReal?: number;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
};

function sumPagos(pagos: OrderPayment[] = []) {
  return pagos.reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

function sumPagosHaciaTotal(pagos: OrderPayment[] = []) {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
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
  return !!(
    order.seniaBloqueada ||
    order.movimientoSeniaId ||
    (order.pagos?.length ?? 0) > 0
  );
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
): Promise<Partial<OrderRecord>> {
  const total = Number(order.total) || 0;
  const pagosBase = normalizePagos(order);
  const pagadoActual = sumPagosHaciaTotal(pagosBase);
  const saldoPedido = Math.max(0, total - pagadoActual);

  if (saldoPedido <= 0 || !orderAllowsPayments(order)) {
    return { entregadoAt: new Date().toISOString() };
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

  const totalPagado = sumPagos(pagos);
  const saldo = Math.max(0, total - sumPagosHaciaTotal(pagos));

  return {
    pagos,
    totalPagado,
    saldo,
    seniaBloqueada: true,
    entregadoAt: new Date().toISOString(),
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

function productControlsStock(data: Record<string, unknown> | undefined): boolean {
  return data?.controlaStock !== false;
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

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock - qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'salida',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: `Pedido #${resolveOrderLabel(order)} confirmado`,
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
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: 'efectivo',
    concepto: params.concepto,
    ambito: 'negocio',
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
      ambito: data.ambito === 'personal' ? 'personal' : 'negocio',
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
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: new Date().toISOString(),
      motivo: `Pedido #${orderLabel} cancelado`,
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

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
    const orders = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const dateA = Date.parse(String(a.fechaEntrega ?? a.createdAt ?? '')) || 0;
        const dateB = Date.parse(String(b.fechaEntrega ?? b.createdAt ?? '')) || 0;
        return dateB - dateA;
      });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching orders' });
  }
});

router.get('/:businessId/:orderId', async (req, res) => {
  try {
    const { businessId, orderId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });
    res.json({ id: doc.id, ...doc.data() });
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
    const willDiscountStock = !isDraft;

    if (willDiscountStock) {
      await validateStockForOrder(businessId, {
        items: orderData.items,
        estado: orderData.estado,
      });
    }

    const total = Number(orderData.total) || 0;

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
      ...orderNumberPatch,
      senia: isDraft ? seniaAmount : 0,
      totalPagado: 0,
      saldo: total,
      pagos: [],
      seniaBloqueada: false,
      stockDescontado: false,
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
      items: orderData.items,
      estado: orderData.estado,
    };

    const stockApplied = await applyStockForOrder(businessId, docRef.id, mergedOrder);

    await docRef.update({
      ...seniaPatch,
      ...orderNumberPatch,
      stockDescontado: stockApplied,
    });

    res.status(201).json({ id: docRef.id });
  } catch (error) {
    if (error instanceof StockValidationError) {
      return res.status(400).json({ error: error.message });
    }
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
      return res.status(400).json({ error: 'Registrá la seña al confirmar el pedido primero.' });
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
    } else if (isDraftStatus(mergedEstado) && !existingOrder.seniaBloqueada) {
      orderData.saldo = Number(orderData.total ?? existingOrder.total) || 0;
      mergedOrder.saldo = orderData.saldo;
    }

    let stockDescontado = mergedOrder.stockDescontado ?? false;

    if (!stockDescontado && !isDraftStatus(mergedOrder.estado)) {
      stockDescontado = await applyStockForOrder(businessId, orderId, mergedOrder);
    }

    let deliveryPatch: Partial<OrderRecord> = {};
    const previousEstado = resolveOrderEstado(existingOrder.estado);
    const nextEstado = resolveOrderEstado(mergedEstado);

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
    });
  } catch (error) {
    if (error instanceof StockValidationError) {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Error updating order';
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
    const cajaReverted = await reverseCashMovementsForOrder(businessId, orderId, order);

    await doc.ref.update({
      estado: 'cancelado',
      cancelledAt: new Date().toISOString(),
      stockRestaurado: stockRestored || order.stockRestaurado || false,
      stockDescontado: stockRestored ? false : order.stockDescontado ?? false,
      cajaRevertida: cajaReverted || order.cajaRevertida || false,
      updatedAt: new Date().toISOString(),
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
