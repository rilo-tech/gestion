/**
 * Alta de venta mostrador compartida (ERP + WhatsApp).
 * Misma persistencia de venta, caja vinculada y stock.
 */
import { db } from '../../firebase.ts';
import { allocateSaleNumber } from '../../utils/sale-number.ts';
import { computeComprobanteSaldoPendiente } from '../../../shared/comprobantes-config.ts';
import { productControlsStock } from '../../utils/stock-product.ts';
import {
  findMedioPagoInConfig,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
  type MedioPagoConfig,
} from '../../utils/finance-config.ts';
import { normalizeMovementAmbito } from '../../utils/caja-ambitos.ts';
import { scheduleStockMetricsRefresh } from '../../utils/stock-metrics.ts';

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  return ((snap.data()?.caja as Record<string, unknown>) ?? {}) as Record<string, unknown>;
}

export type CreateSaleCommand = {
  businessId: string;
  clienteId: string;
  items: MostradorSaleLineInput[];
  total: number;
  /** Monto cobrado ahora (0 = a cuenta). */
  amountPaid: number;
  paymentMethod?: string | null;
  paymentMethodHint?: string | null;
  notas?: string;
  fechaIso: string;
  /** Origen de interfaz; no cambia reglas contables. */
  source: 'erp' | 'whatsapp' | 'system';
  actorId?: string;
  whatsappPhone?: string;
  tipoComprobante?: string;
  motivo?: string | null;
  descripcionMotivo?: string | null;
  comprobanteRelacionadoId?: string | null;
};

export type MostradorSaleLineInput = {
  stockItemId?: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  costoUnitario?: number;
  tipoLinea?: 'producto' | 'concepto';
  mueveStock?: boolean;
  costoPersonalizacion?: number;
  costosExtra?: unknown[];
};

export type CreateMostradorSaleInput = {
  businessId: string;
  clienteId: string;
  items: MostradorSaleLineInput[];
  total: number;
  montoCobrado: number;
  medioPagoId?: string | null;
  paymentMethodHint?: string | null;
  notas?: string;
  fechaIso: string;
  source?: 'web' | 'whatsapp' | 'erp' | 'system';
  whatsappPhone?: string;
  actorId?: string;
  tipoComprobante?: string;
  motivo?: string | null;
  descripcionMotivo?: string | null;
  comprobanteRelacionadoId?: string | null;
};

export type CreateMostradorSaleResult = {
  ventaId: string;
  ventaLabel: string;
  numeroVenta: number;
  total: number;
  montoCobrado: number;
  saldoPendiente: number;
  medioPago: string;
  movimientoCajaId: string | null;
};

function computeEconomics(items: MostradorSaleLineInput[], total: number) {
  const costoReal =
    Math.round(
      items.reduce((acc, line) => {
        const qty = Number(line.cantidad) || 0;
        return acc + qty * (Number(line.costoUnitario) || 0);
      }, 0) * 100
    ) / 100;
  return {
    costoReal,
    gananciaEstimada: Math.round((total - costoReal) * 100) / 100,
  };
}

export async function resolveSalePaymentMethodId(
  businessId: string,
  opts?: { explicitId?: string | null; hint?: string | null; profileDefault?: string | null }
): Promise<string> {
  const finanzas = await loadFinanzasConfig(businessId);
  const medios = finanzas.mediosPago.filter((m) => m.activo !== false);
  const explicit = String(opts?.explicitId ?? '').trim().toLowerCase();
  if (explicit) {
    const hit = findMedioPagoInConfig(medios, explicit);
    if (hit) return hit.id;
  }
  const hint = String(opts?.hint ?? '').trim().toLowerCase();
  if (hint) {
    const byId = findMedioPagoInConfig(medios, hint);
    if (byId) return byId.id;
    const byLabel = medios.find((m) => m.label.toLowerCase().includes(hint) || hint.includes(m.id));
    if (byLabel) return byLabel.id;
  }
  const profileDefault = String(opts?.profileDefault ?? '').trim().toLowerCase();
  if (profileDefault) {
    const hit = findMedioPagoInConfig(medios, profileDefault);
    if (hit) return hit.id;
  }
  const efectivo = findMedioPagoInConfig(medios, 'efectivo');
  if (efectivo) return efectivo.id;
  return medios[0]?.id || 'efectivo';
}

async function createLinkedCashIncome(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    medio: string;
    clienteId: string;
    ventaId: string;
    ventaLabel: string;
    fechaIso: string;
  }
): Promise<string> {
  const caja = await loadCajaConfig(businessId);
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: params.medio,
    concepto: params.concepto,
    ambito: normalizeMovementAmbito(undefined, caja),
    fecha: params.fechaIso,
    origenId: params.origenId,
    origenTipo: 'venta_mostrador',
    origenGrupo: 'venta',
    pedidoId: null,
    ventaId: params.ventaId,
    ventaLabel: params.ventaLabel,
    clienteId: params.clienteId,
    negocioId: businessId,
  });
  return docRef.id;
}

async function applyStockForMostradorSale(
  businessId: string,
  ventaId: string,
  ventaLabel: string,
  items: MostradorSaleLineInput[],
  actorId: string
): Promise<string | null> {
  const timestamp = new Date().toISOString();
  for (const line of items) {
    const qty = Number(line.cantidad) || 0;
    if (!line.stockItemId || qty <= 0 || line.mueveStock === false) continue;
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;
    const itemData = itemSnap.data() ?? {};
    if (!productControlsStock(itemData as Record<string, unknown>)) continue;
    const current = Number(itemData.stockActual) || 0;
    const next = current - qty;
    if (itemData.permitirStockNegativo === false && next < 0) {
      return `No hay stock suficiente de «${line.nombre}».`;
    }
    await itemRef.update({ stockActual: next, updatedAt: timestamp });
    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.stockItemId,
      tipo: 'salida',
      cantidad: qty,
      fecha: timestamp,
      motivo: `Venta #${ventaLabel}`,
      origenId: ventaId,
      origenTipo: 'venta_mostrador',
      origenGrupo: 'venta',
      ventaId,
      usuarioId: actorId,
      negocioId: businessId,
    });
  }
  scheduleStockMetricsRefresh(businessId);
  return null;
}

/**
 * Crea venta mostrador confirmada con las mismas reglas para web y WhatsApp.
 */
export async function createMostradorSale(
  input: CreateMostradorSaleInput
): Promise<CreateMostradorSaleResult> {
  const total = Number(input.total) || 0;
  if (total <= 0) throw new Error('Indicá el monto de la venta.');
  if (!input.clienteId) throw new Error('Seleccioná un cliente para la venta.');
  if (!input.items.length) throw new Error('La venta no tiene ítems.');

  const montoCobrado = Math.min(Math.max(0, Number(input.montoCobrado) || 0), total);
  const medioPago = await resolveSalePaymentMethodId(input.businessId, {
    explicitId: input.medioPagoId,
    hint: input.paymentMethodHint,
  });

  const finanzas = await loadFinanzasConfig(input.businessId);
  const medioCfg: MedioPagoConfig | undefined = findMedioPagoInConfig(
    finanzas.mediosPago,
    medioPago
  );
  const shouldCash = montoCobrado > 0 && medioPagoGeneratesImmediateCash(medioCfg);

  const economics = computeEconomics(input.items, total);
  const { numero: numeroVenta, label: ventaLabel } = await allocateSaleNumber(input.businessId);

  const items = input.items.map((line) => ({
    tipoLinea: line.tipoLinea ?? (line.stockItemId ? 'producto' : 'concepto'),
    stockItemId: line.stockItemId || '',
    nombre: line.nombre,
    descripcion: line.nombre,
    cantidad: line.cantidad,
    precioUnitario: line.precioUnitario,
    subtotal: line.subtotal,
    costoUnitario: Number(line.costoUnitario) || 0,
    mueveStock: line.mueveStock !== false && Boolean(line.stockItemId),
  }));

  const esDonacion = total === 0;
  const tipoComprobante = String(input.tipoComprobante ?? 'ticket').trim() || 'ticket';
  const source =
    input.source === 'whatsapp'
      ? 'whatsapp'
      : input.source === 'erp' || input.source === 'web'
        ? 'erp'
        : input.source === 'system'
          ? 'system'
          : 'erp';

  const ventaRef = await db.collection(`negocios/${input.businessId}/ventas`).add({
    origen: 'mostrador',
    pedidoId: null,
    estado: 'confirmada',
    tipoComprobante,
    motivo: input.motivo || null,
    descripcionMotivo: input.descripcionMotivo || null,
    comprobanteRelacionadoId: input.comprobanteRelacionadoId || null,
    numeroVenta,
    ventaLabel,
    clienteId: input.clienteId,
    items,
    total,
    costoReal: economics.costoReal,
    gananciaEstimada: economics.gananciaEstimada,
    totalPagadoAnterior: 0,
    montoCobrado,
    saldoPendiente: computeComprobanteSaldoPendiente(total, montoCobrado),
    medioPago,
    notas: esDonacion
      ? String(input.notas ?? '').trim()
        ? `${String(input.notas).trim()} · Donación`
        : 'Donación'
      : String(input.notas ?? '').trim(),
    esDonacion,
    fecha: input.fechaIso,
    origenWhatsapp: source === 'whatsapp',
    ...(input.whatsappPhone ? { whatsappPhone: input.whatsappPhone } : {}),
    negocioId: input.businessId,
    source,
  });

  const stockError = await applyStockForMostradorSale(
    input.businessId,
    ventaRef.id,
    ventaLabel,
    items,
    input.actorId || (source === 'whatsapp' ? 'whatsapp' : 'system')
  );
  if (stockError) {
    await ventaRef.delete();
    throw new Error(stockError);
  }

  let movimientoCajaId: string | null = null;
  if (shouldCash) {
    movimientoCajaId = await createLinkedCashIncome(input.businessId, {
      monto: montoCobrado,
      concepto:
        source === 'whatsapp'
          ? `Venta WhatsApp #${ventaLabel}`
          : `Venta mostrador #${ventaLabel}`,
      origenId: ventaRef.id,
      medio: medioPago,
      clienteId: input.clienteId,
      ventaId: ventaRef.id,
      ventaLabel,
      fechaIso: input.fechaIso,
    });
    await ventaRef.update({ movimientoCajaId });
  }

  return {
    ventaId: ventaRef.id,
    ventaLabel,
    numeroVenta,
    total,
    montoCobrado,
    saldoPendiente: computeComprobanteSaldoPendiente(total, montoCobrado),
    medioPago,
    movimientoCajaId,
  };
}

/** Alias de comando de aplicación (ERP + WhatsApp). */
export async function createSaleFromCommand(
  command: CreateSaleCommand
): Promise<CreateMostradorSaleResult> {
  return createMostradorSale({
    businessId: command.businessId,
    clienteId: command.clienteId,
    items: command.items,
    total: command.total,
    montoCobrado: command.amountPaid,
    medioPagoId: command.paymentMethod,
    paymentMethodHint: command.paymentMethodHint,
    notas: command.notas,
    fechaIso: command.fechaIso,
    source: command.source,
    actorId: command.actorId,
    whatsappPhone: command.whatsappPhone,
    tipoComprobante: command.tipoComprobante,
    motivo: command.motivo,
    descripcionMotivo: command.descripcionMotivo,
    comprobanteRelacionadoId: command.comprobanteRelacionadoId,
  });
}

/** Efectos de dominio comparables (tests de paridad; sin IDs/timestamps). */
export function saleDomainEffectsSnapshot(result: CreateMostradorSaleResult): {
  total: number;
  montoCobrado: number;
  saldoPendiente: number;
  medioPago: string;
  hasCash: boolean;
} {
  return {
    total: result.total,
    montoCobrado: result.montoCobrado,
    saldoPendiente: result.saldoPendiente,
    medioPago: result.medioPago,
    hasCash: Boolean(result.movimientoCajaId),
  };
}
