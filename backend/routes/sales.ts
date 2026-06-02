import express from 'express';
import { db } from '../firebase.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { allocateSaleNumber, resolveSaleLabel } from '../utils/sale-number.ts';
import { createCompromisoPago, parseCompromisoInput } from '../utils/payment-commitments.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { isPrivilegedRole } from '../auth/constants.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import { normalizeTransactionDateToIso } from '../utils/transaction-date.ts';
import {
  calculateSaleCostFromItems,
  isSaleProfitRecognizedInMonth,
  resolveSaleCostoReal,
  resolveSaleGananciaEstimada,
} from '../utils/sale-profit-recognition.ts';
import {
  getBusinessCashAmbitoId,
  resolveCashReversalAmbito,
} from '../utils/caja-ambitos.ts';
import { scheduleStockMetricsRefresh } from '../utils/stock-metrics.ts';
import { productControlsStock } from '../utils/stock-product.ts';
import {
  consumeOrderStockOnDelivery,
  orderHasPendingPhysicalStock,
} from '../utils/order-stock-reservations.ts';

const router = createCompanyRouter();

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return {};
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
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
};

type OrderRecord = {
  clienteId?: string;
  estado?: string;
  total?: number;
  saldo?: number;
  totalPagado?: number;
  pagos?: OrderPayment[];
  items?: OrderLine[];
  senia?: number;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  stockDescontado?: boolean;
  ventaId?: string;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  descripcion?: string;
  costoReal?: number;
};

type SaleLineExtraCost = {
  nombre: string;
  costo: number;
};

type SaleLine = {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: SaleLineExtraCost[];
};

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

function isDeliveredStatus(estado?: string) {
  const value = normalizeEstado(estado);
  if (
    value === 'entregado_con_saldo' ||
    value.includes('entregado_con_saldo') ||
    value.includes('entregado con saldo')
  ) {
    return true;
  }
  return value === 'entregado' || (value.includes('entregad') && !value.includes('saldo'));
}

function normalizePagos(order: OrderRecord): OrderPayment[] {
  const pagos = [...(order.pagos ?? [])];
  if (pagos.length === 0 && order.movimientoSeniaId && Number(order.senia) > 0) {
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

function sumPagosHaciaTotal(pagos: OrderPayment[] = []) {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

function getPagadoHaciaPedido(order: OrderRecord): number {
  const pagos = normalizePagos(order);
  if (pagos.length > 0) return sumPagosHaciaTotal(pagos);
  return Number(order.totalPagado) || 0;
}

function orderIsConfirmed(order: OrderRecord): boolean {
  return !!(
    order.stockDescontado ||
    order.seniaBloqueada ||
    order.movimientoSeniaId ||
    (order.pagos?.length ?? 0) > 0
  );
}

function orderEligibleForSale(order: OrderRecord): boolean {
  if (isCancelledStatus(order.estado)) return false;
  if (isDraftStatus(order.estado)) return false;
  if (order.ventaId) return false;
  if (isDeliveredStatus(order.estado)) return false;
  if (!orderIsConfirmed(order)) return false;

  const estado = normalizeEstado(order.estado);
  return (
    estado === 'listo' ||
    estado.includes('listo') ||
    estado === 'en_produccion' ||
    estado.includes('produccion') ||
    estado === 'pendiente' ||
    estado.includes('pendiente')
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

function normalizeSaleLineExtraCosts(
  raw: unknown,
  legacyPersonalizacion?: number
): SaleLineExtraCost[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const data = entry as Record<string, unknown>;
        const nombre = String(data.nombre ?? '').trim();
        const costo = Number(data.costo) || 0;
        if (!nombre && costo <= 0) return null;
        return { nombre: nombre || 'Costo extra', costo };
      })
      .filter((entry): entry is SaleLineExtraCost => entry !== null);
  }

  const legacy = Number(legacyPersonalizacion) || 0;
  return legacy > 0 ? [{ nombre: 'Personalización', costo: legacy }] : [];
}

function sumLinePersonalizationCost(line: {
  costosExtra?: SaleLineExtraCost[];
  costoPersonalizacion?: number;
  cantidad?: number;
}): number {
  const fromList = (line.costosExtra ?? []).reduce(
    (acc, extra) => acc + (Number(extra.costo) || 0),
    0
  );
  if (fromList > 0) {
    const qty = Math.max(0, Number(line.cantidad) || 0);
    return qty * fromList;
  }
  return Number(line.costoPersonalizacion) || 0;
}

function calculateSaleCost(items: SaleLine[]): number {
  return calculateSaleCostFromItems(items);
}

function buildSaleLineFromOrderLine(line: OrderLine): SaleLine {
  const cantidad = Number(line.cantidad) || 0;
  const precioUnitario = Number(line.precioVenta) || 0;
  const costosExtra = normalizeSaleLineExtraCosts(line.costosExtra, line.costoPersonalizacion);
  const costoPersonalizacion = sumLinePersonalizationCost({
    costosExtra,
    costoPersonalizacion: line.costoPersonalizacion,
    cantidad,
  });

  return {
    stockItemId: String(line.stockItemId ?? ''),
    nombre: String(line.nombre ?? 'Producto'),
    cantidad,
    precioUnitario,
    subtotal: cantidad * precioUnitario,
    costoUnitario: Number(line.costoUnitario) || 0,
    costoPersonalizacion,
    costosExtra,
  };
}

function buildSaleEconomics(items: SaleLine[], total: number, fallbackCostoReal?: number) {
  const calculated = calculateSaleCost(items);
  const fallback = Number(fallbackCostoReal) || 0;
  const costoReal = Math.max(calculated, fallback);
  const gananciaEstimada = Math.round((total - costoReal) * 100) / 100;
  return { costoReal, gananciaEstimada };
}

async function createCashIncome(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    origenTipo: string;
    medio?: string;
    clienteId?: string;
    pedidoId?: string | null;
    ventaId?: string | null;
    numeroPedido?: number | null;
    numeroPedidoLabel?: string | null;
    ventaLabel?: string | null;
  }
) {
  const caja = await loadCajaConfig(businessId);
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: params.medio ?? 'efectivo',
    concepto: params.concepto,
    ambito: getBusinessCashAmbitoId(caja),
    fecha: new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: 'venta',
    pedidoId: params.pedidoId ?? null,
    ventaId: params.ventaId ?? null,
    ventaLabel: params.ventaLabel ?? null,
    numeroPedido: params.numeroPedido ?? null,
    numeroPedidoLabel: params.numeroPedidoLabel ?? null,
    clienteId: params.clienteId ?? null,
    negocioId: businessId,
  });
  return docRef.id;
}

async function reverseCashMovement(
  businessId: string,
  movimientoId: string,
  params: {
    origenId: string;
    origenTipo: string;
    ventaId?: string | null;
    ventaLabel?: string | null;
    clienteId?: string | null;
  }
): Promise<boolean> {
  const movimientosRef = db.collection(`negocios/${businessId}/movimientos_caja`);
  const snap = await movimientosRef.doc(movimientoId).get();
  if (!snap.exists) return false;

  const data = snap.data() ?? {};
  if (data.tipo !== 'ingreso') return false;

  const conceptoBase = String(data.concepto ?? 'Cobro venta').trim();
  const caja = await loadCajaConfig(businessId);
  await movimientosRef.add({
    tipo: 'egreso',
    monto: Number(data.monto) || 0,
    medio: data.medio ?? 'efectivo',
    concepto: `Anulación ${conceptoBase}`,
    ambito: resolveCashReversalAmbito(data.ambito, caja),
    fecha: new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: 'venta',
    ventaId: params.ventaId ?? null,
    ventaLabel: params.ventaLabel ?? null,
    movimientoAnuladoId: movimientoId,
    clienteId: params.clienteId ?? null,
    negocioId: businessId,
  });
  return true;
}

async function restoreStockForVenta(
  businessId: string,
  ventaId: string,
  ventaLabel: string,
  items: SaleLine[]
): Promise<void> {
  const timestamp = new Date().toISOString();

  for (const line of items) {
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const itemData = itemSnap.data() ?? {};
    if (!productControlsStock(itemData)) continue;

    const currentStock = Number(itemData.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty, updatedAt: timestamp });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: timestamp,
      motivo: `Anulación venta #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta_anulada',
      origenGrupo: 'venta',
      ventaId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  }

  scheduleStockMetricsRefresh(businessId);
}

/** Revierte salidas de depósito registradas al crear la venta (productos que controlan stock). */
async function reverseStockMovementsForDeletedVenta(
  businessId: string,
  ventaId: string,
  ventaLabel: string,
  items: SaleLine[]
): Promise<void> {
  const salidaByProduct = new Map<string, number>();
  const stockSnap = await db
    .collection(`negocios/${businessId}/movimientos_stock`)
    .where('ventaId', '==', ventaId)
    .get();

  for (const doc of stockSnap.docs) {
    const data = doc.data() ?? {};
    if (data.tipo !== 'salida') continue;
    const origenTipo = String(data.origenTipo ?? '');
    if (origenTipo === 'venta_anulada') continue;
    if (!origenTipo.startsWith('venta')) continue;

    const productoId = String(data.productoId ?? '').trim();
    const qty = Number(data.cantidad) || 0;
    if (!productoId || qty <= 0) continue;
    salidaByProduct.set(productoId, (salidaByProduct.get(productoId) ?? 0) + qty);
  }

  if (salidaByProduct.size === 0) {
    await restoreStockForVenta(businessId, ventaId, ventaLabel, items);
    return;
  }

  const timestamp = new Date().toISOString();

  for (const [productoId, qty] of salidaByProduct) {
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(productoId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const itemData = itemSnap.data() ?? {};
    if (!productControlsStock(itemData)) continue;

    const currentStock = Number(itemData.stockActual) || 0;
    await itemRef.update({ stockActual: currentStock + qty, updatedAt: timestamp });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: timestamp,
      motivo: `Anulación venta #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta_anulada',
      origenGrupo: 'venta',
      ventaId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  }

  scheduleStockMetricsRefresh(businessId);
}

async function collectCashMovementIdsForDeletedVenta(
  businessId: string,
  ventaId: string,
  venta: Record<string, unknown>
): Promise<Set<string>> {
  const ids = new Set<string>();

  if (venta.movimientoCajaId) ids.add(String(venta.movimientoCajaId));
  for (const cobro of Array.isArray(venta.cobros) ? venta.cobros : []) {
    if (cobro?.movimientoCajaId) ids.add(String(cobro.movimientoCajaId));
  }

  const cashSnap = await db
    .collection(`negocios/${businessId}/movimientos_caja`)
    .where('ventaId', '==', ventaId)
    .get();

  for (const doc of cashSnap.docs) {
    const data = doc.data() ?? {};
    if (data.tipo !== 'ingreso') continue;
    if (data.movimientoAnuladoId) continue;
    const origenTipo = String(data.origenTipo ?? '');
    if (origenTipo === 'venta_eliminada') continue;
    ids.add(doc.id);
  }

  return ids;
}

function isDraftSaleEstado(estado?: unknown): boolean {
  return String(estado ?? '').trim().toLowerCase() === 'borrador';
}

function buildMostradorDraftFields(params: {
  clienteId: string;
  items: SaleLine[];
  total: number;
  economics: { costoReal: number; gananciaEstimada: number };
  montoCobrado: number;
  medioPago: string;
  notas: string;
  timestamp: string;
  businessId: string;
}) {
  return {
    origen: 'mostrador',
    pedidoId: null,
    estado: 'borrador',
    clienteId: params.clienteId,
    items: params.items,
    total: params.total,
    costoReal: params.economics.costoReal,
    gananciaEstimada: params.economics.gananciaEstimada,
    totalPagadoAnterior: 0,
    montoCobrado: params.montoCobrado,
    saldoPendiente: Math.max(0, params.total - params.montoCobrado),
    medioPago: params.medioPago,
    notas: params.notas,
    fecha: params.timestamp,
    negocioId: params.businessId,
    updatedAt: params.timestamp,
  };
}

async function confirmMostradorSaleDraft(
  businessId: string,
  ventaId: string,
  reqBody: Record<string, unknown>
) {
  const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
  const ventaSnap = await ventaRef.get();
  if (!ventaSnap.exists) {
    throw new Error('SALE_NOT_FOUND');
  }

  const venta = ventaSnap.data() ?? {};
  if (!isDraftSaleEstado(venta.estado)) {
    throw new Error('NOT_DRAFT');
  }
  if (venta.origen === 'pedido') {
    throw new Error('NOT_MOSTRADOR_DRAFT');
  }

  const clienteId = String(venta.clienteId ?? '').trim();
  const items = (Array.isArray(venta.items) ? venta.items : []) as SaleLine[];
  const total = Number(venta.total) || 0;
  const montoCobrado = Number(venta.montoCobrado) || 0;
  const medioPago = String(venta.medioPago ?? 'efectivo').trim() || 'efectivo';
  const notas = String(venta.notas ?? '').trim();
  const timestamp = new Date().toISOString();

  if (!clienteId) {
    throw new Error('CLIENT_REQUIRED');
  }
  if (items.length === 0) {
    throw new Error('EMPTY_DRAFT');
  }
  if (montoCobrado > total) {
    throw new Error('INVALID_AMOUNT');
  }

  const { numero: numeroVenta, label: ventaLabel } = await allocateSaleNumber(businessId);

  await ventaRef.update({
    estado: 'confirmada',
    numeroVenta,
    ventaLabel,
    updatedAt: timestamp,
  });

  for (const line of items) {
    const stockError = await applyStockForVenta(businessId, ventaId, ventaLabel, [line]);
    if (stockError) {
      await reverseStockMovementsForDeletedVenta(businessId, ventaId, ventaLabel, items);
      await ventaRef.update({
        estado: 'borrador',
        numeroVenta: null,
        ventaLabel: 'Borrador',
        updatedAt: timestamp,
      });
      throw new Error(stockError);
    }
  }

  let movimientoCajaId: string | null = null;
  if (montoCobrado > 0) {
    movimientoCajaId = await createCashIncome(businessId, {
      monto: montoCobrado,
      concepto: `Venta mostrador #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta_mostrador',
      medio: medioPago,
      clienteId,
      ventaId,
      ventaLabel,
      pedidoId: null,
    });
    await ventaRef.update({ movimientoCajaId });
  }

  const saldoPendiente = Math.max(0, total - montoCobrado);
  const compromisoId = await maybeCreateCompromisoPago(businessId, {
    body: reqBody,
    saldoPendiente,
    clienteId,
    origenTipo: 'venta',
    origenId: ventaId,
    referenciaLabel: `Venta mostrador #${ventaLabel}`,
    ventaId,
  });

  if (compromisoId) {
    await ventaRef.update({ compromisoPagoId: compromisoId });
  }

  return {
    id: ventaId,
    ventaLabel,
    total,
    montoCobrado,
    saldoPendiente,
    compromisoPagoId: compromisoId,
  };
}

async function applyStockForVenta(
  businessId: string,
  ventaId: string,
  ventaLabel: string,
  items: SaleLine[]
): Promise<string | null> {
  const timestamp = new Date().toISOString();

  for (const line of items) {
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      return `Uno de los productos seleccionados no existe.`;
    }

    const itemData = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(itemData)) continue;

    const currentStock = Number(itemData.stockActual) || 0;
    if (currentStock - line.cantidad < 0) {
      return `Stock insuficiente para "${line.nombre}": hay ${currentStock} u., pediste ${line.cantidad} u.`;
    }

    await itemRef.update({
      stockActual: currentStock - line.cantidad,
      updatedAt: timestamp,
    });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'salida',
      cantidad: line.cantidad,
      fecha: timestamp,
      motivo: `Venta mostrador #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta',
      origenGrupo: 'venta',
      ventaId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  }

  scheduleStockMetricsRefresh(businessId);
  return null;
}

async function validateStockForEdit(
  businessId: string,
  oldItems: SaleLine[],
  newItems: SaleLine[]
): Promise<string | null> {
  const deltaMap = new Map<string, { delta: number; nombre: string }>();

  for (const line of oldItems) {
    if (!line.stockItemId) continue;
    const current = deltaMap.get(line.stockItemId) ?? { delta: 0, nombre: line.nombre };
    current.delta += Number(line.cantidad) || 0;
    deltaMap.set(line.stockItemId, current);
  }

  for (const line of newItems) {
    if (!line.stockItemId) continue;
    const current = deltaMap.get(line.stockItemId) ?? { delta: 0, nombre: line.nombre };
    current.delta -= Number(line.cantidad) || 0;
    current.nombre = line.nombre || current.nombre;
    deltaMap.set(line.stockItemId, current);
  }

  for (const [stockItemId, entry] of deltaMap) {
    if (entry.delta >= 0) continue;

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    if (!itemSnap.exists) {
      return `Uno de los productos seleccionados no existe.`;
    }

    const itemData = itemSnap.data() ?? {};
    if (!productControlsStock(itemData)) continue;

    const currentStock = Number(itemData.stockActual) || 0;
    const needed = Math.abs(entry.delta);
    if (currentStock < needed) {
      return `Stock insuficiente para "${entry.nombre}": hay ${currentStock} u., faltan ${needed} u.`;
    }
  }

  return null;
}

async function buildMostradorItemsFromBody(
  businessId: string,
  rawItems: unknown
): Promise<{ items: SaleLine[]; total: number; error?: string }> {
  const draftItems = (Array.isArray(rawItems) ? rawItems : [])
    .map((line: Record<string, unknown>) => ({
      stockItemId: String(line.stockItemId ?? '').trim(),
      cantidad: Number(line.cantidad) || 0,
      precioUnitario: Number(line.precioUnitario) || 0,
      costoUnitario: Number(line.costoUnitario) || 0,
      costosExtra: line.costosExtra,
      costoPersonalizacion: Number(line.costoPersonalizacion) || 0,
      nombre: String(line.nombre ?? '').trim(),
    }))
    .filter((line) => line.stockItemId && line.cantidad > 0);

  if (draftItems.length === 0) {
    return { items: [], total: 0, error: 'Agregá al menos un producto con cantidad.' };
  }

  const items: SaleLine[] = [];
  let total = 0;

  for (const line of draftItems) {
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      return { items: [], total: 0, error: 'Uno de los productos seleccionados no existe.' };
    }

    const itemData = itemSnap.data() ?? {};
    const subtotal = line.cantidad * line.precioUnitario;
    total += subtotal;
    const costosExtra = normalizeSaleLineExtraCosts(line.costosExtra, line.costoPersonalizacion);
    const costoPersonalizacion = sumLinePersonalizationCost({
      costosExtra,
      costoPersonalizacion: line.costoPersonalizacion,
      cantidad: line.cantidad,
    });

    items.push({
      stockItemId: line.stockItemId,
      nombre: line.nombre || String(itemData.nombre ?? 'Producto'),
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario,
      subtotal,
      costoUnitario: line.costoUnitario || Number(itemData.costo) || 0,
      costoPersonalizacion,
      costosExtra,
    });
  }

  return { items, total };
}

async function enrichSales(businessId: string, sales: Record<string, unknown>[]) {
  const clientIds = new Set<string>();
  const orderIds = new Set<string>();

  for (const sale of sales) {
    if (sale.clienteId) clientIds.add(String(sale.clienteId));
    if (sale.pedidoId) orderIds.add(String(sale.pedidoId));
  }

  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (clientId) => {
      const snap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
      if (!snap.exists) return;
      clientMap.set(clientId, String(snap.data()?.nombre ?? ''));
    })
  );

  const orderMap = new Map<
    string,
    { numeroPedidoLabel?: string; descripcion?: string; saldo?: number }
  >();
  await Promise.all(
    [...orderIds].map(async (orderId) => {
      const snap = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
      if (!snap.exists) return;
      const data = snap.data() ?? {};
      orderMap.set(orderId, {
        numeroPedidoLabel: data.numeroPedidoLabel ?? resolveOrderLabel(data as OrderRecord),
        descripcion: data.descripcion,
        saldo: Math.max(0, Number(data.saldo) || 0),
      });
    })
  );

  return sales.map((sale) => {
    const clienteId = sale.clienteId ? String(sale.clienteId) : '';
    const pedidoId = sale.pedidoId ? String(sale.pedidoId) : '';
    const orderData = pedidoId ? orderMap.get(pedidoId) : undefined;
    const storedSaldo = Math.max(0, Number(sale.saldoPendiente) || 0);
    const saldoPendiente =
      sale.origen === 'pedido' && pedidoId
        ? Math.max(storedSaldo, orderData?.saldo ?? 0)
        : storedSaldo;

    return {
      ...sale,
      ventaLabel: resolveSaleLabel(sale),
      clienteNombre: clientMap.get(clienteId) ?? '',
      numeroPedidoLabel: sale.numeroPedidoLabel ?? orderData?.numeroPedidoLabel ?? null,
      pedidoDescripcion: orderData?.descripcion ?? null,
      saldoPendiente,
    };
  });
}

router.get('/:businessId/monthly-summary', async (req, res) => {
  try {
    const { businessId } = req.params;
    const mes = Number(req.query.mes);
    const anio = Number(req.query.anio);
    if (!Number.isFinite(mes) || !Number.isFinite(anio) || mes < 1 || mes > 12) {
      return res.status(400).json({ error: 'Indicá mes y año válidos.' });
    }

    const monthStart = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const lastDay = new Date(anio, mes, 0).getDate();
    const monthEnd = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const [monthSnapshot, allSalesSnapshot, ordersSnapshot] = await Promise.all([
      db
        .collection(`negocios/${businessId}/ventas`)
        .where('fecha', '>=', `${monthStart}T00:00:00.000Z`)
        .where('fecha', '<=', `${monthEnd}T23:59:59.999Z`)
        .get(),
      db.collection(`negocios/${businessId}/ventas`).get(),
      db.collection(`negocios/${businessId}/pedidos`).get(),
    ]);

    const ordersById = new Map<string, Record<string, unknown>>();
    for (const doc of ordersSnapshot.docs) {
      ordersById.set(doc.id, doc.data());
    }

    let totalFacturado = 0;
    let totalCosto = 0;
    let count = 0;

    for (const doc of monthSnapshot.docs) {
      const data = doc.data();
      if (String(data.estado ?? '') === 'borrador') continue;
      count += 1;
      const total = Number(data.total) || 0;
      const items = (Array.isArray(data.items) ? data.items : []) as SaleLine[];
      totalFacturado += total;
      totalCosto += resolveSaleCostoReal(data, items);
    }

    let totalGanancia = 0;
    for (const doc of allSalesSnapshot.docs) {
      const data = doc.data();
      if (String(data.estado ?? '') === 'borrador') continue;

      const pedidoId = String(data.pedidoId ?? '').trim();
      const order = pedidoId ? ordersById.get(pedidoId) ?? null : null;
      if (!isSaleProfitRecognizedInMonth(data, mes, anio, order)) continue;

      totalGanancia += resolveSaleGananciaEstimada(data);
    }

    res.json({
      mes,
      anio,
      count,
      totalFacturado: Math.round(totalFacturado),
      totalCosto: Math.round(totalCosto),
      totalGanancia: Math.round(totalGanancia),
    });
  } catch (error) {
    console.error('Error fetching monthly sales summary:', error);
    res.status(500).json({ error: 'Error fetching monthly sales summary' });
  }
});

router.get('/:businessId/eligible-orders', async (req, res) => {
  try {
    const { businessId } = req.params;
    const clienteIdFilter = String(req.query.clienteId ?? '').trim();
    const searchQuery = String(req.query.q ?? '').trim().toLowerCase();

    const [ordersSnap, clientsSnap] = await Promise.all([
      db.collection(`negocios/${businessId}/pedidos`).get(),
      db.collection(`negocios/${businessId}/clientes`).get(),
    ]);

    const clientMap = new Map<string, string>();
    for (const doc of clientsSnap.docs) {
      clientMap.set(doc.id, String(doc.data()?.nombre ?? ''));
    }

    const orders = ordersSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as OrderRecord) }))
      .filter((order) => orderEligibleForSale(order))
      .filter((order) => !clienteIdFilter || order.clienteId === clienteIdFilter)
      .map((order) => {
        const total = Number(order.total) || 0;
        const totalPagadoAnterior = getPagadoHaciaPedido(order);
        const saldoPedido = Math.max(0, total - totalPagadoAnterior);
        const numeroPedidoLabel =
          order.numeroPedidoLabel ?? resolveOrderLabel(order);
        const clienteNombre = order.clienteId ? clientMap.get(order.clienteId) ?? '' : '';

        return {
          id: order.id,
          clienteId: order.clienteId,
          clienteNombre,
          estado: order.estado,
          descripcion: order.descripcion,
          total,
          totalPagadoAnterior,
          saldoPedido,
          numeroPedido: order.numeroPedido,
          numeroPedidoLabel,
          items: order.items ?? [],
          costoReal: Number(order.costoReal) || 0,
        };
      })
      .filter((order) => {
        if (!searchQuery) return true;

        const haystack = [
          order.numeroPedidoLabel,
          order.clienteNombre,
          order.descripcion,
          String(order.total),
          String(order.saldoPedido),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(searchQuery);
      })
      .sort((a, b) => {
        const labelA = String(a.numeroPedidoLabel ?? '');
        const labelB = String(b.numeroPedidoLabel ?? '');
        return labelB.localeCompare(labelA);
      });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching eligible orders for sale:', error);
    res.status(500).json({ error: 'Error fetching eligible orders' });
  }
});

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
        .collection(`negocios/${businessId}/ventas`)
        .orderBy('fecha', 'desc')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/ventas`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
      const sales = docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          ventaLabel: resolveSaleLabel(data),
        };
      });
      const enriched = await enrichSales(businessId, sales);
      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items: enriched, nextCursor, hasMore });
    }

    const snapshot = await db
      .collection(`negocios/${businessId}/ventas`)
      .orderBy('fecha', 'desc')
      .get();

    const sales = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        ventaLabel: resolveSaleLabel(data),
      };
    });

    const enriched = await enrichSales(businessId, sales);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Error fetching sales' });
  }
});

async function maybeCreateCompromisoPago(
  businessId: string,
  params: {
    body: Record<string, unknown>;
    saldoPendiente: number;
    clienteId: string | null | undefined;
    origenTipo: 'pedido' | 'venta';
    origenId: string;
    referenciaLabel: string;
    pedidoId?: string | null;
    ventaId?: string | null;
  }
): Promise<string | null> {
  if (params.saldoPendiente <= 0 || !params.clienteId) return null;

  const compromiso = parseCompromisoInput(params.body.compromisoPago);
  if (!compromiso) return null;

  return createCompromisoPago(businessId, {
    clienteId: params.clienteId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    referenciaLabel: params.referenciaLabel,
    montoTotal: params.saldoPendiente,
    compromiso,
    pedidoId: params.pedidoId,
    ventaId: params.ventaId,
  });
}

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const origen = req.body.origen === 'pedido' ? 'pedido' : 'mostrador';
    const pedidoId = String(req.body.pedidoId ?? '').trim() || null;
    const medioPago = String(req.body.medioPago ?? 'efectivo').trim() || 'efectivo';
    const notas = String(req.body.notas ?? '').trim();
    const montoCobradoInput = Number(req.body.montoCobrado);
    const timestamp = normalizeTransactionDateToIso(req.body.fecha);

    if (origen === 'pedido') {
      if (!pedidoId) {
        return res.status(400).json({ error: 'Seleccioná un pedido para registrar la venta.' });
      }

      const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(pedidoId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        return res.status(404).json({ error: 'Pedido no encontrado.' });
      }

      const order = orderSnap.data() as OrderRecord;
      if (order.ventaId) {
        return res.status(400).json({ error: 'Este pedido ya tiene una venta registrada.' });
      }
      if (!orderEligibleForSale(order)) {
        return res.status(400).json({
          error: 'El pedido no está listo para registrar la entrega como venta.',
        });
      }

      const total = Number(order.total) || 0;
      const totalPagadoAnterior = getPagadoHaciaPedido(order);
      const saldoPedido = Math.max(0, total - totalPagadoAnterior);
      const montoCobrado =
        Number.isFinite(montoCobradoInput) && montoCobradoInput >= 0
          ? montoCobradoInput
          : saldoPedido;

      if (montoCobrado > saldoPedido) {
        return res.status(400).json({
          error: `El monto a cobrar supera el saldo pendiente del pedido ($${saldoPedido}).`,
          saldoPedido,
        });
      }

      const orderLabel = resolveOrderLabel(order);
      const items: SaleLine[] = (order.items ?? []).map((line) => buildSaleLineFromOrderLine(line));
      const economics = buildSaleEconomics(items, total, order.costoReal);

      const { numero: numeroVenta, label: ventaLabel } = await allocateSaleNumber(businessId);

      const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
        origen: 'pedido',
        pedidoId,
        numeroPedido: order.numeroPedido ?? null,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        numeroVenta,
        ventaLabel,
        clienteId: order.clienteId ?? null,
        items,
        total,
        costoReal: economics.costoReal,
        gananciaEstimada: economics.gananciaEstimada,
        totalPagadoAnterior,
        montoCobrado,
        saldoPendiente: Math.max(0, total - totalPagadoAnterior - montoCobrado),
        medioPago,
        notas,
        fecha: timestamp,
        negocioId: businessId,
      });

      let movimientoCajaId: string | null = null;
      if (montoCobrado > 0) {
        movimientoCajaId = await createCashIncome(businessId, {
          monto: montoCobrado,
          concepto: `Pedido #${orderLabel} - saldado`,
          origenId: ventaRef.id,
          origenTipo: 'venta_pedido',
          medio: medioPago,
          clienteId: order.clienteId,
          pedidoId,
          ventaId: ventaRef.id,
          ventaLabel,
          numeroPedido: order.numeroPedido ?? null,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        });
      }

      const pagosBase = normalizePagos(order);
      const nuevosPagos = [...pagosBase];
      if (montoCobrado > 0) {
        nuevosPagos.push({
          id: `pago_venta_${Date.now()}`,
          tipo: 'pago',
          monto: montoCobrado,
          fecha: timestamp,
          movimientoCajaId: movimientoCajaId ?? undefined,
          notas: `Cobro venta #${ventaLabel}`,
        });
      }

      const totalPagado = totalPagadoAnterior + montoCobrado;
      const saldo = Math.max(0, total - totalPagado);

      let deliveryStockPatch: Record<string, unknown> = {};
      if (orderHasPendingPhysicalStock(order.items ?? [])) {
        const deliveryConsumption = await consumeOrderStockOnDelivery(businessId, pedidoId, order);
        deliveryStockPatch = {
          items: deliveryConsumption.items,
          stockDescontado: deliveryConsumption.stockDescontado,
          estadoStock: deliveryConsumption.estadoStock,
          stockPreparado: deliveryConsumption.stockPreparado ?? order.stockPreparado,
        };
      }

      await orderRef.update({
        ventaId: ventaRef.id,
        estado: 'entregado',
        entregadoAt: timestamp,
        pagos: nuevosPagos.map(sanitizePagoForFirestore),
        totalPagado,
        saldo,
        ...deliveryStockPatch,
      });

      if (movimientoCajaId) {
        await ventaRef.update({ movimientoCajaId });
      }

      const compromisoId = await maybeCreateCompromisoPago(businessId, {
        body: req.body,
        saldoPendiente: saldo,
        clienteId: order.clienteId,
        origenTipo: 'venta',
        origenId: ventaRef.id,
        referenciaLabel: `Venta #${ventaLabel} · Pedido #${orderLabel}`,
        pedidoId,
        ventaId: ventaRef.id,
      });

      if (compromisoId) {
        await ventaRef.update({ compromisoPagoId: compromisoId });
      }

      await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'sales',
        action: 'create',
        entityType: 'venta',
        entityId: ventaRef.id,
        entityLabel: ventaLabel,
        summary: `Registró venta por pedido #${ventaLabel} · $${total}`,
      });

      return res.status(201).json({
        id: ventaRef.id,
        ventaLabel,
        total,
        totalPagadoAnterior,
        montoCobrado,
        saldoPendiente: saldo,
        pedidoId,
        compromisoPagoId: compromisoId,
      });
    }

    const clienteId = String(req.body.clienteId ?? '').trim();
    const rawItems = req.body.items;
    const isDraft = req.body.draft === true;
    const draftVentaId = String(req.body.ventaId ?? req.body.id ?? '').trim();

    if (!clienteId) {
      return res.status(400).json({ error: 'Seleccioná un cliente para la venta.' });
    }

    const built = await buildMostradorItemsFromBody(businessId, rawItems);
    let items = built.items;
    let total = built.total;
    if (built.error) {
      if (!isDraft) {
        return res.status(400).json({ error: built.error });
      }
      items = [];
      total = 0;
    }

    const economics = buildSaleEconomics(items, total);

    const montoCobrado =
      Number.isFinite(montoCobradoInput) && montoCobradoInput >= 0 ? montoCobradoInput : total;

    if (!isDraft && montoCobrado > total) {
      return res.status(400).json({
        error: `El monto cobrado no puede superar el total de la venta ($${total}).`,
      });
    }

    if (isDraft) {
      const draftFields = buildMostradorDraftFields({
        clienteId,
        items,
        total,
        economics,
        montoCobrado: Math.min(montoCobrado, total),
        medioPago,
        notas,
        timestamp,
        businessId,
      });

      if (draftVentaId) {
        const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(draftVentaId);
        const ventaSnap = await ventaRef.get();
        if (!ventaSnap.exists || !isDraftSaleEstado(ventaSnap.data()?.estado)) {
          return res.status(400).json({ error: 'Solo se pueden actualizar ventas en borrador.' });
        }
        await ventaRef.update(draftFields);
        await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
          module: 'sales',
          action: 'draft',
          entityType: 'venta',
          entityId: draftVentaId,
          entityLabel: 'Borrador',
          summary: 'Actualizó borrador de venta',
        });
        return res.status(200).json({ id: draftVentaId, ventaLabel: 'Borrador', draft: true });
      }

      const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
        ...draftFields,
        createdAt: timestamp,
      });

      await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
        module: 'sales',
        action: 'draft',
        entityType: 'venta',
        entityId: ventaRef.id,
        entityLabel: 'Borrador',
        summary: 'Guardó borrador de venta',
      });

      return res.status(201).json({ id: ventaRef.id, ventaLabel: 'Borrador', draft: true });
    }

    const { numero: numeroVenta, label: ventaLabel } = await allocateSaleNumber(businessId);

    const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
      origen: 'mostrador',
      pedidoId: null,
      estado: 'confirmada',
      numeroVenta,
      ventaLabel,
      clienteId,
      items,
      total,
      costoReal: economics.costoReal,
      gananciaEstimada: economics.gananciaEstimada,
      totalPagadoAnterior: 0,
      montoCobrado,
      saldoPendiente: Math.max(0, total - montoCobrado),
      medioPago,
      notas,
      fecha: timestamp,
      negocioId: businessId,
    });

    for (const line of items) {
      const stockError = await applyStockForVenta(
        businessId,
        ventaRef.id,
        ventaLabel,
        [line]
      );
      if (stockError) {
        await reverseStockMovementsForDeletedVenta(
          businessId,
          ventaRef.id,
          ventaLabel,
          items
        );
        await ventaRef.delete();
        return res.status(400).json({ error: stockError });
      }
    }

    let movimientoCajaId: string | null = null;
    if (montoCobrado > 0) {
      movimientoCajaId = await createCashIncome(businessId, {
        monto: montoCobrado,
        concepto: `Venta mostrador #${ventaLabel}`,
        origenId: ventaRef.id,
        origenTipo: 'venta_mostrador',
        medio: medioPago,
        clienteId,
        ventaId: ventaRef.id,
        ventaLabel,
        pedidoId: null,
      });
      await ventaRef.update({ movimientoCajaId });
    }

    const saldoPendiente = Math.max(0, total - montoCobrado);
    const compromisoId = await maybeCreateCompromisoPago(businessId, {
      body: req.body,
      saldoPendiente,
      clienteId,
      origenTipo: 'venta',
      origenId: ventaRef.id,
      referenciaLabel: `Venta mostrador #${ventaLabel}`,
      ventaId: ventaRef.id,
    });

    if (compromisoId) {
      await ventaRef.update({ compromisoPagoId: compromisoId });
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'sales',
      action: 'create',
      entityType: 'venta',
      entityId: ventaRef.id,
      entityLabel: ventaLabel,
      summary: `Registró venta mostrador #${ventaLabel} · $${total}`,
    });

    return res.status(201).json({
      id: ventaRef.id,
      ventaLabel,
      total,
      montoCobrado,
      saldoPendiente,
      compromisoPagoId: compromisoId,
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ error: 'Error creating sale' });
  }
});

router.post('/:businessId/:ventaId/confirm', async (req, res) => {
  try {
    const { businessId, ventaId } = req.params;

    let result;
    try {
      result = await confirmMostradorSaleDraft(businessId, ventaId, req.body as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'SALE_NOT_FOUND') {
        return res.status(404).json({ error: 'Venta no encontrada.' });
      }
      if (message === 'NOT_DRAFT') {
        return res.status(400).json({ error: 'Solo se pueden confirmar ventas en borrador.' });
      }
      if (message === 'EMPTY_DRAFT') {
        return res.status(400).json({ error: 'Agregá al menos un producto antes de confirmar.' });
      }
      if (message === 'CLIENT_REQUIRED') {
        return res.status(400).json({ error: 'Seleccioná un cliente para la venta.' });
      }
      if (message === 'INVALID_AMOUNT') {
        return res.status(400).json({ error: 'El monto cobrado supera el total de la venta.' });
      }
      if (message.includes('Stock insuficiente') || message.includes('no existe')) {
        return res.status(400).json({ error: message });
      }
      throw err;
    }

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'sales',
      action: 'confirm',
      entityType: 'venta',
      entityId: result.id,
      entityLabel: result.ventaLabel,
      summary: `Confirmó venta mostrador #${result.ventaLabel} · $${result.total}`,
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error confirming sale:', error);
    res.status(500).json({ error: 'Error confirming sale' });
  }
});

router.post('/:businessId/:ventaId/cobros', async (req, res) => {
  try {
    const { businessId, ventaId } = req.params;
    const monto = Number(req.body.monto) || 0;
    const medioPago = String(req.body.medioPago ?? 'efectivo').trim() || 'efectivo';
    const notas = String(req.body.notas ?? '').trim();

    if (monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero.' });
    }

    const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
    const ventaSnap = await ventaRef.get();
    if (!ventaSnap.exists) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    const venta = ventaSnap.data() ?? {};
    if (venta.origen === 'pedido') {
      return res.status(400).json({
        error: 'Los cobros de ventas por pedido se registran desde el pedido asociado.',
        pedidoId: venta.pedidoId ?? null,
      });
    }

    const saldoPendiente = Math.max(0, Number(venta.saldoPendiente) || 0);
    if (monto > saldoPendiente) {
      return res.status(400).json({
        error: `El monto supera el saldo pendiente de la venta ($${saldoPendiente}).`,
        saldoPendiente,
      });
    }

    const ventaLabel = resolveSaleLabel(venta);
    const timestamp = new Date().toISOString();
    const movimientoCajaId = await createCashIncome(businessId, {
      monto,
      concepto: `Cobro saldo venta #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta_mostrador_cobro',
      medio: medioPago,
      clienteId: String(venta.clienteId ?? ''),
      ventaId,
      ventaLabel,
      pedidoId: null,
    });

    const montoCobrado = (Number(venta.montoCobrado) || 0) + monto;
    const nuevoSaldo = Math.max(0, (Number(venta.total) || 0) - montoCobrado);
    const cobrosExtra = Array.isArray(venta.cobros) ? [...venta.cobros] : [];
    cobrosExtra.push({
      id: `cobro_${Date.now()}`,
      monto,
      fecha: timestamp,
      medioPago,
      notas: notas || undefined,
      movimientoCajaId,
    });

    await ventaRef.update({
      montoCobrado,
      saldoPendiente: nuevoSaldo,
      cobros: cobrosExtra,
    });

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'sales',
      action: 'payment',
      entityType: 'venta',
      entityId: ventaId,
      entityLabel: ventaLabel,
      summary: `Registró cobro de $${monto} en venta #${ventaLabel}`,
    });

    return res.status(201).json({
      id: ventaId,
      ventaLabel,
      montoCobrado,
      saldoPendiente: nuevoSaldo,
      movimientoCajaId,
    });
  } catch (error) {
    console.error('Error registering sale payment:', error);
    res.status(500).json({ error: 'Error registering sale payment' });
  }
});

router.get('/:businessId/:ventaId', async (req, res) => {
  try {
    const { businessId, ventaId } = req.params;
    const snap = await db.collection(`negocios/${businessId}/ventas`).doc(ventaId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    const data = snap.data() ?? {};
    const sale = { id: snap.id, ...data, ventaLabel: resolveSaleLabel(data) };
    const [enriched] = await enrichSales(businessId, [sale]);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ error: 'Error fetching sale' });
  }
});

router.patch('/:businessId/:ventaId', async (req, res) => {
  try {
    const { businessId, ventaId } = req.params;
    const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
    const ventaSnap = await ventaRef.get();
    if (!ventaSnap.exists) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    const venta = ventaSnap.data() ?? {};
    if (venta.origen === 'pedido') {
      return res.status(400).json({
        error: 'Las ventas por pedido se editan desde el pedido asociado.',
        pedidoId: venta.pedidoId ?? null,
      });
    }

    if (isDraftSaleEstado(venta.estado)) {
      const clienteId = String(req.body.clienteId ?? venta.clienteId ?? '').trim();
      if (!clienteId) {
        return res.status(400).json({ error: 'Seleccioná un cliente para la venta.' });
      }

      const built = await buildMostradorItemsFromBody(businessId, req.body.items);
      let items = built.items;
      let total = built.total;
      if (built.error) {
        items = [];
        total = 0;
      }

      const economics = buildSaleEconomics(items, total);
      const montoCobradoInput = req.body.montoCobrado;
      const montoCobrado =
        Number.isFinite(Number(montoCobradoInput)) && Number(montoCobradoInput) >= 0
          ? Number(montoCobradoInput)
          : Number(venta.montoCobrado) || 0;

      await ventaRef.update(
        buildMostradorDraftFields({
          clienteId,
          items,
          total,
          economics,
          montoCobrado: Math.min(montoCobrado, total),
          medioPago: String(req.body.medioPago ?? venta.medioPago ?? 'efectivo').trim() || 'efectivo',
          notas: String(req.body.notas ?? venta.notas ?? '').trim(),
          timestamp: normalizeTransactionDateToIso(
            req.body.fecha,
            new Date(String(venta.fecha ?? Date.now()))
          ),
          businessId,
        })
      );

      return res.json({ id: ventaId, ventaLabel: 'Borrador', draft: true });
    }

    const clienteId = String(req.body.clienteId ?? venta.clienteId ?? '').trim();
    if (!clienteId) {
      return res.status(400).json({ error: 'Seleccioná un cliente para la venta.' });
    }

    const built = await buildMostradorItemsFromBody(businessId, req.body.items);
    if (built.error) {
      return res.status(400).json({ error: built.error });
    }

    const { items, total } = built;
    const economics = buildSaleEconomics(items, total);
    const ventaLabel = resolveSaleLabel(venta);
    const cobrosExtra = Array.isArray(venta.cobros) ? venta.cobros : [];
    const cobrosAdicionales = cobrosExtra.reduce(
      (acc: number, entry: Record<string, unknown>) => acc + (Number(entry.monto) || 0),
      0
    );
    const montoCobradoInput = req.body.montoCobrado;
    let montoCobrado = Number(venta.montoCobrado) || 0;

    if (montoCobradoInput !== undefined && montoCobradoInput !== null && cobrosExtra.length === 0) {
      montoCobrado =
        Number.isFinite(Number(montoCobradoInput)) && Number(montoCobradoInput) >= 0
          ? Number(montoCobradoInput)
          : montoCobrado;
    } else if (cobrosExtra.length > 0) {
      const montoInicial = Math.max(0, montoCobrado - cobrosAdicionales);
      montoCobrado = montoInicial + cobrosAdicionales;
    }

    if (montoCobrado > total) {
      return res.status(400).json({
        error: `El monto cobrado no puede superar el total de la venta ($${total}).`,
      });
    }

    const oldItems = (Array.isArray(venta.items) ? venta.items : []) as SaleLine[];
    const stockValidationError = await validateStockForEdit(businessId, oldItems, items);
    if (stockValidationError) {
      return res.status(400).json({ error: stockValidationError });
    }

    await restoreStockForVenta(businessId, ventaId, ventaLabel, oldItems);

    const stockError = await applyStockForVenta(businessId, ventaId, ventaLabel, items);
    if (stockError) {
      await restoreStockForVenta(businessId, ventaId, ventaLabel, items);
      await applyStockForVenta(businessId, ventaId, ventaLabel, oldItems);
      return res.status(400).json({ error: stockError });
    }

    const medioPago = String(req.body.medioPago ?? venta.medioPago ?? 'efectivo').trim() || 'efectivo';
    const notas = String(req.body.notas ?? venta.notas ?? '').trim();
    const saldoPendiente = Math.max(0, total - montoCobrado);
    let movimientoCajaId = venta.movimientoCajaId ? String(venta.movimientoCajaId) : null;

    if (cobrosExtra.length === 0) {
      const montoInicialAnterior = Number(venta.montoCobrado) || 0;
      const montoInicialNuevo = montoCobrado;

      if (movimientoCajaId && montoInicialNuevo <= 0) {
        await reverseCashMovement(businessId, movimientoCajaId, {
          origenId: ventaId,
          origenTipo: 'venta_anulacion',
          ventaId,
          ventaLabel,
          clienteId,
        });
        movimientoCajaId = null;
      } else if (movimientoCajaId && montoInicialNuevo !== montoInicialAnterior) {
        await reverseCashMovement(businessId, movimientoCajaId, {
          origenId: ventaId,
          origenTipo: 'venta_ajuste',
          ventaId,
          ventaLabel,
          clienteId,
        });
        movimientoCajaId = await createCashIncome(businessId, {
          monto: montoInicialNuevo,
          concepto: `Venta mostrador #${ventaLabel}`,
          origenId: ventaId,
          origenTipo: 'venta_mostrador',
          medio: medioPago,
          clienteId,
          ventaId,
          ventaLabel,
          pedidoId: null,
        });
      } else if (!movimientoCajaId && montoInicialNuevo > 0) {
        movimientoCajaId = await createCashIncome(businessId, {
          monto: montoInicialNuevo,
          concepto: `Venta mostrador #${ventaLabel}`,
          origenId: ventaId,
          origenTipo: 'venta_mostrador',
          medio: medioPago,
          clienteId,
          ventaId,
          ventaLabel,
          pedidoId: null,
        });
      }
    }

    await ventaRef.update({
      clienteId,
      items,
      total,
      costoReal: economics.costoReal,
      gananciaEstimada: economics.gananciaEstimada,
      montoCobrado,
      saldoPendiente,
      medioPago,
      notas,
      fecha: normalizeTransactionDateToIso(
        req.body.fecha,
        new Date(String(venta.fecha ?? Date.now()))
      ),
      movimientoCajaId: movimientoCajaId ?? null,
      updatedAt: new Date().toISOString(),
    });

    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'sales',
      action: 'update',
      entityType: 'venta',
      entityId: ventaId,
      entityLabel: ventaLabel,
      summary: `Editó venta mostrador #${ventaLabel}`,
    });

    res.json({
      id: ventaId,
      ventaLabel,
      total,
      montoCobrado,
      saldoPendiente,
    });
  } catch (error) {
    console.error('Error updating sale:', error);
    res.status(500).json({ error: 'Error updating sale' });
  }
});

async function detachOrderFromDeletedVenta(
  businessId: string,
  ventaId: string,
  venta: Record<string, unknown>,
  ventaLabel: string,
  cashMovementIds: Set<string>
): Promise<void> {
  const pedidoId = String(venta.pedidoId ?? '').trim();
  if (!pedidoId) return;

  const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(pedidoId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return;

  const order = orderSnap.data() as OrderRecord;
  if (String(order.ventaId ?? '') !== ventaId) return;

  const pagos = normalizePagos(order).filter((pago) => {
    if (pago.movimientoCajaId && cashMovementIds.has(String(pago.movimientoCajaId))) {
      return false;
    }
    if (String(pago.id).startsWith('pago_venta_')) return false;
    const notas = String(pago.notas ?? '');
    if (notas.includes(`venta #${ventaLabel}`) || notas.includes(`Venta #${ventaLabel}`)) {
      return false;
    }
    return true;
  });

  const total = Number(order.total) || 0;
  const totalPagado = pagos.reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
  const saldo = Math.max(0, total - totalPagado);

  await orderRef.update({
    ventaId: null,
    estado: 'listo',
    entregadoAt: null,
    pagos: pagos.map(sanitizePagoForFirestore),
    totalPagado,
    saldo,
  });
}

router.delete('/:businessId/:ventaId', async (req, res) => {
  try {
    const { businessId, ventaId } = req.params;
    const authReq = req as AuthenticatedRequest;
    const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
    const ventaSnap = await ventaRef.get();
    if (!ventaSnap.exists) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    const venta = ventaSnap.data() ?? {};
    if (venta.origen === 'pedido' && !isPrivilegedRole(authReq.auth?.user?.rol)) {
      return res.status(400).json({
        error: 'Las ventas por pedido solo las puede eliminar un administrador.',
        pedidoId: venta.pedidoId ?? null,
      });
    }

    const ventaLabel = resolveSaleLabel(venta);
    const items = (Array.isArray(venta.items) ? venta.items : []) as SaleLine[];
    await reverseStockMovementsForDeletedVenta(businessId, ventaId, ventaLabel, items);

    const movimientoIds = await collectCashMovementIdsForDeletedVenta(
      businessId,
      ventaId,
      venta
    );

    for (const movimientoId of movimientoIds) {
      await reverseCashMovement(businessId, movimientoId, {
        origenId: ventaId,
        origenTipo: 'venta_eliminada',
        ventaId,
        ventaLabel,
        clienteId: String(venta.clienteId ?? ''),
      });
    }

    const compromisoPagoId = String(venta.compromisoPagoId ?? '').trim();
    if (compromisoPagoId) {
      await db.collection(`negocios/${businessId}/compromisos_pago`).doc(compromisoPagoId).delete();
    }

    if (venta.origen === 'pedido') {
      await detachOrderFromDeletedVenta(businessId, ventaId, venta, ventaLabel, movimientoIds);
    }

    await ventaRef.delete();
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'sales',
      action: 'delete',
      entityType: 'venta',
      entityId: ventaId,
      entityLabel: ventaLabel,
      summary: `Eliminó venta mostrador #${ventaLabel}`,
    });
    res.json({ id: ventaId });
  } catch (error) {
    console.error('Error deleting sale:', error);
    res.status(500).json({ error: 'Error deleting sale' });
  }
});

export default router;
