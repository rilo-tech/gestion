import { db } from '../firebase.ts';
import { resolveOrderLabel } from './order-number.ts';
import { allocateSaleNumber } from './sale-number.ts';

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

export type OrderLineForSale = {
  stockItemId?: string;
  cantidad?: number;
  nombre?: string;
  precioVenta?: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: Array<{ nombre?: string; costo?: number }>;
};

export type OrderForSale = {
  clienteId?: string;
  total?: number;
  costoReal?: number;
  items?: OrderLineForSale[];
  numeroPedido?: number;
  numeroPedidoLabel?: string;
};

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
}): number {
  const fromList = (line.costosExtra ?? []).reduce(
    (acc, extra) => acc + (Number(extra.costo) || 0),
    0
  );
  if (fromList > 0) return fromList;
  return Number(line.costoPersonalizacion) || 0;
}

function calculateSaleCost(items: SaleLine[]): number {
  return items.reduce((acc, line) => {
    const cantidad = Number(line.cantidad) || 0;
    const base = cantidad * (Number(line.costoUnitario) || 0);
    const personalizacion = sumLinePersonalizationCost(line);
    return acc + base + personalizacion;
  }, 0);
}

function buildSaleLineFromOrderLine(line: OrderLineForSale): SaleLine {
  const cantidad = Number(line.cantidad) || 0;
  const precioUnitario = Number(line.precioVenta) || 0;
  const costosExtra = normalizeSaleLineExtraCosts(line.costosExtra, line.costoPersonalizacion);
  const costoPersonalizacion = sumLinePersonalizationCost({
    costosExtra,
    costoPersonalizacion: line.costoPersonalizacion,
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
  const costoReal =
    Number(fallbackCostoReal) > 0 ? Number(fallbackCostoReal) : calculateSaleCost(items);
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
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: params.medio ?? 'efectivo',
    concepto: params.concepto,
    ambito: 'negocio',
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

export async function createSaleFromOrder(
  businessId: string,
  orderId: string,
  order: OrderForSale,
  options: {
    montoCobrado: number;
    totalPagadoAnterior: number;
    medioPago?: string;
    notas?: string;
  }
): Promise<{
  ventaId: string;
  ventaLabel: string;
  movimientoCajaId: string | null;
  saldoPendiente: number;
}> {
  const total = Number(order.total) || 0;
  const montoCobrado = Math.max(0, Number(options.montoCobrado) || 0);
  const totalPagadoAnterior = Math.max(0, Number(options.totalPagadoAnterior) || 0);
  const saldoPedido = Math.max(0, total - totalPagadoAnterior);

  if (montoCobrado > saldoPedido) {
    throw new Error(`El monto a cobrar supera el saldo pendiente del pedido ($${saldoPedido}).`);
  }

  const orderLabel = resolveOrderLabel(order);
  const items = (order.items ?? []).map((line) => buildSaleLineFromOrderLine(line));
  const economics = buildSaleEconomics(items, total, order.costoReal);
  const timestamp = new Date().toISOString();
  const medioPago = String(options.medioPago ?? 'efectivo').trim() || 'efectivo';

  const { numero: numeroVenta, label: ventaLabel } = await allocateSaleNumber(businessId);

  const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
    origen: 'pedido',
    pedidoId: orderId,
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
    notas: options.notas ?? '',
    fecha: timestamp,
    negocioId: businessId,
  });

  let movimientoCajaId: string | null = null;
  if (montoCobrado > 0) {
    movimientoCajaId = await createCashIncome(businessId, {
      monto: montoCobrado,
      concepto: `Saldo entrega pedido #${orderLabel} · venta #${ventaLabel}`,
      origenId: ventaRef.id,
      origenTipo: 'venta_pedido',
      medio: medioPago,
      clienteId: order.clienteId,
      pedidoId: orderId,
      ventaId: ventaRef.id,
      ventaLabel,
      numeroPedido: order.numeroPedido ?? null,
      numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
    });
    await ventaRef.update({ movimientoCajaId });
  }

  return {
    ventaId: ventaRef.id,
    ventaLabel,
    movimientoCajaId,
    saldoPendiente: Math.max(0, total - totalPagadoAnterior - montoCobrado),
  };
}
