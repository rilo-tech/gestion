/**
 * Application service único de pedidos: create + finalize.
 * ERP y WhatsApp deben usar estas funciones (misma contabilidad / stock / caja).
 */
import { db } from '../../firebase.ts';
import { allocateOrderNumber, formatOrderNumber, resolveOrderLabel } from '../../utils/order-number.ts';
import { normalizeTransactionDateToIso } from '../../utils/transaction-date.ts';
import {
  enrichOrderItemsStockControl,
  consumeOrderStockOnDelivery,
  type OrderLineStock,
} from '../../utils/order-stock-reservations.ts';
import {
  applyEntregaCompletaPayment,
  applyEntregaConSaldoVenta,
  isCancelledStatus,
  isDeliveredEstado,
  isDraftStatus,
  normalizePagos,
  orderAllowsPayments,
  resolveOrderEstado,
  resolveOrderGananciaForStorage,
  type OrderPayment,
  type OrderRecord,
} from '../../routes/orders.ts';
import { loadCajaConfig } from '../cash/cash-service.ts';
import { getBusinessCashAmbitoId } from '../../utils/caja-ambitos.ts';
import { resolveOrderBalance } from '../../../shared/order-balance.ts';
import {
  assertNoUndefinedDeep,
  stripUndefinedDeep,
  toFirestoreOrderItem,
} from '../../whatsapp/firestore-mappers.ts';

function omitUndefinedFields(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

/** Normaliza líneas ERP/WA para Firestore (sin undefined anidados). */
function sanitizeOrderItemsForFirestore(items: OrderRecord['items'] | OrderLineStock[]): unknown[] {
  return (items ?? []).map((line) =>
    toFirestoreOrderItem({
      stockItemId: (line as { stockItemId?: string }).stockItemId,
      nombre: (line as { nombre?: string }).nombre,
      cantidad: (line as { cantidad?: number }).cantidad,
      precioVenta: (line as { precioVenta?: number }).precioVenta,
      costoUnitario: (line as { costoUnitario?: number }).costoUnitario,
      controlaStock: (line as { controlaStock?: boolean }).controlaStock,
      costosExtra: (line as { costosExtra?: Array<{ nombre?: string; costo?: number }> }).costosExtra,
      costoPersonalizacion: (line as { costoPersonalizacion?: number }).costoPersonalizacion,
      tipoLinea: (line as { tipoLinea?: 'producto' | 'concepto' }).tipoLinea,
      mueveStock: (line as { mueveStock?: boolean }).mueveStock,
      precioUnitario: (line as { precioUnitario?: number }).precioUnitario,
      subtotal: (line as { subtotal?: number }).subtotal,
    })
  );
}

export type OrderSource = 'erp' | 'whatsapp' | 'system';

export type CreateOrderCommand = {
  businessId: string;
  source: OrderSource;
  clientId: string;
  clientName: string;
  items: OrderRecord['items'];
  total: number;
  costoReal?: number;
  estado?: string;
  fechaEntrega?: string | null;
  descripcion?: string;
  /** Seña / cobro inicial. Solo caja si > 0. */
  seniaAmount?: number;
  paymentMethod?: string;
  isDraft?: boolean;
  extras?: Record<string, unknown>;
  actorPhone?: string;
};

export type CreateOrderResult = {
  orderId: string;
  numeroPedido: number | null;
  numeroPedidoLabel: string | null;
  total: number;
  totalPagado: number;
  saldo: number;
  estado: string;
  movimientoSeniaId: string | null;
};

export type FinalizeOrderMode = 'full' | 'partial' | 'pending';

export type FinalizeOrderCommand = {
  businessId: string;
  orderId: string;
  source: OrderSource;
  /** full = cobra saldo completo; partial = cobra amountPaid; pending = entrega con saldo */
  mode: FinalizeOrderMode;
  amountPaid?: number;
  paymentMethod?: string;
};

export type FinalizeOrderResult = {
  orderId: string;
  estado: string;
  total: number;
  totalPagado: number;
  saldo: number;
  ventaId: string | null;
  ventaLabel: string | null;
  alreadyFinalized: boolean;
};

async function createCashIncomeForOrder(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    origenTipo: string;
    clienteId?: string;
    pedidoId?: string;
    numeroPedido?: number | null;
    numeroPedidoLabel?: string | null;
    medio?: string;
  }
): Promise<string> {
  const caja = await loadCajaConfig(businessId);
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: params.medio || 'efectivo',
    concepto: params.concepto,
    ambito: getBusinessCashAmbitoId(caja),
    fecha: new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: 'pedido',
    pedidoId: params.pedidoId ?? null,
    numeroPedido: params.numeroPedido ?? null,
    numeroPedidoLabel: params.numeroPedidoLabel ?? null,
    clienteId: params.clienteId ?? null,
    negocioId: businessId,
  });
  return docRef.id;
}

async function registerInitialSeniaShared(
  businessId: string,
  orderId: string,
  orderData: Pick<
    OrderRecord,
    'senia' | 'total' | 'clienteId' | 'numeroPedido' | 'numeroPedidoLabel'
  > & { paymentMethod?: string }
): Promise<Partial<OrderRecord>> {
  const senia = Number(orderData.senia) || 0;
  const total = Number(orderData.total) || 0;
  if (senia <= 0) {
    return {
      pagos: [],
      totalPagado: 0,
      saldo: total,
      seniaBloqueada: false,
      movimientoSeniaId: null,
    };
  }

  const orderLabel = resolveOrderLabel(orderData);
  const movimientoCajaId = await createCashIncomeForOrder(businessId, {
    monto: senia,
    concepto: `Seña pedido #${orderLabel}`,
    origenId: orderId,
    origenTipo: 'pedido_senia',
    clienteId: orderData.clienteId,
    pedidoId: orderId,
    numeroPedido: orderData.numeroPedido,
    numeroPedidoLabel: orderData.numeroPedidoLabel ?? orderLabel,
    medio: orderData.paymentMethod,
  });

  const pago: OrderPayment = {
    id: `pago_${Date.now()}`,
    tipo: 'seña',
    monto: senia,
    fecha: new Date().toISOString(),
    movimientoCajaId,
  };

  return {
    pagos: [pago],
    totalPagado: senia,
    saldo: Math.max(0, Math.round((total - senia) * 100) / 100),
    senia,
    seniaBloqueada: true,
    movimientoSeniaId: movimientoCajaId,
  };
}

/** Política stock standard_v1: reserva al abrir; consumo físico al entregar; libera al cancelar (vía order-stock helpers). */
export async function createOrder(command: CreateOrderCommand): Promise<CreateOrderResult> {
  const businessId = command.businessId;
  const isDraft = Boolean(command.isDraft) || isDraftStatus(command.estado);
  const total = Math.round((Number(command.total) || 0) * 100) / 100;
  const seniaAmount = Math.max(0, Math.round((Number(command.seniaAmount) || 0) * 100) / 100);
  const estado = isDraft ? 'borrador' : String(command.estado || 'pendiente');

  const normalizedItems = await enrichOrderItemsStockControl(
    businessId,
    (command.items ?? []) as OrderLineStock[]
  );

  let orderNumberPatch: Partial<OrderRecord> = {};
  if (!isDraft) {
    const allocated = await allocateOrderNumber(businessId);
    orderNumberPatch = {
      numeroPedido: allocated.numero,
      numeroPedidoLabel: allocated.label,
    };
  }

  const costoReal = Number(command.costoReal) || 0;
  const now = normalizeTransactionDateToIso(new Date().toISOString());
  const extras = omitUndefinedFields({ ...(command.extras ?? {}) });
  // Campos canónicos del comando ganan sobre extras (evita undefined del route).
  delete extras.items;
  delete extras.clienteId;
  delete extras.clienteNombre;
  delete extras.total;
  delete extras.costoReal;
  delete extras.estado;
  delete extras.fechaEntrega;
  delete extras.descripcion;
  delete extras.senia;
  delete extras.pagos;
  delete extras.totalPagado;
  delete extras.saldo;
  delete extras.seniaBloqueada;
  delete extras.movimientoSeniaId;
  delete extras.negocioId;
  delete extras.createdAt;
  delete extras.numeroPedido;
  delete extras.numeroPedidoLabel;

  const baseDoc = stripUndefinedDeep(
    omitUndefinedFields({
      ...extras,
      clienteId: command.clientId,
      clienteNombre: command.clientName,
      descripcion: command.descripcion ?? '',
      estado,
      fechaEntrega: command.fechaEntrega
        ? normalizeTransactionDateToIso(command.fechaEntrega)
        : null,
      items: sanitizeOrderItemsForFirestore(normalizedItems),
      total,
      costoReal,
      gananciaEstimada: resolveOrderGananciaForStorage(total, costoReal, estado),
      esDonacion: total === 0,
      senia: isDraft ? seniaAmount : 0,
      totalPagado: 0,
      saldo: total,
      pagos: [],
      seniaBloqueada: false,
      stockDescontado: false,
      stockPreparado: false,
      estadoStock: 'sin_preparar',
      negocioId: businessId,
      createdAt: now,
      origenWhatsapp: command.source === 'whatsapp',
      ...(command.actorPhone ? { whatsappPhone: command.actorPhone } : {}),
      ...orderNumberPatch,
    })
  );
  assertNoUndefinedDeep(baseDoc, 'pedido.create');

  const docRef = await db.collection(`negocios/${businessId}/pedidos`).add(baseDoc);

  let seniaPatch: Partial<OrderRecord> = {};
  if (!isDraft && seniaAmount > 0) {
    seniaPatch = await registerInitialSeniaShared(businessId, docRef.id, {
      senia: seniaAmount,
      total,
      clienteId: command.clientId,
      numeroPedido: orderNumberPatch.numeroPedido,
      numeroPedidoLabel: orderNumberPatch.numeroPedidoLabel,
      paymentMethod: command.paymentMethod,
    });
    await docRef.update(seniaPatch);
  }

  const totalPagado = Number(seniaPatch.totalPagado) || 0;
  const saldo =
    seniaPatch.saldo != null ? Number(seniaPatch.saldo) : total;

  return {
    orderId: docRef.id,
    numeroPedido: orderNumberPatch.numeroPedido ?? null,
    numeroPedidoLabel: orderNumberPatch.numeroPedidoLabel ?? null,
    total,
    totalPagado,
    saldo,
    estado,
    movimientoSeniaId: (seniaPatch.movimientoSeniaId as string) ?? null,
  };
}

/**
 * Finaliza entrega del pedido (SSOT).
 * - full: cobra saldo restante + venta + entregado
 * - partial: cobra amountPaid, resto queda saldo (entrega con saldo vía applyEntregaConSaldo + pago parcial)
 * - pending: entrega sin cobrar más (queda debiendo)
 */
export async function finalizeOrder(command: FinalizeOrderCommand): Promise<FinalizeOrderResult> {
  const { businessId, orderId, mode } = command;
  const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    throw new Error('ORDER_NOT_FOUND');
  }

  const order = snap.data() as OrderRecord;
  const estadoActual = resolveOrderEstado(order.estado);

  if (isCancelledStatus(order.estado)) {
    throw new Error('ORDER_CANCELLED');
  }

  if (isDeliveredEstado(estadoActual) && order.entregadoAt) {
    const balance = resolveOrderBalance(order);
    return {
      orderId,
      estado: estadoActual,
      total: balance.total,
      totalPagado: balance.totalPagado,
      saldo: balance.saldo,
      ventaId: order.ventaId ?? null,
      ventaLabel: order.ventaLabel ?? null,
      alreadyFinalized: true,
    };
  }

  if (isDraftStatus(order.estado) || !orderAllowsPayments(order)) {
    throw new Error('ORDER_NOT_READY');
  }

  const balance = resolveOrderBalance(order);
  const saldo = balance.saldo;
  let amountPaid = 0;
  if (mode === 'full') {
    amountPaid = saldo;
  } else if (mode === 'partial') {
    amountPaid = Math.max(0, Math.round((Number(command.amountPaid) || 0) * 100) / 100);
    if (amountPaid <= 0) throw new Error('AMOUNT_REQUIRED');
    if (amountPaid > saldo + 0.009) throw new Error('AMOUNT_EXCEEDS_BALANCE');
  }

  // Stock físico al entregar (política standard_v1).
  try {
    await consumeOrderStockOnDelivery(businessId, orderId, order as never);
  } catch {
    // Si ya consumido o sin stock controlado, continuar.
  }

  let deliveryPatch: Partial<OrderRecord> & { ventaLabel?: string } = {};
  const paymentMethod = command.paymentMethod?.trim() || undefined;

  if (mode === 'pending' || (mode === 'partial' && amountPaid < saldo - 0.009)) {
    // Entrega dejando saldo: primero registrar pago parcial si hay, luego venta con saldo.
    if (amountPaid > 0) {
      const orderLabel = resolveOrderLabel(order);
      const movimientoCajaId = await createCashIncomeForOrder(businessId, {
        monto: amountPaid,
        concepto: `Pago pedido #${orderLabel}`,
        origenId: orderId,
        origenTipo: 'pedido_pago',
        clienteId: order.clienteId,
        pedidoId: orderId,
        numeroPedido: order.numeroPedido,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        medio: paymentMethod,
      });
      const pagosBase = normalizePagos(order);
      const pagos: OrderPayment[] = [
        ...pagosBase,
        {
          id: `pago_entrega_${Date.now()}`,
          tipo: 'pago',
          monto: amountPaid,
          fecha: new Date().toISOString(),
          movimientoCajaId,
          notas: 'Pago parcial (entrega)',
        },
      ];
      const totalPagado = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
      await orderRef.update({
        pagos,
        totalPagado,
        saldo: Math.max(0, Math.round((balance.total - totalPagado) * 100) / 100),
      });
      const refreshed = (await orderRef.get()).data() as OrderRecord;
      deliveryPatch = await applyEntregaConSaldoVenta(businessId, orderId, refreshed);
    } else {
      deliveryPatch = await applyEntregaConSaldoVenta(businessId, orderId, order);
    }
  } else {
    // Cobro completo del saldo
    if (paymentMethod && amountPaid > 0) {
      // Parche temporal del medio en createCashIncome interno vía applyEntregaCompleta:
      // si el pedido no tiene venta aún, applyEntregaCompleta crea venta+caja.
      // Inyectamos medio preferido en order para que createSaleFromOrder lo use si aplica.
      (order as OrderRecord & { medioPagoPreferido?: string }).medioPagoPreferido = paymentMethod;
    }
    deliveryPatch = await applyEntregaCompletaPayment(businessId, orderId, order);
  }

  const updatePayload: Record<string, unknown> = {
    ...deliveryPatch,
    estado: 'entregado',
    entregadoAt: deliveryPatch.entregadoAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  updatePayload.gananciaEstimada = resolveOrderGananciaForStorage(
    Number(order.total) || 0,
    Number(order.costoReal) || 0,
    'entregado',
    order.gananciaEstimada
  );

  await orderRef.update(updatePayload);
  const after = (await orderRef.get()).data() as OrderRecord;
  const afterBalance = resolveOrderBalance(after);

  return {
    orderId,
    estado: 'entregado',
    total: afterBalance.total,
    totalPagado: afterBalance.totalPagado,
    saldo: afterBalance.saldo,
    ventaId: after.ventaId ?? null,
    ventaLabel: (deliveryPatch.ventaLabel as string) ?? after.ventaLabel ?? null,
    alreadyFinalized: false,
  };
}

export function orderDomainEffectsSnapshot(result: CreateOrderResult | FinalizeOrderResult) {
  return {
    total: 'total' in result ? result.total : 0,
    totalPagado: result.totalPagado,
    saldo: result.saldo,
    estado: result.estado,
  };
}
