import { db } from '../firebase.ts';
import { resolveOrderLabel } from './order-number.ts';

export type OrderStockItemStatus = 'sin_preparar' | 'completo' | 'parcial' | 'faltante';
export type OrderStockStatus = 'sin_preparar' | 'completo' | 'parcial' | 'faltante';

export type OrderLineStock = {
  stockItemId?: string;
  nombre?: string;
  cantidad?: number;
  cantidadReservada?: number;
  cantidadUsada?: number;
  cantidadFaltante?: number;
  estadoStockItem?: OrderStockItemStatus;
};

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

function productControlsStock(data: Record<string, unknown> | undefined): boolean {
  return data?.controlaStock !== false;
}

async function adjustGlobalStockReservation(params: {
  businessId: string;
  stockItemId: string;
  delta: number;
  productName: string;
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
    const stockReservado = Number(data.stockReservado) || 0;

    if (delta > 0 && productControlsStock(data)) {
      const stockReal = Number(data.stockActual) || 0;
      const disponible = getStockDisponible(stockReal, stockReservado);
      if (delta > disponible) {
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
  const cantidadReservada = Math.max(0, Number(line.cantidadReservada) || 0);
  const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
  const maxAssignable = Math.max(0, cantidadPedida - cantidadUsada);
  const reserved = Math.min(cantidadReservada, maxAssignable);
  const cantidadFaltante = Math.max(0, cantidadPedida - reserved - cantidadUsada);

  let estadoStockItem: OrderStockItemStatus = 'sin_preparar';
  if (cantidadPedida <= 0) {
    estadoStockItem = 'completo';
  } else if (cantidadFaltante <= 0) {
    estadoStockItem = 'completo';
  } else if (reserved > 0) {
    estadoStockItem = 'parcial';
  } else {
    estadoStockItem = 'faltante';
  }

  return {
    ...line,
    cantidadReservada: reserved,
    cantidadUsada,
    cantidadFaltante,
    estadoStockItem,
  };
}

export function computeOrderStockStatus(items: OrderLineStock[] = []): OrderStockStatus {
  const stockLines = items.filter((line) => line.stockItemId && (Number(line.cantidad) || 0) > 0);
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
    }
    return computeLineStockFields(merged);
  });
}

const RESERVATION_MOVEMENT_ORIGINS = new Set([
  'pedido_reserva',
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
};

export async function buildStockPreparationView(
  businessId: string,
  order: OrderStockRecord
): Promise<StockPreparationLine[]> {
  const lines: StockPreparationLine[] = [];

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

    const qtyUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const maxReservable = Math.max(0, cantidadPedida - qtyUsada);
    const alloc = allocationMap.get(lineIndex);
    let requested = Number(line.cantidadReservada) || 0;

    if (alloc) {
      if (alloc.faltante !== undefined) {
        const faltante = Math.min(maxReservable, alloc.faltante);
        requested = Math.max(0, maxReservable - faltante);
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
      });

      if (delta > 0) {
        await writeStockMovement({
          businessId,
          productoId: stockItemId,
          cantidad: delta,
          motivo: `Reserva pedido #${orderLabel}`,
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
          motivo: `Liberación reserva pedido #${orderLabel}`,
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
      motivo: `Liberación reserva pedido #${orderLabel} (cancelado)`,
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
  }

  return released;
}

export async function consumeOrderStockDirect(
  businessId: string,
  orderId: string,
  order: OrderStockRecord
): Promise<{ items: OrderLineStock[]; stockDescontado: boolean; estadoStock: OrderStockStatus }> {
  const normalizedItems = normalizeOrderItemsStock(order.items ?? []);

  if (order.stockDescontado) {
    return {
      items: normalizedItems,
      stockDescontado: true,
      estadoStock: computeOrderStockStatus(normalizedItems),
    };
  }

  const items = normalizedItems.map((line) => ({ ...line }));
  const orderLabel = resolveOrderLabel(order);
  let consumedAny = false;

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const toConsume = Math.max(0, cantidadPedida - cantidadUsada);

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
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    let stockActual = Number(data.stockActual) || 0;
    let stockReservado = Number(data.stockReservado) || 0;

    if (controlsStock && stockActual < toConsume) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      throw new OrderStockError(
        `Stock insuficiente para «${nombre}»: hay ${stockActual} u. en depósito y el pedido necesita ${toConsume} u.`
      );
    }

    if (reserved > 0) {
      stockReservado = Math.max(0, stockReservado - reserved);
    }

    if (controlsStock) {
      stockActual = Math.max(0, stockActual - toConsume);
    }

    await itemRef.update({ stockActual, stockReservado });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: stockItemId,
      tipo: 'salida',
      cantidad: toConsume,
      fecha: new Date().toISOString(),
      motivo: `Descuento pedido #${orderLabel}`,
      origenId: orderId,
      origenTipo: 'pedido_descuento',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      afectaStockReal: controlsStock,
      negocioId: businessId,
    });

    line.cantidadUsada = cantidadUsada + toConsume;
    line.cantidadReservada = 0;
    items[lineIndex] = computeLineStockFields(line);
    consumedAny = true;
  }

  return {
    items,
    stockDescontado: consumedAny,
    estadoStock: computeOrderStockStatus(items),
  };
}

export async function consumeOrderStockForProduction(
  businessId: string,
  orderId: string,
  order: OrderStockRecord
): Promise<{ items: OrderLineStock[]; stockDescontado: boolean; estadoStock: OrderStockStatus }> {
  const normalizedItems = normalizeOrderItemsStock(order.items ?? []);

  if (order.stockDescontado) {
    return {
      items: normalizedItems,
      stockDescontado: true,
      estadoStock: computeOrderStockStatus(normalizedItems),
    };
  }

  if (!order.stockPreparado) {
    throw new OrderStockError(
      'Revisá el stock del pedido (checklist) antes de pasarlo a producción.'
    );
  }

  const items = normalizedItems.map((line) => ({ ...line }));
  const orderLabel = resolveOrderLabel(order);
  let consumedAny = false;

  for (let lineIndex = 0; lineIndex < items.length; lineIndex++) {
    const line = items[lineIndex];
    const stockItemId = String(line.stockItemId ?? '').trim();
    const cantidadPedida = Number(line.cantidad) || 0;
    const cantidadUsada = Math.max(0, Number(line.cantidadUsada) || 0);
    const toConsume = Math.max(0, cantidadPedida - cantidadUsada);

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
    const reserved = Math.max(0, Number(line.cantidadReservada) || 0);
    let stockActual = Number(data.stockActual) || 0;
    let stockReservado = Number(data.stockReservado) || 0;

    if (controlsStock && stockActual < toConsume) {
      const nombre = String(line.nombre ?? data.nombre ?? 'Producto');
      throw new OrderStockError(
        `Stock insuficiente para producir «${nombre}»: hay ${stockActual} u. en depósito y el pedido necesita ${toConsume} u. Registrá la compra antes de pasar a producción.`
      );
    }

    if (reserved > 0) {
      stockReservado = Math.max(0, stockReservado - reserved);
    }

    if (controlsStock) {
      stockActual = Math.max(0, stockActual - toConsume);
    }

    await itemRef.update({ stockActual, stockReservado });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: stockItemId,
      tipo: 'salida',
      cantidad: toConsume,
      fecha: new Date().toISOString(),
      motivo: `Producción pedido #${orderLabel}`,
      origenId: orderId,
      origenTipo: 'pedido_produccion',
      origenGrupo: 'pedido',
      pedidoId: orderId,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
      afectaStockReal: controlsStock,
      negocioId: businessId,
    });

    line.cantidadUsada = cantidadUsada + toConsume;
    line.cantidadReservada = 0;
    items[lineIndex] = computeLineStockFields(line);
    consumedAny = true;
  }

  return {
    items,
    stockDescontado: consumedAny,
    estadoStock: computeOrderStockStatus(items),
  };
}

export async function consumeOrderStockOnStatusChange(
  businessId: string,
  orderId: string,
  order: OrderStockRecord,
  modoStock: 'reservado' | 'directo'
): Promise<{ items: OrderLineStock[]; stockDescontado: boolean; estadoStock: OrderStockStatus }> {
  if (modoStock === 'directo') {
    return consumeOrderStockDirect(businessId, orderId, order);
  }
  return consumeOrderStockForProduction(businessId, orderId, order);
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
    motivo: `Transferencia reserva #${sourceLabel} → #${targetLabel}`,
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
  cache: Map<string, { disponible: number; controlaStock: boolean; nombre: string }>
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

      const stockInfo = await loadStockLineContext(businessId, stockItemId, stockCache);
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
