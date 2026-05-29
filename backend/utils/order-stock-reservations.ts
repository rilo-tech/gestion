import { db } from '../firebase.ts';
import {
  getOrderEstadoLabel,
  normalizeOrderEstadoValue,
  orderEstadoRequiresFullStock,
  resolveOrderPhysicalStockScope,
  type OrderPedidosConfig,
  type OrderPhysicalStockScope,
} from './order-config.ts';
import { resolveOrderLabel } from './order-number.ts';
import { formatOrderStockMotivo } from './stock-movimientos.ts';
import { loadCategoriasSinStock, productControlsStock, productPermitsNegativeStock } from './stock-product.ts';
import { scheduleStockMetricsRefresh } from './stock-metrics.ts';

export type OrderStockItemStatus = 'sin_preparar' | 'completo' | 'parcial' | 'faltante';
export type OrderStockStatus = 'sin_preparar' | 'completo' | 'parcial' | 'faltante';

export type OrderLineStock = {
  stockItemId?: string;
  nombre?: string;
  cantidad?: number;
  cantidadReservada?: number;
  cantidadUsada?: number;
  cantidadFaltante?: number;
  /** Unidades pendientes de compra (persiste al descontar depósito en producción). */
  cantidadFaltanteCompra?: number;
  estadoStockItem?: OrderStockItemStatus;
  controlaStock?: boolean;
};

function lineControlsStock(line: OrderLineStock): boolean {
  return line.controlaStock !== false;
}

export type OrderStockRecord = {
  items?: OrderLineStock[];
  estadoStock?: OrderStockStatus;
  stockPreparado?: boolean;
  stockDescontado?: boolean;
  stockRestaurado?: boolean;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  clienteId?: string;
};

export class OrderStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderStockError';
  }
}
export type ConsumeOrderStockResult = {
  items: OrderLineStock[];
  stockDescontado: boolean;
  estadoStock: OrderStockStatus;
  stockPreparado?: boolean;
  stockWarning?: string;
};

export type ConsumeOrderReservedLine = {
  lineIndex: number;
  cantidad: number;
};

export type ConsumeOrderReservedManualResult = ConsumeOrderStockResult & {
  consumedLines: Array<{ lineIndex: number; nombre: string; cantidad: number }>;
  totalConsumed: number;
};

async function adjustGlobalStockReservation(params: {
  businessId: string;
  stockItemId: string;
  delta: number;
  productName: string;
  categoriasSinStock?: string[];
  allowNegativeReservation?: boolean;
}): Promise<void> {
  const delta = Number(params.delta) || 0;
  if (delta === 0) return;

  const itemRef = db.collection(`negocios/${params.businessId}/stock`).doc(params.stockItemId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists) {
      throw new OrderStockError(`Producto de stock no encontrado para "${params.productName}".`);
    }

    const data = snap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) return;

    const stockReservado = Number(data.stockReservado) || 0;

    if (delta > 0) {
      const stockReal = Number(data.stockActual) || 0;
      const disponible = getStockDisponible(stockReal, stockReservado);
      if (!params.allowNegativeReservation && !productPermitsNegativeStock(data) && delta > disponible) {
        const nombre = String(params.productName ?? data.nombre ?? 'Producto');
        throw new OrderStockError(
          `Stock insuficiente para "${nombre}": libre ${disponible} u., querés reservar ${delta} u. más.`
        );
      }
    }

    tx.update(itemRef, { stockReservado: Math.max(0, stockReservado + delta) });
  });
}

export function getStockDisponible(stockActual: number, stockReservado: number): number {
  return Math.max(0, (Number(stockActual) || 0) - (Number(stockReservado) || 0));
}

export function computeLineStockFields(line: OrderLineStock): OrderLineStock {
  const cantidadPedida = Number(line.cantidad) || 0;
  const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);

  if (!lineControlsStock(line)) {
    const cantidadFaltanteCompra = Math.max(0, Number(line.cantidadFaltanteCompra) || 0);
    return {
      ...line,
      cantidadReservada: 0,
      cantidadUsada,
      cantidadFaltante: cantidadFaltanteCompra,
      estadoStockItem: cantidadFaltanteCompra > 0 ? 'faltante' : 'completo',
    };
  }

  const cantidadReservadaRaw = Math.max(0, Number(line.cantidadReservada) || 0);
  const pendientePedido = Math.max(0, cantidadPedida - cantidadUsada);
  const reserved = Math.min(cantidadReservadaRaw, pendientePedido);
  const pendienteSinReservar = Math.max(0, pendientePedido - reserved);

  let cantidadFaltanteCompra: number | undefined;
  if (line.cantidadFaltanteCompra !== undefined && line.cantidadFaltanteCompra !== null) {
    cantidadFaltanteCompra = Math.max(0, Number(line.cantidadFaltanteCompra) || 0);
    if (pendienteSinReservar <= 0) {
      cantidadFaltanteCompra = 0;
    }
  }

  let cantidadFaltante = pendienteSinReservar;
  if (cantidadFaltanteCompra !== undefined) {
    cantidadFaltante = Math.min(pendienteSinReservar, cantidadFaltanteCompra);
  }

  const cubierto = cantidadUsada + reserved;

  let estadoStockItem: OrderStockItemStatus = 'sin_preparar';
  if (cantidadPedida <= 0 || (cubierto >= cantidadPedida && cantidadFaltante <= 0)) {
    estadoStockItem = 'completo';
  } else if (cantidadFaltante > 0 && reserved > 0) {
    estadoStockItem = 'parcial';
  } else if (cantidadFaltante > 0) {
    estadoStockItem = 'faltante';
  } else {
    estadoStockItem = 'parcial';
  }

  return {
    ...line,
    cantidadReservada: reserved,
    cantidadUsada,
    cantidadFaltante,
    ...(cantidadFaltanteCompra !== undefined ? { cantidadFaltanteCompra } : {}),
    estadoStockItem,
  };
}

export function computeOrderStockStatus(items: OrderLineStock[] = []): OrderStockStatus {
  const stockLines = items.filter((line) => {
    if (!line.stockItemId || (Number(line.cantidad) || 0) <= 0) return false;
    if (lineControlsStock(line)) return true;
    const computed = computeLineStockFields(line);
    return (Number(computed.cantidadFaltante) || 0) > 0;
  });
  if (stockLines.length === 0) return 'completo';

  const computed = stockLines.map((line) => computeLineStockFields(line));
  if (computed.every((line) => line.estadoStockItem === 'sin_preparar')) return 'sin_preparar';
  if (computed.every((line) => line.estadoStockItem === 'completo')) return 'completo';
  if (computed.every((line) => line.estadoStockItem === 'faltante')) return 'faltante';
  return 'parcial';
}

export function normalizeOrderItemsStock(items: OrderLineStock[] = []): OrderLineStock[] {
  return items.map((line) => computeLineStockFields(line));
}

export function orderHasPendingPhysicalStock(items: OrderLineStock[] = []): boolean {
  return normalizeOrderItemsStock(items).some((line) => {
    if (!lineControlsStock(line)) return false;
    const stockItemId = String(line.stockItemId ?? '').trim();
    if (!stockItemId) return false;
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    return cantidadUsada < cantidadPedida;
  });
}

export function orderStockFullyConsumed(items: OrderLineStock[] = []): boolean {
  return !orderHasPendingPhysicalStock(items);
}

function resolveLinePhysicalToConsume(
  line: OrderLineStock,
  scope: OrderPhysicalStockScope
): number {
  const cantidadPedida = Number(line.cantidad) || 0;
  const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
  const pendiente = Math.max(0, cantidadPedida - cantidadUsada);
  if (pendiente <= 0) return 0;

  if (scope === 'pedido_completo') return pendiente;

  const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
  return Math.min(reserved, pendiente);
}

export function mergeOrderItemsPreservingStock(
  incoming: OrderLineStock[] = [],
  existing: OrderLineStock[] = []
): OrderLineStock[] {
  return incoming.map((line, index) => {
    const stockItemId = String(line.stockItemId ?? '').trim();
    const prevByIndex = existing[index];
    const prev =
      prevByIndex && String(prevByIndex.stockItemId ?? '').trim() === stockItemId
        ? prevByIndex
        : existing.find((entry) => String(entry.stockItemId ?? '').trim() === stockItemId);

    const merged: OrderLineStock = { ...line };
    if (prev) {
      if (line.cantidadReservada === undefined) {
        merged.cantidadReservada = prev.cantidadReservada;
      }
      if (line.cantidadUsada === undefined) {
        merged.cantidadUsada = prev.cantidadUsada;
      }
      if (line.cantidadFaltanteCompra === undefined && prev.cantidadFaltanteCompra !== undefined) {
        merged.cantidadFaltanteCompra = prev.cantidadFaltanteCompra;
      } else if (
        line.cantidadFaltanteCompra === undefined &&
        prev.cantidadFaltanteCompra === undefined &&
        (Number(prev.cantidadFaltante) || 0) > 0
      ) {
        merged.cantidadFaltanteCompra = prev.cantidadFaltante;
      }
    }
    return computeLineStockFields(merged);
  });
}

const RESERVATION_MOVEMENT_ORIGINS = new Set([
  'pedido_reserva',
  'pedido_reserva_auto_entrada',
  'pedido_liberacion_reserva',
  'pedido_transferencia_reserva',
]);

export type StockReservationReconcileSummary = {
  ordersUpdated: number;
  movementsDeleted: number;
  products: Array<{
    stockItemId: string;
    nombre: string;
    stockReservado: number;
    allocatedOnOrders: number;
  }>;
};

export async function reconcileOrderStockFromProductReservations(
  businessId: string
): Promise<StockReservationReconcileSummary> {
  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  const targets = new Map<string, { nombre: string; stockReservado: number }>();

  for (const doc of stockSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const stockReservado = Math.max(0, Number(data.stockReservado) || 0);
    targets.set(doc.id, {
      nombre: String(data.nombre ?? 'Producto'),
      stockReservado,
    });
  }

  const remaining = new Map<string, number>(
    [...targets.entries()].map(([id, entry]) => [id, entry.stockReservado])
  );

  type OrderEntry = {
    id: string;
    ref: ReturnType<ReturnType<typeof db.collection>['doc']>;
    data: OrderStockRecord & { estado?: string; createdAt?: string };
    items: OrderLineStock[];
  };

  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  const orders: OrderEntry[] = [];

  for (const doc of ordersSnap.docs) {
    const data = doc.data() as OrderStockRecord & { estado?: string; createdAt?: string };
    const estado = String(data.estado ?? '').toLowerCase();
    if (estado === 'cancelado' || estado === 'borrador') continue;

    orders.push({
      id: doc.id,
      ref: doc.ref,
      data,
      items: (data.items ?? []).map((line) => ({ ...line })),
    });
  }

  orders.sort((a, b) => {
    const prepA = a.data.stockPreparado ? 1 : 0;
    const prepB = b.data.stockPreparado ? 1 : 0;
    if (prepB !== prepA) return prepB - prepA;
    return String(a.data.createdAt ?? '').localeCompare(String(b.data.createdAt ?? ''));
  });

  for (const order of orders) {
    order.items = order.items.map((line) =>
      computeLineStockFields({ ...line, cantidadReservada: 0 })
    );
  }

  for (const order of orders) {
    order.items = order.items.map((line) => {
      const stockItemId = String(line.stockItemId ?? '').trim();
      if (!stockItemId) return computeLineStockFields(line);

      const left = remaining.get(stockItemId) ?? 0;
      if (left <= 0) return computeLineStockFields(line);

      const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
      const pendiente = Math.max(0, (Number(line.cantidad) || 0) - cantidadUsada);
      if (pendiente <= 0) return computeLineStockFields(line);

      const reserve = Math.min(pendiente, left);
      remaining.set(stockItemId, left - reserve);
      return computeLineStockFields({ ...line, cantidadReservada: reserve });
    });
  }

  let ordersUpdated = 0;
  for (const order of orders) {
    const estadoStock = computeOrderStockStatus(order.items);
    const stockPreparado = order.items.some((line) => {
      const computed = computeLineStockFields(line);
      return (
        (Number(computed.cantidadReservada) || 0) > 0 ||
        (Number(computed.cantidadFaltante) || 0) > 0
      );
    });

    await order.ref.update({
      items: order.items,
      estadoStock,
      stockPreparado,
      updatedAt: new Date().toISOString(),
    });
    ordersUpdated += 1;
  }

  const movSnap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();
  let movementsDeleted = 0;
  for (const doc of movSnap.docs) {
    const origenTipo = String(doc.data().origenTipo ?? '');
    if (!RESERVATION_MOVEMENT_ORIGINS.has(origenTipo)) continue;
    await doc.ref.delete();
    movementsDeleted += 1;
  }

  const allocated = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.items) {
      const stockItemId = String(line.stockItemId ?? '').trim();
      if (!stockItemId) continue;
      const active = Math.max(
        0,
        (Number(line.cantidadReservada) || 0) - (Number(line.cantidadUsada) || 0)
      );
      if (active <= 0) continue;
      allocated.set(stockItemId, (allocated.get(stockItemId) ?? 0) + active);
    }
  }

  const products = [...targets.entries()]
    .filter(([, entry]) => entry.stockReservado > 0)
    .map(([stockItemId, entry]) => ({
      stockItemId,
      nombre: entry.nombre,
      stockReservado: entry.stockReservado,
      allocatedOnOrders: allocated.get(stockItemId) ?? 0,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { ordersUpdated, movementsDeleted, products };
}

export async function detectStockReservationMismatch(businessId: string): Promise<boolean> {
  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  const targets = new Map<string, number>();

  for (const doc of stockSnap.docs) {
    targets.set(doc.id, Math.max(0, Number(doc.data().stockReservado) || 0));
  }

  const allocated = new Map<string, number>();
  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();

  for (const doc of ordersSnap.docs) {
    const estado = String(doc.data().estado ?? '').toLowerCase();
    if (estado === 'cancelado' || estado === 'borrador') continue;

    const items = normalizeOrderItemsStock(doc.data().items ?? []);
    for (const line of items) {
      const stockItemId = String(line.stockItemId ?? '').trim();
      if (!stockItemId) continue;
      const active = Math.max(
        0,
        (Number(line.cantidadReservada) || 0) - (Number(line.cantidadUsada) || 0)
      );
      if (active <= 0) continue;
      allocated.set(stockItemId, (allocated.get(stockItemId) ?? 0) + active);
    }
  }

  const ids = new Set([...targets.keys(), ...allocated.keys()]);
  for (const stockItemId of ids) {
    if ((targets.get(stockItemId) ?? 0) !== (allocated.get(stockItemId) ?? 0)) {
      return true;
    }
  }

  return false;
}

export async function ensureStockReservationsSynced(
  businessId: string
): Promise<StockReservationReconcileSummary | null> {
  if (!(await detectStockReservationMismatch(businessId))) return null;
  return reconcileOrderStockFromProductReservations(businessId);
}

export type AutoReserveIncomingStockResult = {
  stockItemId: string;
  reservedTotal: number;
  updatedOrders: number;
};

/**
 * Autoasocia entradas de stock con pedidos pendientes, reservando primero los más antiguos.
 */
export async function autoReserveIncomingStockForProduct(
  businessId: string,
  stockItemId: string
): Promise<AutoReserveIncomingStockResult> {
  const normalizedStockItemId = String(stockItemId ?? '').trim();
  if (!normalizedStockItemId) {
    return { stockItemId: '', reservedTotal: 0, updatedOrders: 0 };
  }

  const stockRef = db.collection(`negocios/${businessId}/stock`).doc(normalizedStockItemId);
  const stockSnap = await stockRef.get();
  if (!stockSnap.exists) {
    return { stockItemId: normalizedStockItemId, reservedTotal: 0, updatedOrders: 0 };
  }

  const stockData = (stockSnap.data() ?? {}) as Record<string, unknown>;
  if (!productControlsStock(stockData)) {
    return { stockItemId: normalizedStockItemId, reservedTotal: 0, updatedOrders: 0 };
  }

  let available = getStockDisponible(
    Number(stockData.stockActual) || 0,
    Number(stockData.stockReservado) || 0
  );
  if (available <= 0) {
    return { stockItemId: normalizedStockItemId, reservedTotal: 0, updatedOrders: 0 };
  }

  type Candidate = {
    id: string;
    ref: ReturnType<ReturnType<typeof db.collection>['doc']>;
    data: OrderStockRecord & { estado?: string; createdAt?: string };
    items: OrderLineStock[];
  };

  const ordersSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
  const candidates: Candidate[] = [];

  for (const doc of ordersSnap.docs) {
    const data = doc.data() as OrderStockRecord & { estado?: string; createdAt?: string };
    const estado = String(data.estado ?? '').toLowerCase();
    if (
      estado === 'cancelado' ||
      estado === 'borrador' ||
      estado === 'entregado' ||
      estado === 'entregado_total'
    ) {
      continue;
    }
    candidates.push({
      id: doc.id,
      ref: doc.ref,
      data,
      items: normalizeOrderItemsStock(data.items ?? []).map((line) => ({ ...line })),
    });
  }

  candidates.sort((a, b) => String(a.data.createdAt ?? '').localeCompare(String(b.data.createdAt ?? '')));

  let reservedTotal = 0;
  let updatedOrders = 0;

  for (const order of candidates) {
    if (available <= 0) break;

    const orderLabel = resolveOrderLabel(order.data);
    const clientName = await resolveClientName(businessId, order.data.clienteId);
    let orderChanged = false;

    for (let lineIndex = 0; lineIndex < order.items.length; lineIndex++) {
      if (available <= 0) break;

      const line = order.items[lineIndex];
      const lineStockItemId = String(line.stockItemId ?? '').trim();
      if (lineStockItemId !== normalizedStockItemId) continue;
      if (line.controlaStock === false) continue;

      const cantidadPedida = Number(line.cantidad) || 0;
      const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
      const cantidadReservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const pendiente = Math.max(0, cantidadPedida - cantidadUsada - cantidadReservada);
      if (pendiente <= 0) continue;

      const reserve = Math.min(pendiente, available);
      if (reserve <= 0) continue;

      line.cantidadReservada = cantidadReservada + reserve;
      const gapBefore = Math.max(
        0,
        Number(line.cantidadFaltanteCompra ?? computeLineStockFields(line).cantidadFaltante) || 0
      );
      if (gapBefore > 0) {
        line.cantidadFaltanteCompra = Math.max(0, gapBefore - reserve);
      }
      order.items[lineIndex] = computeLineStockFields(line);

      await writeStockMovement({
        businessId,
        productoId: normalizedStockItemId,
        cantidad: reserve,
        motivo: formatOrderStockMotivo(orderLabel, 'Reserva automática por entrada'),
        origenId: order.id,
        origenTipo: 'pedido_reserva_auto_entrada',
        pedidoId: order.id,
        numeroPedidoLabel: order.data.numeroPedidoLabel ?? orderLabel,
        clienteId: order.data.clienteId ?? null,
        clienteNombre: clientName || null,
      });

      available -= reserve;
      reservedTotal += reserve;
      orderChanged = true;
    }

    if (orderChanged) {
      await order.ref.update({
        items: order.items,
        estadoStock: computeOrderStockStatus(order.items),
        stockPreparado: true,
        updatedAt: new Date().toISOString(),
      });
      updatedOrders += 1;
    }
  }

  if (reservedTotal > 0) {
    await adjustGlobalStockReservation({
      businessId,
      stockItemId: normalizedStockItemId,
      delta: reservedTotal,
      productName: String(stockData.nombre ?? 'Producto'),
      categoriasSinStock: await loadCategoriasSinStock(businessId),
    });
  }

  return { stockItemId: normalizedStockItemId, reservedTotal, updatedOrders };
}

export type StockPreparationLine = {
  lineIndex: number;
  stockItemId: string;
  nombre: string;
  cantidadPedida: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadFaltante: number;
  stockReal: number;
  stockReservadoGlobal: number;
  stockDisponible: number;
  sugeridoReservar: number;
  controlaStock: boolean;
  permitirStockNegativo: boolean;
};

export async function buildStockPreparationView(
  businessId: string,
  order: OrderStockRecord
): Promise<StockPreparationLine[]> {
  const lines: StockPreparationLine[] = [];
  const categoriasSinStock = await loadCategoriasSinStock(businessId);

  for (let lineIndex = 0; lineIndex < (order.items ?? []).length; lineIndex++) {
    const rawLine = order.items![lineIndex];
    const line = computeLineStockFields(rawLine);
    const stockItemId = String(rawLine.stockItemId ?? '').trim();
    const cantidadPedida = Number(rawLine.cantidad) || 0;
    if (!stockItemId || cantidadPedida <= 0) continue;

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    const data = (itemSnap.data() ?? {}) as Record<string, unknown>;
    const stockReal = Number(data.stockActual) || 0;
    const stockReservadoGlobal = Number(data.stockReservado) || 0;
    const stockDisponible = getStockDisponible(stockReal, stockReservadoGlobal);
    const pendiente = Math.max(0, cantidadPedida - (Number(line.cantidadUsada) || 0));
    const sugeridoReservar = Math.min(pendiente, stockDisponible + (Number(line.cantidadReservada) || 0));

    lines.push({
      lineIndex,
      stockItemId,
      nombre: String(rawLine.nombre ?? data.nombre ?? 'Producto'),
      cantidadPedida,
      cantidadReservada: Number(line.cantidadReservada) || 0,
      cantidadUsada: Number(line.cantidadUsada) || 0,
      cantidadFaltante: Number(line.cantidadFaltante) || 0,
      stockReal,
      stockReservadoGlobal,
      stockDisponible,
      sugeridoReservar,
      controlaStock: productControlsStock(data),
      permitirStockNegativo: productPermitsNegativeStock(data),
    });
  }

  return lines;
}

async function writeStockMovement(params: {
  businessId: string;
  productoId: string;
  cantidad: number;
  motivo: string;
  origenId: string;
  origenTipo: string;
  pedidoId?: string;
  numeroPedidoLabel?: string | null;
  pedidoDestinoId?: string;
  pedidoDestinoLabel?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
}) {
  await db.collection(`negocios/${params.businessId}/movimientos_stock`).add({
    productoId: params.productoId,
    tipo: 'salida',
    cantidad: params.cantidad,
    fecha: new Date().toISOString(),
    motivo: params.motivo,
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: 'pedido',
    pedidoId: params.pedidoId ?? params.origenId,
    pedidoDestinoId: params.pedidoDestinoId ?? null,
    numeroPedidoLabel: params.numeroPedidoLabel ?? null,
    pedidoDestinoLabel: params.pedidoDestinoLabel ?? null,
    clienteId: params.clienteId ?? null,
    clienteNombre: params.clienteNombre ?? null,
    afectaStockReal: false,
    negocioId: params.businessId,
  });
}

async function resolveClientName(businessId: string, clienteId?: string | null): Promise<string> {
  const id = String(clienteId ?? '').trim();
  if (!id) return '';
  const snap = await db.collection(`negocios/${businessId}/clientes`).doc(id).get();
  return String(snap.data()?.nombre ?? '').trim();
}

export async function applyOrderStockPreparation(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  allocations: Array<{ lineIndex: number; cantidadReservar?: number; cantidadFaltante?: number }>
): Promise<{ items: OrderLineStock[]; estadoStock: OrderStockStatus; stockPreparado: boolean }> {
  const items = [...(order.items ?? [])].map((line) => ({ ...line }));
  const orderLabel = resolveOrderLabel(order);
  const clientName = await resolveClientName(businessId, order.clienteId);
  const categoriasSinStock = await loadCategoriasSinStock(businessId);
  const allocationMap = new Map<number, { reservar?: number; faltante?: number }>();

  for (const alloc of allocations) {
    const lineIndex = Number(alloc.lineIndex);
    if (Number.isNaN(lineIndex)) continue;
    allocationMap.set(lineIndex, {
      reservar:
        alloc.cantidadReservar !== undefined ? Math.max(0, Number(alloc.cantidadReservar) || 0) : undefined,
      faltante:
        alloc.cantidadFaltante !== undefined ? Math.max(0, Number(alloc.cantidadFaltante) || 0) : undefined,
    });
  }

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    if (!stockItemId || cantidadPedida <= 0) {
      items[lineIndex] = computeLineStockFields(line);
      continue;
    }

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    const productData = (itemSnap.data() ?? {}) as Record<string, unknown>;
    if (!productControlsStock(productData)) {
      items[lineIndex] = computeLineStockFields({ ...line, controlaStock: false });
      continue;
    }

    const qtyUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const maxReservable = Math.max(0, cantidadPedida - qtyUsada);
    const alloc = allocationMap.get(lineIndex);
    let requested = Number(line.cantidadReservada) || 0;

    if (alloc) {
      if (alloc.faltante !== undefined) {
        const faltante = Math.min(maxReservable, alloc.faltante);
        requested = Math.max(0, maxReservable - faltante);
        line.cantidadFaltanteCompra = faltante;
      } else if (alloc.reservar !== undefined) {
        requested = alloc.reservar;
      }
    }

    const newReserve = Math.min(maxReservable, Math.max(0, requested));
    const oldReserve = Math.max(0, Number(line.cantidadReservada) || 0);
    const delta = newReserve - oldReserve;

    if (delta !== 0) {
      await adjustGlobalStockReservation({
        businessId,
        stockItemId,
        delta,
        productName: String(line.nombre ?? 'Producto'),
        categoriasSinStock,
        allowNegativeReservation: true,
      });

      if (delta > 0) {
        await writeStockMovement({
          businessId,
          productoId: stockItemId,
          cantidad: delta,
          motivo: formatOrderStockMotivo(orderLabel, 'Reserva'),
          origenId: orderId,
          origenTipo: 'pedido_reserva',
          pedidoId: orderId,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
          clienteId: order.clienteId ?? null,
          clienteNombre: clientName || null,
        });
      } else {
        await db.collection(`negocios/${businessId}/movimientos_stock`).add({
          productoId: stockItemId,
          tipo: 'entrada',
          cantidad: Math.abs(delta),
          fecha: new Date().toISOString(),
          motivo: formatOrderStockMotivo(orderLabel, 'Liberación reserva'),
          origenId: orderId,
          origenTipo: 'pedido_liberacion_reserva',
          origenGrupo: 'pedido',
          pedidoId: orderId,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
          clienteId: order.clienteId ?? null,
          clienteNombre: clientName || null,
          afectaStockReal: false,
          negocioId: businessId,
        });
      }
    }

    line.cantidadReservada = newReserve;
    line.cantidadFaltanteCompra = Math.max(0, cantidadPedida - newReserve);
    items[lineIndex] = computeLineStockFields(line);
  }

  const estadoStock = computeOrderStockStatus(items);
  return {
    items,
    estadoStock,
    stockPreparado: true,
  };
}

export async function releaseOrderStockReservations(
  businessId: string,
  orderId: string,
  order: OrderStockRecord
): Promise<boolean> {
  const items = [...(order.items ?? [])];
  let released = false;
  const orderLabel = resolveOrderLabel(order);

  for (const line of items) {
    const stockItemId = String(line.stockItemId ?? '').trim();
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    if (!stockItemId || reserved <= 0) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const stockReservado = Number(itemSnap.data()?.stockReservado) || 0;
    await itemRef.update({ stockReservado: Math.max(0, stockReservado - reserved) });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: stockItemId,
      tipo: 'entrada',
      cantidad: reserved,
      fecha: new Date().toISOString(),
      motivo: formatOrderStockMotivo(orderLabel, 'Cancelado'),
      origenId: orderId,
      origenTipo: 'pedido_liberacion_reserva',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      afectaStockReal: false,
      negocioId: businessId,
    });

    line.cantidadReservada = 0;
    released = true;
  }

  if (released) {
    await db
      .collection(`negocios/${businessId}/pedidos`)
      .doc(orderId)
      .update({
        items: items.map((line) => computeLineStockFields(line)),
        estadoStock: computeOrderStockStatus(items),
        stockPreparado: false,
      });
    scheduleStockMetricsRefresh(businessId);
  }

  return released;
}

type ConsumeOrderStockOptions = {
  motivo: (orderLabel: string) => string;
  origenTipo: string;
  scope?: OrderPhysicalStockScope;
  buildInsufficientMessage: (nombre: string, stockActual: number, toConsume: number) => string;
};

function persistLinePurchaseGap(line: OrderLineStock): void {
  if (line.cantidadFaltanteCompra !== undefined && line.cantidadFaltanteCompra !== null) return;
  const computed = computeLineStockFields({ ...line, cantidadFaltanteCompra: undefined });
  const faltante = Math.max(0, Number(computed.cantidadFaltante) || 0);
  if (faltante > 0) {
    line.cantidadFaltanteCompra = faltante;
  }
}

async function consumeOrderStockInternal(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  options: ConsumeOrderStockOptions
): Promise<ConsumeOrderStockResult> {
  const scope = options.scope ?? 'pedido_completo';
  const normalizedItems = normalizeOrderItemsStock(order.items ?? []);

  if (order.stockDescontado && orderStockFullyConsumed(normalizedItems)) {
    return {
      items: normalizedItems,
      stockDescontado: true,
      estadoStock: computeOrderStockStatus(normalizedItems),
    };
  }

  const items = normalizedItems.map((line) => ({ ...line }));
  const orderLabel = resolveOrderLabel(order);
  const categoriasSinStock = await loadCategoriasSinStock(businessId);
  let consumedAny = false;

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const toConsume = resolveLinePhysicalToConsume(line, scope);

    if (!stockItemId || toConsume <= 0) {
      persistLinePurchaseGap(line);
      items[lineIndex] = computeLineStockFields(line);
      continue;
    }

    persistLinePurchaseGap(line);

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      throw new OrderStockError(`Producto de stock no encontrado para "${line.nombre ?? 'Producto'}".`);
    }

    const data = itemSnap.data() as Record<string, unknown>;
    const controlsStock = productControlsStock(data);
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    const releaseReserve = Math.min(reserved, toConsume);
    let stockActual = Number(data.stockActual) || 0;
    let stockReservado = Number(data.stockReservado) || 0;
    const allowNegative = productPermitsNegativeStock(data);

    if (controlsStock && !allowNegative && stockActual < toConsume) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      throw new OrderStockError(options.buildInsufficientMessage(nombre, stockActual, toConsume));
    }

    if (releaseReserve > 0) {
      stockReservado = Math.max(0, stockReservado - releaseReserve);
    }

    if (controlsStock) {
      stockActual = allowNegative ? stockActual - toConsume : Math.max(0, stockActual - toConsume);
      await itemRef.update({ stockActual, stockReservado });

      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: stockItemId,
        tipo: 'salida',
        cantidad: toConsume,
        fecha: new Date().toISOString(),
        motivo: options.motivo(orderLabel),
        origenId: orderId,
        origenTipo: options.origenTipo,
        origenGrupo: 'pedido',
        pedidoId: orderId,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        afectaStockReal: true,
        negocioId: businessId,
      });
    } else if (releaseReserve > 0) {
      await itemRef.update({ stockReservado });
    }

    line.cantidadUsada = cantidadUsada + toConsume;
    const cantidadPedida = Number(line.cantidad) || 0;
    const pendienteAfter = Math.max(0, cantidadPedida - line.cantidadUsada);
    line.cantidadReservada = Math.max(0, reserved - releaseReserve);
    items[lineIndex] = computeLineStockFields(line);
    consumedAny = true;
  }

  if (consumedAny) {
    scheduleStockMetricsRefresh(businessId);
  }

  return {
    items,
    stockDescontado: consumedAny || order.stockDescontado === true,
    estadoStock: computeOrderStockStatus(items),
  };
}

export async function consumeOrderReservedStockManual(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  lines: ConsumeOrderReservedLine[] = []
): Promise<ConsumeOrderReservedManualResult> {
  const normalizedItems = normalizeOrderItemsStock(order.items ?? []);
  const items = normalizedItems.map((line) => ({ ...line }));
  const orderLabel = resolveOrderLabel(order);
  const categoriasSinStock = await loadCategoriasSinStock(businessId);

  const requested = new Map<number, number>();
  for (const entry of lines) {
    const idx = Number(entry.lineIndex);
    if (Number.isNaN(idx)) continue;
    requested.set(idx, Math.max(0, Number(entry.cantidad) || 0));
  }

  let consumedAny = false;
  const consumedLines: Array<{ lineIndex: number; nombre: string; cantidad: number }> = [];
  let totalConsumed = 0;

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const pendiente = Math.max(0, cantidadPedida - cantidadUsada);
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    const maxConsumible = Math.min(reserved, pendiente);
    const want = requested.has(lineIndex) ? (requested.get(lineIndex) ?? 0) : maxConsumible;
    const toConsume = Math.min(maxConsumible, Math.max(0, want));

    if (!stockItemId || toConsume <= 0) {
      items[lineIndex] = computeLineStockFields(line);
      continue;
    }

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) {
      throw new OrderStockError(`Producto de stock no encontrado para "${line.nombre ?? 'Producto'}".`);
    }

    const data = itemSnap.data() as Record<string, unknown>;
    const controlsStock = productControlsStock(data);
    if (!controlsStock) {
      items[lineIndex] = computeLineStockFields({ ...line, controlaStock: false });
      continue;
    }

    const allowNegative = productPermitsNegativeStock(data);
    let stockActual = Number(data.stockActual) || 0;
    let stockReservado = Number(data.stockReservado) || 0;

    if (!allowNegative && stockActual < toConsume) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      throw new OrderStockError(
        `Stock insuficiente para «${nombre}»: hay ${stockActual} u. en depósito y querés descontar ${toConsume} u.`
      );
    }

    // consume: baja real y libera reserva global
    stockReservado = Math.max(0, stockReservado - toConsume);
    stockActual = allowNegative ? stockActual - toConsume : Math.max(0, stockActual - toConsume);
    await itemRef.update({ stockActual, stockReservado });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: stockItemId,
      tipo: 'salida',
      cantidad: toConsume,
      fecha: new Date().toISOString(),
      motivo: formatOrderStockMotivo(orderLabel, 'En producción (manual)'),
      origenId: orderId,
      origenTipo: 'pedido_produccion_manual',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      afectaStockReal: true,
      negocioId: businessId,
    });

    line.cantidadUsada = cantidadUsada + toConsume;
    line.cantidadReservada = Math.max(0, reserved - toConsume);
    items[lineIndex] = computeLineStockFields(line);

    consumedAny = true;
    totalConsumed += toConsume;
    consumedLines.push({
      lineIndex,
      nombre: String(line.nombre ?? data.nombre ?? 'Producto'),
      cantidad: toConsume,
    });
  }

  return {
    items,
    stockDescontado: consumedAny || order.stockDescontado === true,
    estadoStock: computeOrderStockStatus(items),
    consumedLines,
    totalConsumed,
    stockPreparado: true,
  };
}

export async function consumeOrderStockDirect(
  businessId: string,
  orderId: string,
  order: OrderStockRecord
): Promise<ConsumeOrderStockResult> {
  return consumeOrderStockInternal(businessId, orderId, order, {
    motivo: (orderLabel) => formatOrderStockMotivo(orderLabel, 'Descuento'),
    origenTipo: 'pedido_descuento',
    buildInsufficientMessage: (nombre, stockActual, toConsume) =>
      `Stock insuficiente para «${nombre}»: hay ${stockActual} u. en depósito y el pedido necesita ${toConsume} u.`,
  });
}

export async function consumeOrderStockOnReady(
  businessId: string,
  orderId: string,
  order: OrderStockRecord
): Promise<ConsumeOrderStockResult> {
  return consumeOrderStockInternal(businessId, orderId, order, {
    motivo: (orderLabel) => formatOrderStockMotivo(orderLabel, 'Listo'),
    origenTipo: 'pedido_listo',
    buildInsufficientMessage: (nombre, stockActual, toConsume) =>
      `Stock insuficiente para marcar listo «${nombre}»: hay ${stockActual} u. en depósito y el pedido necesita ${toConsume} u.`,
  });
}

async function ensureOrderStockReservedForProduction(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  items: OrderLineStock[]
): Promise<OrderLineStock[]> {
  const orderLabel = resolveOrderLabel(order);
  const clientName = await resolveClientName(businessId, order.clienteId);
  const categoriasSinStock = await loadCategoriasSinStock(businessId);

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    if (!stockItemId || cantidadPedida <= 0) {
      items[lineIndex] = computeLineStockFields(line);
      continue;
    }

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    if (!itemSnap.exists) {
      items[lineIndex] = computeLineStockFields(line);
      continue;
    }

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) {
      items[lineIndex] = computeLineStockFields({ ...line, controlaStock: false });
      continue;
    }

    const stockReal = Number(data.stockActual) || 0;
    const stockReservadoGlobal = Number(data.stockReservado) || 0;
    const stockDisponible = getStockDisponible(stockReal, stockReservadoGlobal);
    const qtyUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const pendiente = Math.max(0, cantidadPedida - qtyUsada);
    const oldReserve = Math.max(0, Number(line.cantidadReservada) || 0);
    const newReserve = Math.min(pendiente, oldReserve + stockDisponible);
    const delta = newReserve - oldReserve;

    if (delta !== 0) {
      await adjustGlobalStockReservation({
        businessId,
        stockItemId,
        delta,
        productName: String(line.nombre ?? data.nombre ?? 'Producto'),
        categoriasSinStock,
      });

      if (delta > 0) {
        await writeStockMovement({
          businessId,
          productoId: stockItemId,
          cantidad: delta,
          motivo: formatOrderStockMotivo(orderLabel, 'Reserva'),
          origenId: orderId,
          origenTipo: 'pedido_reserva',
          pedidoId: orderId,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
          clienteId: order.clienteId ?? null,
          clienteNombre: clientName || null,
        });
      } else {
        await db.collection(`negocios/${businessId}/movimientos_stock`).add({
          productoId: stockItemId,
          tipo: 'entrada',
          cantidad: Math.abs(delta),
          fecha: new Date().toISOString(),
          motivo: formatOrderStockMotivo(orderLabel, 'Liberación reserva'),
          origenId: orderId,
          origenTipo: 'pedido_liberacion_reserva',
          origenGrupo: 'pedido',
          pedidoId: orderId,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
          clienteId: order.clienteId ?? null,
          clienteNombre: clientName || null,
          afectaStockReal: false,
          negocioId: businessId,
        });
      }
    }

    line.cantidadReservada = newReserve;
    items[lineIndex] = computeLineStockFields(line);
  }

  return items;
}

export async function consumeOrderStockForProduction(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  scope: OrderPhysicalStockScope = 'pedido_completo'
): Promise<ConsumeOrderStockResult> {
  const normalizedItems = normalizeOrderItemsStock(order.items ?? []);

  if (order.stockDescontado && orderStockFullyConsumed(normalizedItems)) {
    return {
      items: normalizedItems,
      stockDescontado: true,
      estadoStock: computeOrderStockStatus(normalizedItems),
      stockPreparado: order.stockPreparado ?? true,
    };
  }

  let items = normalizedItems.map((line) => ({ ...line }));
  if (!order.stockPreparado && scope === 'pedido_completo') {
    items = await ensureOrderStockReservedForProduction(businessId, orderId, order, items);
  }

  const purchaseWarnings: string[] = [];
  const insufficientLines: string[] = [];
  const categoriasSinStock = await loadCategoriasSinStock(businessId);

  for (const line of items) {
    const stockItemId = String(line.stockItemId ?? '').trim();
    const toConsume = resolveLinePhysicalToConsume(line, scope);
    if (!stockItemId || toConsume <= 0) continue;

    if (scope === 'pedido_completo') {
      const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
      if (faltante > 0) {
        purchaseWarnings.push(`• ${line.nombre ?? 'Producto'}: faltan ${faltante} u. para comprar`);
      }
    }

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    if (!itemSnap.exists) {
      throw new OrderStockError(`Producto de stock no encontrado para "${line.nombre ?? 'Producto'}".`);
    }

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) continue;

    const stockActual = Number(data.stockActual) || 0;
    if (!productPermitsNegativeStock(data) && stockActual < toConsume) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      insufficientLines.push(
        `• ${nombre}: hay ${stockActual} u. en depósito y se intentarían descontar ${toConsume} u.`
      );
    }
  }

  if (insufficientLines.length > 0) {
    const intro =
      scope === 'solo_reservado'
        ? 'No hay stock suficiente en depósito para descontar lo reservado:'
        : 'No hay stock suficiente en depósito para descontar el pedido:';
    throw new OrderStockError(intro + '\n' + insufficientLines.join('\n'));
  }

  if (scope === 'solo_reservado') {
    const totalReserved = items.reduce(
      (sum, line) => sum + resolveLinePhysicalToConsume(line, scope),
      0
    );
    if (totalReserved <= 0) {
      throw new OrderStockError(
        'No hay unidades reservadas para descontar del depósito. Revisá la preparación de stock o elegí descontar todo el pedido.'
      );
    }
  }

  const consumption = await consumeOrderStockInternal(businessId, orderId, { ...order, items }, {
    motivo: (orderLabel) => formatOrderStockMotivo(orderLabel, 'En producción'),
    origenTipo: 'pedido_produccion',
    scope,
    buildInsufficientMessage: (nombre, stockActual, toConsume) =>
      `Stock insuficiente para producir «${nombre}»: hay ${stockActual} u. en depósito y el pedido necesita ${toConsume} u.`,
  });

  let stockWarning: string | undefined;
  const purchaseGapLines = consumption.items.filter(
    (line) => (Number(line.cantidadFaltante) || 0) > 0
  );
  if (purchaseGapLines.length > 0) {
    const warnings = purchaseGapLines.map(
      (line) => `• ${line.nombre ?? 'Producto'}: faltan ${line.cantidadFaltante} u. para comprar`
    );
    stockWarning =
      (scope === 'solo_reservado'
        ? 'El pedido pasó a producción y se descontó lo reservado del depósito, pero quedaron unidades para comprar:\n'
        : 'El pedido pasó a producción y se descontó el stock del depósito, pero quedaron unidades para comprar:\n') +
      warnings.join('\n');
  } else if (purchaseWarnings.length > 0) {
    stockWarning =
      'El pedido pasó a producción y se descontó el stock del depósito, pero quedaron unidades para comprar:\n' +
      purchaseWarnings.join('\n');
  }

  return {
    ...consumption,
    stockPreparado: true,
    stockWarning,
  };
}

export async function consumeOrderStockOnStatusChange(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  params: {
    pedidosConfig: OrderPedidosConfig;
    targetEstado?: string;
    scope?: OrderPhysicalStockScope;
  }
): Promise<ConsumeOrderStockResult> {
  const { pedidosConfig, targetEstado } = params;
  const scope =
    params.scope ?? resolveOrderPhysicalStockScope(pedidosConfig, targetEstado);

  if (pedidosConfig.modoStock === 'directo') {
    return consumeOrderStockDirect(businessId, orderId, order);
  }

  const target = normalizeOrderEstadoValue(targetEstado);
  const trigger = normalizeOrderEstadoValue(pedidosConfig.estadoDescuentaStock);

  if (orderEstadoRequiresFullStock(pedidosConfig, targetEstado) && scope === 'pedido_completo') {
    const validation = await validateOrderFullStockForDiscount(businessId, order, scope);
    if (!validation.ok) {
      throw new OrderStockError(validation.error ?? 'Stock incompleto para este estado.');
    }
  }

  if (target === 'listo' && trigger === 'listo') {
    return consumeOrderStockOnReady(businessId, orderId, order);
  }

  return consumeOrderStockForProduction(businessId, orderId, order, scope);
}

export type OrderStockDiscountPreviewLine = {
  nombre: string;
  stockItemId: string;
  cantidadPedida: number;
  cantidadReservada: number;
  pendiente: number;
  aDescontarReservado: number;
  aDescontarCompleto: number;
  stockDisponible: number;
  faltante: number;
  controlaStock: boolean;
};

export type OrderStockDiscountPreview = {
  willConsume: boolean;
  nextEstado: string;
  nextEstadoLabel: string;
  defaultScope: OrderPhysicalStockScope;
  canChooseScope: boolean;
  requiresFullStock: boolean;
  blocked: boolean;
  blockReason?: string;
  lines: OrderStockDiscountPreviewLine[];
  totalReservado: number;
  totalCompleto: number;
};

async function validateOrderFullStockForDiscount(
  businessId: string,
  order: OrderStockRecord,
  scope: OrderPhysicalStockScope
): Promise<{ ok: boolean; error?: string }> {
  const items = normalizeOrderItemsStock(order.items ?? []);
  const problems: string[] = [];

  for (const line of items) {
    const stockItemId = String(line.stockItemId ?? '').trim();
    const toConsume = resolveLinePhysicalToConsume(line, scope);
    if (!stockItemId || toConsume <= 0) continue;

    const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
    if (faltante > 0) {
      problems.push(`• ${line.nombre ?? 'Producto'}: faltan ${faltante} u. (revisá reserva/compra)`);
      continue;
    }

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    if (!itemSnap.exists) {
      problems.push(`• ${line.nombre ?? 'Producto'}: producto de stock no encontrado`);
      continue;
    }

    const data = itemSnap.data() as Record<string, unknown>;
    if (!productControlsStock(data)) continue;

    const stockActual = Number(data.stockActual) || 0;
    if (!productPermitsNegativeStock(data) && stockActual < toConsume) {
      problems.push(
        `• ${line.nombre ?? data.nombre ?? 'Producto'}: hay ${stockActual} u. en depósito y se necesitan ${toConsume} u.`
      );
    }
  }

  if (problems.length === 0) return { ok: true };
  return {
    ok: false,
    error:
      'Para pasar a este estado con descuento del pedido completo, todo el stock debe estar disponible:\n' +
      problems.join('\n'),
  };
}

export async function buildOrderStockDiscountPreview(
  businessId: string,
  order: OrderStockRecord,
  pedidosConfig: OrderPedidosConfig,
  nextEstado: string
): Promise<OrderStockDiscountPreview> {
  const nextEstadoLabel = getOrderEstadoLabel(nextEstado, pedidosConfig.estados);
  const defaultScope = resolveOrderPhysicalStockScope(pedidosConfig, nextEstado);
  const requiresFullStock =
    orderEstadoRequiresFullStock(pedidosConfig, nextEstado) && defaultScope === 'pedido_completo';
  const canChooseScope =
    pedidosConfig.modoStock !== 'directo' && pedidosConfig.permitirElegirAlcanceDescuento;

  const items = normalizeOrderItemsStock(order.items ?? []);
  const lines: OrderStockDiscountPreviewLine[] = [];
  let totalReservado = 0;
  let totalCompleto = 0;

  for (const line of items) {
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const pendiente = Math.max(0, cantidadPedida - cantidadUsada);
    const aDescontarReservado = resolveLinePhysicalToConsume(line, 'solo_reservado');
    const aDescontarCompleto = resolveLinePhysicalToConsume(line, 'pedido_completo');
    totalReservado += aDescontarReservado;
    totalCompleto += aDescontarCompleto;

    if (!stockItemId || pendiente <= 0) continue;
    if (!lineControlsStock(line)) continue;

    const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
    let stockDisponible = 0;
    if (itemSnap.exists) {
      const data = itemSnap.data() as Record<string, unknown>;
      stockDisponible = getStockDisponible(
        Number(data.stockActual) || 0,
        Number(data.stockReservado) || 0
      );
    }

    lines.push({
      nombre: String(line.nombre ?? 'Producto'),
      stockItemId,
      cantidadPedida,
      cantidadReservada: Math.max(0, Number(line.cantidadReservada) || 0),
      pendiente,
      aDescontarReservado,
      aDescontarCompleto,
      stockDisponible,
      faltante: Math.max(0, Number(line.cantidadFaltante) || 0),
      controlaStock: true,
    });
  }

  let blocked = false;
  let blockReason: string | undefined;

  if (requiresFullStock) {
    const validation = await validateOrderFullStockForDiscount(
      businessId,
      order,
      'pedido_completo'
    );
    if (!validation.ok) {
      blocked = true;
      blockReason = validation.error;
    }
  }

  const willConsume = totalReservado > 0 || totalCompleto > 0;

  return {
    willConsume,
    nextEstado: normalizeOrderEstadoValue(nextEstado),
    nextEstadoLabel,
    defaultScope,
    canChooseScope,
    requiresFullStock,
    blocked,
    blockReason,
    lines,
    totalReservado,
    totalCompleto,
  };
}

export async function transferReservedStockBetweenOrders(params: {
  businessId: string;
  sourceOrderId: string;
  sourceOrder: OrderStockRecord;
  targetOrderId: string;
  targetOrder: OrderStockRecord;
  stockItemId: string;
  cantidad: number;
  sourceLineIndex?: number;
  targetLineIndex?: number;
}): Promise<void> {
  const qty = Math.max(0, Number(params.cantidad) || 0);
  if (qty <= 0) throw new OrderStockError('La cantidad a transferir debe ser mayor a cero.');

  const sourceItems = [...(params.sourceOrder.items ?? [])].map((line) => ({ ...line }));
  const targetItems = [...(params.targetOrder.items ?? [])].map((line) => ({ ...line }));

  const sourceLineIdx =
    params.sourceLineIndex ??
    sourceItems.findIndex((line) => String(line.stockItemId ?? '') === params.stockItemId);
  const targetLineIdx =
    params.targetLineIndex ??
    targetItems.findIndex((line) => String(line.stockItemId ?? '') === params.stockItemId);

  if (sourceLineIdx < 0 || targetLineIdx < 0) {
    throw new OrderStockError('No se encontró el producto en ambos pedidos.');
  }

  const sourceLine = sourceItems[sourceLineIdx];
  const targetLine = targetItems[targetLineIdx];
  const sourceReserved = Math.max(0, Number(sourceLine.cantidadReservada) || 0);
  const sourceUsada = Math.max(0, Number(sourceLine.cantidadUsada) || 0);
  const movable = Math.max(0, sourceReserved - sourceUsada);

  if (qty > movable) {
    throw new OrderStockError(
      `Solo podés transferir stock reservado no usado. Disponible para mover: ${movable} u.`
    );
  }

  const targetPedida = Number(targetLine.cantidad) || 0;
  const targetUsada = Math.max(0, Number(targetLine.cantidadUsada) || 0);
  const targetReserved = Math.max(0, Number(targetLine.cantidadReservada) || 0);
  const targetRoom = Math.max(0, targetPedida - targetUsada - targetReserved);
  if (qty > targetRoom) {
    throw new OrderStockError(`El pedido destino solo admite ${targetRoom} u. más reservadas.`);
  }

  sourceLine.cantidadReservada = sourceReserved - qty;
  targetLine.cantidadReservada = targetReserved + qty;
  sourceItems[sourceLineIdx] = computeLineStockFields(sourceLine);
  targetItems[targetLineIdx] = computeLineStockFields(targetLine);

  const sourceLabel = resolveOrderLabel(params.sourceOrder);
  const targetLabel = resolveOrderLabel(params.targetOrder);

  await db.collection(`negocios/${params.businessId}/movimientos_stock`).add({
    productoId: params.stockItemId,
    tipo: 'salida',
    cantidad: qty,
    fecha: new Date().toISOString(),
    motivo: formatOrderStockMotivo(sourceLabel, 'Transferencia reserva'),
    origenId: params.sourceOrderId,
    origenTipo: 'pedido_transferencia_reserva',
    origenGrupo: 'pedido',
    pedidoId: params.sourceOrderId,
    pedidoDestinoId: params.targetOrderId,
    numeroPedidoLabel: params.sourceOrder.numeroPedidoLabel ?? sourceLabel,
    pedidoDestinoLabel: params.targetOrder.numeroPedidoLabel ?? targetLabel,
    afectaStockReal: false,
    negocioId: params.businessId,
  });

  await db.collection(`negocios/${params.businessId}/pedidos`).doc(params.sourceOrderId).update({
    items: sourceItems,
    estadoStock: computeOrderStockStatus(sourceItems),
    updatedAt: new Date().toISOString(),
  });

  await db.collection(`negocios/${params.businessId}/pedidos`).doc(params.targetOrderId).update({
    items: targetItems,
    estadoStock: computeOrderStockStatus(targetItems),
    stockPreparado: true,
    updatedAt: new Date().toISOString(),
  });
}

export type StockShortageRow = {
  orderId: string;
  orderLabel: string;
  orderEstado: string;
  lineIndex: number;
  stockItemId: string;
  productoNombre: string;
  cantidadPedida: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadFaltante: number;
  esEstimado?: boolean;
};

export type StockShortageGroup = {
  stockItemId: string;
  productoNombre: string;
  faltanteTotal: number;
  pedidos: Array<{ orderId: string; orderLabel: string }>;
  detalle: StockShortageRow[];
};

const ACTIVE_SHORTAGE_STATUSES = new Set(['pendiente', 'en_produccion', 'listo']);

async function loadStockLineContext(
  businessId: string,
  stockItemId: string,
  cache: Map<string, { disponible: number; controlaStock: boolean; nombre: string }>,
  categoriasSinStock: string[]
) {
  const cached = cache.get(stockItemId);
  if (cached) return cached;

  const itemSnap = await db.collection(`negocios/${businessId}/stock`).doc(stockItemId).get();
  const data = (itemSnap.data() ?? {}) as Record<string, unknown>;
  const entry = {
    disponible: getStockDisponible(Number(data.stockActual) || 0, Number(data.stockReservado) || 0),
    controlaStock: productControlsStock(data),
    nombre: String(data.nombre ?? 'Producto'),
  };
  cache.set(stockItemId, entry);
  return entry;
}

export async function listStockShortages(businessId: string): Promise<{
  grouped: StockShortageGroup[];
  rows: StockShortageRow[];
}> {
  const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
  const rows: StockShortageRow[] = [];
  const stockCache = new Map<string, { disponible: number; controlaStock: boolean; nombre: string }>();
  const categoriasSinStock = await loadCategoriasSinStock(businessId);

  for (const doc of snapshot.docs) {
    const order = doc.data() as OrderStockRecord & { estado?: string };
    const estado = String(order.estado ?? '').toLowerCase();
    if (!ACTIVE_SHORTAGE_STATUSES.has(estado) || estado === 'cancelado') continue;

    const orderLabel = resolveOrderLabel(order);
    const items = normalizeOrderItemsStock(order.items ?? []);
    const prepared = !!order.stockPreparado;

    for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
      const line = items[lineIndex];
      const stockItemId = String(line.stockItemId ?? '').trim();
      const cantidadPedida = Number(line.cantidad) || 0;
      const cantidadUsada = Number(line.cantidadUsada) || 0;
      const pendiente = Math.max(0, cantidadPedida - cantidadUsada);
      if (!stockItemId || pendiente <= 0) continue;

      if (prepared) {
        const faltante = Number(line.cantidadFaltante) || 0;
        if (faltante <= 0) continue;
        rows.push({
          orderId: doc.id,
          orderLabel,
          orderEstado: order.estado ?? '',
          lineIndex,
          stockItemId,
          productoNombre: String(line.nombre ?? 'Producto'),
          cantidadPedida,
          cantidadReservada: Number(line.cantidadReservada) || 0,
          cantidadUsada,
          cantidadFaltante: faltante,
          esEstimado: false,
        });
        continue;
      }

      const stockInfo = await loadStockLineContext(businessId, stockItemId, stockCache, categoriasSinStock);
      if (!stockInfo.controlaStock) continue;

      const faltanteEstimado = Math.max(0, pendiente - stockInfo.disponible);
      if (faltanteEstimado <= 0) continue;

      rows.push({
        orderId: doc.id,
        orderLabel,
        orderEstado: order.estado ?? '',
        lineIndex,
        stockItemId,
        productoNombre: String(line.nombre ?? stockInfo.nombre ?? 'Producto'),
        cantidadPedida,
        cantidadReservada: Number(line.cantidadReservada) || 0,
        cantidadUsada,
        cantidadFaltante: faltanteEstimado,
        esEstimado: true,
      });
    }
  }

  const groupedMap = new Map<string, StockShortageGroup>();
  for (const row of rows) {
    const existing = groupedMap.get(row.stockItemId);
    if (!existing) {
      groupedMap.set(row.stockItemId, {
        stockItemId: row.stockItemId,
        productoNombre: row.productoNombre,
        faltanteTotal: row.cantidadFaltante,
        pedidos: [{ orderId: row.orderId, orderLabel: row.orderLabel }],
        detalle: [row],
      });
      continue;
    }

    existing.faltanteTotal += row.cantidadFaltante;
    if (!existing.pedidos.some((entry) => entry.orderId === row.orderId)) {
      existing.pedidos.push({ orderId: row.orderId, orderLabel: row.orderLabel });
    }
    existing.detalle.push(row);
  }

  const grouped = [...groupedMap.values()].sort((a, b) =>
    a.productoNombre.localeCompare(b.productoNombre, 'es')
  );

  return { grouped, rows };
}

export type ReservationSourceOrder = {
  orderId: string;
  orderLabel: string;
  lineIndex: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadTransferible: number;
};

export async function listReservationSourcesForProduct(
  businessId: string,
  stockItemId: string,
  excludeOrderId?: string
): Promise<ReservationSourceOrder[]> {
  const targetId = String(stockItemId ?? '').trim();
  if (!targetId) return [];

  const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
  const sources: ReservationSourceOrder[] = [];

  for (const doc of snapshot.docs) {
    if (excludeOrderId && doc.id === excludeOrderId) continue;
    const order = doc.data() as OrderStockRecord & { estado?: string };
    if (String(order.estado ?? '').toLowerCase() === 'cancelado') continue;

    const items = normalizeOrderItemsStock(order.items ?? []);
    items.forEach((line, lineIndex) => {
      if (String(line.stockItemId ?? '') !== targetId) return;
      const reservada = Number(line.cantidadReservada) || 0;
      const usada = Number(line.cantidadUsada) || 0;
      const transferible = Math.max(0, reservada - usada);
      if (transferible <= 0) return;

      sources.push({
        orderId: doc.id,
        orderLabel: resolveOrderLabel(order),
        lineIndex,
        cantidadReservada: reservada,
        cantidadUsada: usada,
        cantidadTransferible: transferible,
      });
    });
  }

  return sources.sort((a, b) => a.orderLabel.localeCompare(b.orderLabel, 'es'));
}

export type ReservationTargetOrder = {
  orderId: string;
  orderLabel: string;
  lineIndex: number;
  cantidadPendiente: number;
  cantidadRoom: number;
};

export async function listReservationTargetsForProduct(
  businessId: string,
  stockItemId: string,
  sourceOrderId?: string
): Promise<ReservationTargetOrder[]> {
  const targetId = String(stockItemId ?? '').trim();
  if (!targetId) return [];

  const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
  const targets: ReservationTargetOrder[] = [];

  for (const doc of snapshot.docs) {
    if (sourceOrderId && doc.id === sourceOrderId) continue;
    const order = doc.data() as OrderStockRecord & { estado?: string };
    const estado = String(order.estado ?? '').toLowerCase();
    if (estado === 'cancelado' || estado === 'borrador') continue;

    const items = normalizeOrderItemsStock(order.items ?? []);
    items.forEach((line, lineIndex) => {
      if (String(line.stockItemId ?? '') !== targetId) return;
      const pedida = Number(line.cantidad) || 0;
      const usada = Math.max(0, Number(line.cantidadUsada) || 0);
      const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const pendiente = Math.max(0, pedida - usada);
      const room = Math.max(0, pendiente - reservada);
      if (room <= 0) return;

      targets.push({
        orderId: doc.id,
        orderLabel: resolveOrderLabel(order),
        lineIndex,
        cantidadPendiente: pendiente,
        cantidadRoom: room,
      });
    });
  }

  return targets.sort((a, b) => a.orderLabel.localeCompare(b.orderLabel, 'es'));
}

export type StockReservationRow = {
  orderId: string;
  orderLabel: string;
  orderEstado: string;
  clienteId: string;
  clienteNombre: string;
  stockItemId: string;
  productoNombre: string;
  lineIndex: number;
  cantidadReservada: number;
  cantidadUsada: number;
  cantidadActiva: number;
  stockPreparado: boolean;
};

export type StockReservationGroup = {
  stockItemId: string;
  productoNombre: string;
  reservadoTotal: number;
  reservas: StockReservationRow[];
};

export async function listStockReservations(
  businessId: string,
  stockItemIdFilter?: string
): Promise<{ rows: StockReservationRow[]; grouped: StockReservationGroup[] }> {
  const targetProductId = String(stockItemIdFilter ?? '').trim();
  const snapshot = await db.collection(`negocios/${businessId}/pedidos`).get();
  const clientCache = new Map<string, string>();
  const rows: StockReservationRow[] = [];

  async function getClientName(clienteId: string): Promise<string> {
    if (!clienteId) return 'Sin cliente';
    const cached = clientCache.get(clienteId);
    if (cached !== undefined) return cached;
    const name = await resolveClientName(businessId, clienteId);
    const resolved = name || 'Sin nombre';
    clientCache.set(clienteId, resolved);
    return resolved;
  }

  for (const doc of snapshot.docs) {
    const order = doc.data() as OrderStockRecord & { estado?: string };
    const estado = String(order.estado ?? '').toLowerCase();
    if (estado === 'cancelado') continue;

    const orderLabel = resolveOrderLabel(order);
    const clienteId = String(order.clienteId ?? '').trim();
    const clienteNombre = await getClientName(clienteId);
    const items = normalizeOrderItemsStock(order.items ?? []);

    items.forEach((line, lineIndex) => {
      const stockItemId = String(line.stockItemId ?? '').trim();
      if (!stockItemId) return;
      if (targetProductId && stockItemId !== targetProductId) return;

      const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const usada = Math.max(0, Number(line.cantidadUsada) || 0);
      const activa = Math.max(0, reservada - usada);
      if (activa <= 0) return;

      rows.push({
        orderId: doc.id,
        orderLabel,
        orderEstado: order.estado ?? '',
        clienteId,
        clienteNombre,
        stockItemId,
        productoNombre: String(line.nombre ?? 'Producto'),
        lineIndex,
        cantidadReservada: reservada,
        cantidadUsada: usada,
        cantidadActiva: activa,
        stockPreparado: !!order.stockPreparado,
      });
    });
  }

  rows.sort((a, b) => {
    const byProduct = a.productoNombre.localeCompare(b.productoNombre, 'es');
    if (byProduct !== 0) return byProduct;
    return a.orderLabel.localeCompare(b.orderLabel, 'es');
  });

  const groupedMap = new Map<string, StockReservationGroup>();
  for (const row of rows) {
    const existing = groupedMap.get(row.stockItemId);
    if (!existing) {
      groupedMap.set(row.stockItemId, {
        stockItemId: row.stockItemId,
        productoNombre: row.productoNombre,
        reservadoTotal: row.cantidadActiva,
        reservas: [row],
      });
      continue;
    }
    existing.reservadoTotal += row.cantidadActiva;
    existing.reservas.push(row);
  }

  const grouped = [...groupedMap.values()].sort((a, b) =>
    a.productoNombre.localeCompare(b.productoNombre, 'es')
  );

  return { rows, grouped };
}

export type OrderPurchaseGapRepairLine = {
  lineIndex: number;
  cantidadFaltanteCompra: number;
};

export type OrderPurchaseGapRepairResult = {
  items: OrderLineStock[];
  estadoStock: OrderStockStatus;
  stockRestored: Array<{ stockItemId: string; nombre: string; cantidad: number }>;
};

/** Restaura faltantes de compra y corrige cantidadUsada tras un descuento excesivo en producción. */
export async function repairOrderPurchaseGaps(
  businessId: string,
  orderId: string,
  repairs: OrderPurchaseGapRepairLine[],
  options: { restoreExcessStock?: boolean; orderLabel?: string } = {}
): Promise<OrderPurchaseGapRepairResult> {
  const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new OrderStockError('Pedido no encontrado.');
  }

  const order = orderSnap.data() as OrderStockRecord;
  const orderLabel = options.orderLabel ?? resolveOrderLabel(order);
  const items = normalizeOrderItemsStock(order.items ?? []).map((line) => ({ ...line }));
  const repairMap = new Map(repairs.map((entry) => [entry.lineIndex, entry.cantidadFaltanteCompra]));
  const stockRestored: Array<{ stockItemId: string; nombre: string; cantidad: number }> = [];

  for (const [lineIndex, cantidadFaltanteCompra] of repairMap) {
    if (lineIndex < 0 || lineIndex >= items.length) continue;

    const line = items[lineIndex];
    const cantidadPedida = Number(line.cantidad) || 0;
    const faltanteCompra = Math.min(cantidadPedida, Math.max(0, cantidadFaltanteCompra));
    const cantidadUsadaActual = Math.max(0, Number(line.cantidadUsada) || 0);
    const cantidadUsadaEsperada = Math.max(0, cantidadPedida - faltanteCompra);
    const excess = Math.max(0, cantidadUsadaActual - cantidadUsadaEsperada);

    line.cantidadFaltanteCompra = faltanteCompra;
    line.cantidadUsada = cantidadUsadaEsperada;
    line.cantidadReservada = 0;
    items[lineIndex] = computeLineStockFields(line);

    const stockItemId = String(line.stockItemId ?? '').trim();
    if (options.restoreExcessStock && stockItemId && excess > 0) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(stockItemId);
      const itemSnap = await itemRef.get();
      if (itemSnap.exists) {
        const data = itemSnap.data() as Record<string, unknown>;
        const stockActual = Number(data.stockActual) || 0;
        await itemRef.update({ stockActual: stockActual + excess });
        await db.collection(`negocios/${businessId}/movimientos_stock`).add({
          productoId: stockItemId,
          tipo: 'entrada',
          cantidad: excess,
          fecha: new Date().toISOString(),
          motivo: `Pedido #${orderLabel} - Corrección stock (unidades descontadas de más)`,
          origenId: orderId,
          origenTipo: 'pedido_correccion_stock',
          origenGrupo: 'pedido',
          pedidoId: orderId,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
          afectaStockReal: true,
          negocioId: businessId,
        });
        stockRestored.push({
          stockItemId,
          nombre: String(line.nombre ?? data.nombre ?? 'Producto'),
          cantidad: excess,
        });
      }
    }
  }

  const estadoStock = computeOrderStockStatus(items);
  await orderRef.update({
    items,
    estadoStock,
    updatedAt: new Date().toISOString(),
  });

  return { items, estadoStock, stockRestored };
}
