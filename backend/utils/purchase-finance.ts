import { db } from '../firebase.ts';
import { normalizeMovementAmbito, resolveCashReversalAmbito } from './caja-ambitos.ts';
import { createCashEgresoForAmbitoTotals } from './cash-egreso.ts';
import { syncPurchasePayablesForCompra } from './card-statements.ts';
import {
  getCategoriaGastoById,
  getMedioPagoById,
  getTarjetaById,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  purchaseLineAffectsStock,
  type PurchaseLineTipo,
} from './finance-config.ts';
import { syncPendingOrdersAfterStockChange } from './order-stock-reservations.ts';
import { allocatePurchaseNumber, resolvePurchaseLabel } from './purchase-number.ts';
import { scheduleStockMetricsRefresh } from './stock-metrics.ts';
import {
  comprobanteStockDireccion,
  esNotaCredito,
  normalizeComprobanteTipo,
  type ComprobanteTipoId,
} from '../../shared/comprobantes-config.ts';
import { getBusinessCashAmbitoId } from './caja-ambitos.ts';

/** Firestore rejects `undefined` anywhere in the document tree. */
function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = stripUndefinedDeep(entry);
    }
    return result as T;
  }
  return value;
}

export interface ParsedPurchaseLine {
  id: string;
  tipoLinea: PurchaseLineTipo;
  ambito: string;
  categoriaId?: string;
  categoriaLabel?: string;
  descripcion: string;
  productoId?: string;
  productoNombre?: string;
  cantidad: number;
  costoUnitario: number;
  importe: number;
  afectaStock: boolean;
  /** Compra puntual en oferta: no actualiza el costo configurado del producto. */
  enOferta: boolean;
  /** Porcentaje que se compró por debajo del precio normal (0-99). */
  descuentoOfertaPct: number;
  /** Ahorro estimado de la línea vs. el precio normal (solo si está en oferta). */
  ahorroOferta: number;
}

export interface ParsedPurchasePayment {
  medioPagoId: string;
  tarjetaId?: string;
  cuotas: number;
  fechaPrimerVencimiento?: string;
}

export interface ParsedPurchaseInput {
  proveedorId?: string;
  proveedor: string;
  notas: string;
  numeroComprobante: string;
  tipoComprobante: ComprobanteTipoId;
  fecha: string;
  items: ParsedPurchaseLine[];
  pago: ParsedPurchasePayment;
  totalNegocio: number;
  totalPersonal: number;
  total: number;
}

function normalizePurchaseLineTipo(
  value: unknown,
  line?: Record<string, unknown>
): PurchaseLineTipo {
  const raw = String(value ?? '').trim().toLowerCase();
  const hasProduct = Boolean(String(line?.productoId ?? '').trim());
  const hasCategoria = Boolean(String(line?.categoriaId ?? '').trim());

  if (hasCategoria && !hasProduct) {
    if (raw === 'personal') return 'personal';
    if (raw === 'servicio') return 'servicio';
    return 'insumo';
  }

  if (raw === 'insumo' || raw === 'servicio' || raw === 'personal') return raw;
  if (hasProduct) return 'stock';
  return 'stock';
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

type FinanzasConfig = Awaited<ReturnType<typeof loadFinanzasConfig>>;

export async function parsePurchaseInput(
  businessId: string,
  body: Record<string, unknown>,
  options?: {
    relaxed?: boolean;
    /** Al re-leer una compra guardada, el proveedor ya está en el documento. */
    skipSupplierLookup?: boolean;
    finanzas?: FinanzasConfig;
    caja?: Record<string, unknown>;
  }
): Promise<{ input?: ParsedPurchaseInput; error?: string }> {
  const finanzas = options?.finanzas ?? (await loadFinanzasConfig(businessId));
  let caja = options?.caja;
  if (!caja) {
    const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
    caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  }

  const proveedorId = String(body.proveedorId ?? '').trim();
  let proveedor = String(body.proveedor ?? '').trim();
  if (proveedorId && !options?.skipSupplierLookup) {
    const supplierSnap = await db
      .collection(`negocios/${businessId}/proveedores`)
      .doc(proveedorId)
      .get();
    if (supplierSnap.exists) {
      proveedor = String(supplierSnap.data()?.nombre ?? proveedor).trim();
    }
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: ParsedPurchaseLine[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const line = rawItems[i] as Record<string, unknown>;
    const tipoLinea = normalizePurchaseLineTipo(line.tipoLinea, line);
    const ambito = normalizeMovementAmbito(line.ambito, caja);
    const categoriaId = String(line.categoriaId ?? '').trim() || undefined;
    const categoria = categoriaId
      ? getCategoriaGastoById(finanzas.categoriasGasto, categoriaId)
      : undefined;

    let descripcion = String(line.descripcion ?? '').trim();
    const productoId = String(line.productoId ?? '').trim() || undefined;
    const cantidad = Math.max(0, Number(line.cantidad) || 0);
    let costoUnitario = Math.max(0, Number(line.costoUnitario) || 0);
    let importe = Number(line.importe) || 0;

    if (tipoLinea === 'stock') {
      if (!productoId) {
        return { error: 'Cada línea de stock debe tener un producto.' };
      }
      if (cantidad <= 0) {
        return { error: 'Cada línea de stock debe tener cantidad.' };
      }
      importe = Math.max(0, importe);
      if (importe <= 0) {
        importe = cantidad * costoUnitario;
      } else if (costoUnitario <= 0) {
        costoUnitario = Math.round((importe / cantidad) * 100) / 100;
      }
    } else {
      if (!descripcion && categoria) descripcion = categoria.label;
      if (!descripcion) {
        return { error: 'Cada línea de gasto debe tener descripción o categoría.' };
      }
      if (importe === 0) {
        return {
          error: `La línea "${descripcion}" debe tener importe distinto de cero (negativo = crédito o devolución en cuotas).`,
        };
      }
    }

    const enOferta = tipoLinea === 'stock' && line.enOferta === true;

    items.push({
      id: String(line.id ?? `line_${i + 1}`),
      tipoLinea,
      ambito,
      categoriaId,
      categoriaLabel: categoria?.label,
      descripcion: descripcion || categoria?.label || 'Gasto',
      productoId,
      productoNombre: String(line.productoNombre ?? '').trim() || undefined,
      cantidad: tipoLinea === 'stock' ? cantidad : 0,
      costoUnitario: tipoLinea === 'stock' ? costoUnitario : 0,
      importe,
      afectaStock: purchaseLineAffectsStock(tipoLinea),
      enOferta,
      descuentoOfertaPct: 0,
      ahorroOferta: 0,
    });
  }

  if (items.length === 0) {
    if (!options?.relaxed) {
      return { error: 'Agregá al menos una línea a la compra.' };
    }
  }

  const pagoRaw = (body.pago as Record<string, unknown>) ?? {};
  const medioPagoId = String(pagoRaw.medioPagoId ?? body.medioPagoId ?? 'efectivo')
    .trim()
    .toLowerCase();
  const medio = getMedioPagoById(finanzas.mediosPago, medioPagoId);
  if (!medio) {
    return { error: 'Medio de pago inválido.' };
  }

  const tarjetaId = String(pagoRaw.tarjetaId ?? body.tarjetaId ?? '').trim() || undefined;
  const tarjeta = tarjetaId ? getTarjetaById(finanzas.tarjetas, tarjetaId) : undefined;

  let effectiveMedio = medio;
  let effectiveMedioPagoId = medioPagoId;
  if (tarjeta && tarjeta.medioPagoId !== medio.id) {
    const medioFromTarjeta = getMedioPagoById(finanzas.mediosPago, tarjeta.medioPagoId);
    if (medioFromTarjeta) {
      effectiveMedio = medioFromTarjeta;
      effectiveMedioPagoId = medioFromTarjeta.id;
    } else if (!options?.relaxed) {
      return { error: 'La cuenta seleccionada no corresponde a este medio de pago.' };
    }
  }

  if (medioPagoRequiereCuentaHija(effectiveMedio) && !tarjeta && !options?.relaxed) {
    return { error: 'Seleccioná la cuenta para este medio de pago.' };
  }

  const cuotas = Math.min(Math.max(1, Math.round(Number(pagoRaw.cuotas ?? body.cuotas) || 1)), 120);
  const fechaPrimerVencimiento = normalizeDate(
    pagoRaw.fechaPrimerVencimiento ?? body.fechaPrimerVencimiento
  );

  if (medioPagoGeneratesPayables(effectiveMedio) && !fechaPrimerVencimiento && !options?.relaxed) {
    return { error: 'Indicá la fecha del primer vencimiento.' };
  }

  let totalNegocio = 0;
  let totalPersonal = 0;
  for (const line of items) {
    if (line.ambito === 'personal') totalPersonal += line.importe;
    else totalNegocio += line.importe;
  }
  const total = Math.round((totalNegocio + totalPersonal) * 100) / 100;

  return {
    input: {
      proveedorId: proveedorId || undefined,
      proveedor,
      notas: String(body.notas ?? '').trim(),
      numeroComprobante: String(body.numeroComprobante ?? '').trim(),
      tipoComprobante: normalizeComprobanteTipo(body.tipoComprobante),
      fecha: normalizeDate(body.fecha),
      items,
      pago: {
        medioPagoId: effectiveMedioPagoId,
        tarjetaId,
        cuotas,
        fechaPrimerVencimiento,
      },
      totalNegocio: Math.round(totalNegocio * 100) / 100,
      totalPersonal: Math.round(totalPersonal * 100) / 100,
      total,
    },
  };
}

export function isPurchaseDraft(compra: { estado?: string }): boolean {
  const estado = String(compra.estado ?? '').trim().toLowerCase();
  return estado === 'borrador';
}

async function normalizePurchaseItems(
  businessId: string,
  input: ParsedPurchaseInput
): Promise<Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>> {
  const stockLines = input.items.filter((line) => line.afectaStock && line.productoId);
  const stockSnaps = await Promise.all(
    stockLines.map((line) =>
      db.collection(`negocios/${businessId}/stock`).doc(line.productoId!).get()
    )
  );
  const stockNameById = new Map<string, string>();
  const stockCostById = new Map<string, number>();
  stockSnaps.forEach((snap, index) => {
    const line = stockLines[index];
    if (!snap.exists) {
      throw new Error(`PRODUCT_NOT_FOUND:${line.productoId}`);
    }
    stockNameById.set(
      line.productoId!,
      line.productoNombre || String(snap.data()?.nombre ?? 'Producto')
    );
    stockCostById.set(line.productoId!, Number(snap.data()?.costo) || 0);
  });

  return input.items.map((line) => {
    if (line.afectaStock && line.productoId) {
      const costoGuardado = stockCostById.get(line.productoId) ?? 0;
      const costoCompra = Number(line.costoUnitario) || 0;
      const cantidad = Number(line.cantidad) || 0;
      // Oferta solo si el costo de compra es menor al costo ya guardado.
      const esOfertaReal = line.enOferta && costoGuardado > 0 && costoCompra < costoGuardado;
      const ahorroOferta = esOfertaReal
        ? Math.round((costoGuardado - costoCompra) * cantidad * 100) / 100
        : 0;
      const descuentoOfertaPct = esOfertaReal
        ? Math.round((1 - costoCompra / costoGuardado) * 100 * 100) / 100
        : 0;
      return {
        ...line,
        productoNombre: stockNameById.get(line.productoId) ?? line.productoNombre,
        subtotal: line.importe,
        enOferta: esOfertaReal,
        descuentoOfertaPct,
        ahorroOferta,
      };
    }
    return { ...line, subtotal: line.importe };
  });
}

function totalsByAmbitoFromItems(items: ParsedPurchaseLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of items) {
    totals.set(
      line.ambito,
      Math.round(((totals.get(line.ambito) ?? 0) + line.importe) * 100) / 100
    );
  }
  return totals;
}

function stockLinesSignature(items: ParsedPurchaseLine[]): string {
  return items
    .filter((line) => line.afectaStock && line.productoId)
    .map(
      (line) =>
        `${line.productoId}|${line.cantidad}|${line.costoUnitario}|${line.importe}|${line.ambito}`
    )
    .sort()
    .join('\n');
}

function stockQuantitySignature(items: ParsedPurchaseLine[]): string {
  return items
    .filter((line) => line.afectaStock && line.productoId)
    .map((line) => `${line.productoId}|${line.cantidad}|${line.ambito}`)
    .sort()
    .join('\n');
}

/** Actualiza el costo del producto con el precio unitario de la compra (última factura). */
async function syncProductCostsFromPurchaseLines(
  businessId: string,
  lines: ParsedPurchaseLine[]
): Promise<void> {
  const costByProduct = new Map<string, number>();
  for (const line of stockLinesFromItems(lines)) {
    if (line.enOferta) continue;
    const costoUnitario = Number(line.costoUnitario) || 0;
    if (costoUnitario <= 0) continue;
    costByProduct.set(String(line.productoId).trim(), costoUnitario);
  }
  if (costByProduct.size === 0) return;

  const timestamp = new Date().toISOString();
  const batch = db.batch();
  let updates = 0;

  for (const [productoId, costoUnitario] of costByProduct) {
    const ref = db.collection(`negocios/${businessId}/stock`).doc(productoId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const currentCost = Number(snap.data()?.costo) || 0;
    if (currentCost === costoUnitario) continue;
    batch.update(ref, { costo: costoUnitario, updatedAt: timestamp });
    updates += 1;
  }

  if (updates > 0) {
    await batch.commit();
  }
}

function purchaseTotalsSignature(input: ParsedPurchaseInput): string {
  const totals = totalsByAmbitoFromItems(input.items);
  return JSON.stringify([...totals.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function payablesSignature(input: ParsedPurchaseInput): string {
  return JSON.stringify({
    medio: input.pago.medioPagoId,
    tarjeta: input.pago.tarjetaId ?? '',
    cuotas: input.pago.cuotas,
    fecha: input.pago.fechaPrimerVencimiento ?? '',
    totals: purchaseTotalsSignature(input),
  });
}

function purchasePaymentKind(
  medioPagoId: string,
  finanzas: FinanzasConfig
): 'payables' | 'cash' | 'none' {
  const medio = getMedioPagoById(finanzas.mediosPago, medioPagoId);
  if (!medio) return 'none';
  if (medioPagoGeneratesPayables(medio)) return 'payables';
  if (medioPagoGeneratesImmediateCash(medio)) return 'cash';
  return 'none';
}

function stockLinesFromItems(items: ParsedPurchaseLine[]): ParsedPurchaseLine[] {
  return items.filter((line) => line.afectaStock && line.productoId && (Number(line.cantidad) || 0) > 0);
}

async function purchaseHasCuotasForCompra(
  businessId: string,
  compraId: string
): Promise<boolean> {
  const snap = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('compraId', '==', compraId)
    .limit(1)
    .get();
  return !snap.empty;
}

async function applyPayablesForPurchase(
  businessId: string,
  compraId: string,
  compraLabel: string,
  input: ParsedPurchaseInput,
  finanzas: FinanzasConfig
): Promise<void> {
  const medio = getMedioPagoById(finanzas.mediosPago, input.pago.medioPagoId);
  if (!medio || !medioPagoGeneratesPayables(medio)) return;

  const tarjeta = input.pago.tarjetaId
    ? getTarjetaById(finanzas.tarjetas, input.pago.tarjetaId)
    : undefined;

  let created = 0;
  for (const [ambito, montoTotal] of totalsByAmbitoFromItems(input.items)) {
    if (montoTotal === 0) continue;
    const ambitoLines = input.items.filter((line) => line.ambito === ambito);
    const result = await syncPurchasePayablesForCompra(businessId, {
      compraId,
      compraLabel,
      proveedor: input.proveedor,
      tarjetaId: tarjeta?.id ?? input.pago.tarjetaId ?? '',
      tarjetaLabel: tarjeta?.label ?? input.proveedor,
      medioPagoId: input.pago.medioPagoId,
      ambito,
      montoTotal,
      cuotas: input.pago.cuotas,
      fechaPrimerVencimiento: input.pago.fechaPrimerVencimiento!,
      lineDescriptions: ambitoLines.map(
        (line) => line.descripcion || line.categoriaLabel || line.tipoLinea
      ),
    });
    created += result.cuotasCreated;
  }

  if (created === 0) {
    throw new Error(
      'No se generaron cuotas en Cuentas a pagar. Revisá que el medio «Genera cuentas a pagar» esté activo y que las líneas tengan importe.'
    );
  }
}

async function ensurePurchasePayablesFromDocument(
  businessId: string,
  compraId: string,
  compraLabel: string,
  input: ParsedPurchaseInput,
  finanzas: FinanzasConfig
): Promise<void> {
  if (esNotaCredito(input.tipoComprobante)) return;
  if (purchasePaymentKind(input.pago.medioPagoId, finanzas) !== 'payables') return;
  if (await purchaseHasCuotasForCompra(businessId, compraId)) return;
  await applyPayablesForPurchase(businessId, compraId, compraLabel, input, finanzas);
}

/** Regenera cuotas de Cuentas a pagar desde el documento de compra (si faltan). */
export async function repairPurchasePayables(
  businessId: string,
  compraId: string
): Promise<{ cuotasCreated: number }> {
  const ref = db.doc(`negocios/${businessId}/compras/${compraId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('PURCHASE_NOT_FOUND');
  }
  const existing = snap.data() ?? {};
  if (isPurchaseDraft(existing)) {
    throw new Error('NOT_CONFIRMED');
  }

  const finanzas = await loadFinanzasConfig(businessId);
  const parsed = await parsePurchaseInput(businessId, existing as Record<string, unknown>, {
    skipSupplierLookup: true,
    finanzas,
  });
  if (parsed.error || !parsed.input) {
    throw new Error(parsed.error ?? 'La compra guardada tiene datos inválidos.');
  }

  const compraLabel = resolvePurchaseLabel({ ...existing, id: compraId });
  const before = await purchaseHasCuotasForCompra(businessId, compraId);
  await ensurePurchasePayablesFromDocument(
    businessId,
    compraId,
    compraLabel,
    parsed.input,
    finanzas
  );

  const afterSnap = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('compraId', '==', compraId)
    .get();

  return {
    cuotasCreated: before ? 0 : afterSnap.size,
  };
}

function buildPurchaseDocumentFields(
  input: ParsedPurchaseInput,
  normalizedItems: Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>,
  extra: Record<string, unknown> = {}
) {
  return stripUndefinedDeep({
    proveedorId: input.proveedorId ?? null,
    proveedor: input.proveedor,
    notas: input.notas,
    numeroComprobante: input.numeroComprobante || null,
    tipoComprobante: input.tipoComprobante,
    fecha: `${input.fecha}T12:00:00.000Z`,
    items: normalizedItems,
    pago: input.pago,
    totalNegocio: input.totalNegocio,
    totalPersonal: input.totalPersonal,
    total: input.total,
    ahorroOfertaTotal:
      Math.round(
        normalizedItems.reduce((acc, line) => acc + (Number(line.ahorroOferta) || 0), 0) * 100
      ) / 100,
    negocioId: extra.negocioId,
    ...extra,
  });
}

type ApplyPurchaseSideEffectsOptions = {
  /** No bloquear la respuesta HTTP (reserva de pedidos en segundo plano). */
  deferAutoReserve?: boolean;
};

async function reserveStockForPurchaseProducts(
  businessId: string,
  normalizedItems: Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>
): Promise<void> {
  const productIds = normalizedItems
    .filter((line) => line.afectaStock && line.productoId)
    .map((line) => String(line.productoId).trim());
  await syncPendingOrdersAfterStockChange(businessId, productIds);
}

function scheduleReserveStockForPurchaseProducts(
  businessId: string,
  normalizedItems: Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>
): void {
  void reserveStockForPurchaseProducts(businessId, normalizedItems).catch((err) => {
    console.error('Error reservando stock tras compra:', err);
  });
}

async function applyPurchaseStockEntries(
  businessId: string,
  compraId: string,
  compraLabel: string,
  lines: Array<ParsedPurchaseLine & { subtotal?: number; productoNombre?: string }>,
  tipoComprobante: ComprobanteTipoId = 'factura'
): Promise<void> {
  const stockLines = stockLinesFromItems(lines);
  if (stockLines.length === 0) return;

  const esEntrada = comprobanteStockDireccion(tipoComprobante, 'compras') === 'entrada';
  const motivo = esEntrada
    ? `Compra #${compraLabel}`
    : `Nota de crédito compra #${compraLabel}`;

  const timestamp = new Date().toISOString();
  const snaps = await Promise.all(
    stockLines.map((line) =>
      db.collection(`negocios/${businessId}/stock`).doc(line.productoId!).get()
    )
  );

  const stockBatch = db.batch();
  const movementBatch = db.batch();

  stockLines.forEach((line, index) => {
    const snap = snaps[index];
    if (!snap.exists) return;
    const currentStock = Number(snap.data()?.stockActual) || 0;
    stockBatch.update(snap.ref, {
      stockActual: esEntrada
        ? currentStock + line.cantidad
        : Math.max(0, currentStock - line.cantidad),
      // El costo del producto solo se actualiza con ingresos reales (no devoluciones).
      ...(esEntrada && line.costoUnitario > 0 && !line.enOferta
        ? { costo: line.costoUnitario }
        : {}),
      updatedAt: timestamp,
    });
    const movementRef = db.collection(`negocios/${businessId}/movimientos_stock`).doc();
    movementBatch.set(movementRef, {
      productoId: line.productoId,
      tipo: esEntrada ? 'entrada' : 'salida',
      cantidad: line.cantidad,
      fecha: timestamp,
      motivo,
      origenId: compraId,
      origenTipo: esEntrada ? 'compra' : 'compra_nota_credito',
      origenGrupo: 'compra',
      compraId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  });

  await stockBatch.commit();
  await movementBatch.commit();
}

/** Ingreso de caja por devolución de dinero del proveedor (nota de crédito de compra). */
async function createCashIngresoForAmbitoTotals(
  businessId: string,
  totalsByAmbito: Map<string, number>,
  params: {
    concepto: string;
    medioPagoId: string;
    compraId: string;
    compraLabel: string;
  }
): Promise<void> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, params.medioPagoId);
  const medioLabel = medio?.label ?? params.medioPagoId;
  const timestamp = new Date().toISOString();

  for (const [ambito, monto] of totalsByAmbito) {
    if (monto <= 0) continue;
    await db.collection(`negocios/${businessId}/movimientos_caja`).add({
      tipo: 'ingreso',
      monto,
      concepto:
        totalsByAmbito.size > 1
          ? `${params.concepto} · ${ambito === getBusinessCashAmbitoId() ? 'Negocio' : ambito}`
          : params.concepto,
      medio: medioLabel,
      medioPagoId: params.medioPagoId,
      ambito: normalizeMovementAmbito(ambito, caja),
      fecha: timestamp,
      origenId: params.compraId,
      origenTipo: 'compra_nota_credito',
      origenGrupo: 'compra',
      compraId: params.compraId,
      compraLabel: params.compraLabel,
      negocioId: businessId,
    });
  }
}

async function applyPurchaseSideEffects(
  businessId: string,
  compraId: string,
  compraLabel: string,
  input: ParsedPurchaseInput,
  normalizedItems: Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>,
  options?: ApplyPurchaseSideEffectsOptions & { finanzas?: FinanzasConfig }
): Promise<void> {
  const finanzas = options?.finanzas ?? (await loadFinanzasConfig(businessId));
  const medio = getMedioPagoById(finanzas.mediosPago, input.pago.medioPagoId)!;
  const isNotaCredito = esNotaCredito(input.tipoComprobante);

  await applyPurchaseStockEntries(
    businessId,
    compraId,
    compraLabel,
    normalizedItems,
    input.tipoComprobante
  );
  scheduleStockMetricsRefresh(businessId);

  if (options?.deferAutoReserve) {
    scheduleReserveStockForPurchaseProducts(businessId, normalizedItems);
  } else {
    await reserveStockForPurchaseProducts(businessId, normalizedItems);
  }

  const totalsByAmbito = totalsByAmbitoFromItems(input.items);

  if (medioPagoGeneratesImmediateCash(medio)) {
    if (isNotaCredito) {
      // Devolución al negocio: el dinero vuelve a caja.
      await createCashIngresoForAmbitoTotals(businessId, totalsByAmbito, {
        concepto: `Nota de crédito compra #${compraLabel}${input.proveedor ? ` · ${input.proveedor}` : ''}`,
        medioPagoId: input.pago.medioPagoId,
        compraId,
        compraLabel,
      });
    } else {
      await createCashEgresoForAmbitoTotals(businessId, totalsByAmbito, {
        concepto: `Compra #${compraLabel}${input.proveedor ? ` · ${input.proveedor}` : ''}`,
        medioPagoId: input.pago.medioPagoId,
        origenId: compraId,
        origenTipo: 'compra',
        origenGrupo: 'compra',
        compraId,
        compraLabel,
      });
    }
  } else if (medioPagoGeneratesPayables(medio) && !isNotaCredito) {
    // Para notas de crédito en cuotas la reducción del saldo deudor se gestiona
    // manualmente por ahora (no se genera una nueva obligación a pagar).
    await applyPayablesForPurchase(businessId, compraId, compraLabel, input, finanzas);
  }
}

function normalizeDraftPurchaseItems(input: ParsedPurchaseInput) {
  return input.items.map((line) => ({
    ...line,
    productoNombre: line.productoNombre,
    subtotal: line.importe,
  }));
}

export async function persistPurchaseDraft(
  businessId: string,
  input: ParsedPurchaseInput
): Promise<{ id: string; compraLabel: string; draft: true }> {
  const normalizedItems = normalizeDraftPurchaseItems(input);
  const timestamp = new Date().toISOString();
  const docRef = await db.collection(`negocios/${businessId}/compras`).add(
    buildPurchaseDocumentFields(input, normalizedItems, {
      estado: 'borrador',
      negocioId: businessId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  );

  return { id: docRef.id, compraLabel: 'Borrador', draft: true };
}

export async function updatePurchaseDraft(
  businessId: string,
  compraId: string,
  input: ParsedPurchaseInput
): Promise<{ id: string; compraLabel: string; draft: true }> {
  const ref = db.doc(`negocios/${businessId}/compras/${compraId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('PURCHASE_NOT_FOUND');
  }
  if (!isPurchaseDraft(snap.data() ?? {})) {
    throw new Error('NOT_DRAFT');
  }

  const normalizedItems = normalizeDraftPurchaseItems(input);
  await ref.update(
    buildPurchaseDocumentFields(input, normalizedItems, {
      estado: 'borrador',
      negocioId: businessId,
      updatedAt: new Date().toISOString(),
    })
  );

  return { id: compraId, compraLabel: 'Borrador', draft: true };
}

export async function confirmPurchaseDraft(
  businessId: string,
  compraId: string
): Promise<{ id: string; compraLabel: string; numeroCompra: number }> {
  const ref = db.doc(`negocios/${businessId}/compras/${compraId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('PURCHASE_NOT_FOUND');
  }
  if (!isPurchaseDraft(snap.data() ?? {})) {
    throw new Error('NOT_DRAFT');
  }

  const parsed = await parsePurchaseInput(businessId, snap.data() as Record<string, unknown>);
  if (parsed.error || !parsed.input) {
    throw new Error(parsed.error ?? 'Datos de compra inválidos.');
  }

  const { numero: numeroCompra, label: compraLabel } = await allocatePurchaseNumber(businessId);
  const normalizedItems = await normalizePurchaseItems(businessId, parsed.input);

  await ref.update(
    buildPurchaseDocumentFields(parsed.input, normalizedItems, {
      numeroCompra,
      compraLabel,
      estado: 'recibida',
      negocioId: businessId,
      updatedAt: new Date().toISOString(),
    })
  );

  await applyPurchaseSideEffects(businessId, compraId, compraLabel, parsed.input, normalizedItems);
  await ensurePurchasePayablesFromDocument(
    businessId,
    compraId,
    compraLabel,
    parsed.input,
    await loadFinanzasConfig(businessId)
  );

  return { id: compraId, compraLabel, numeroCompra };
}

export async function persistPurchase(
  businessId: string,
  input: ParsedPurchaseInput
): Promise<{ id: string; compraLabel: string; numeroCompra: number }> {
  const { numero: numeroCompra, label: compraLabel } = await allocatePurchaseNumber(businessId);
  const normalizedItems = await normalizePurchaseItems(businessId, input);

  const docRef = await db.collection(`negocios/${businessId}/compras`).add(
    buildPurchaseDocumentFields(input, normalizedItems, {
      numeroCompra,
      compraLabel,
      estado: 'recibida',
      negocioId: businessId,
    })
  );

  const finanzas = await loadFinanzasConfig(businessId);
  await applyPurchaseSideEffects(businessId, docRef.id, compraLabel, input, normalizedItems, {
    finanzas,
  });
  await ensurePurchasePayablesFromDocument(
    businessId,
    docRef.id,
    compraLabel,
    input,
    finanzas
  );

  return { id: docRef.id, compraLabel, numeroCompra };
}

async function loadCajaConfig(businessId: string): Promise<Record<string, unknown>> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
}

async function validateCanReversePurchaseStock(
  businessId: string,
  items: ParsedPurchaseLine[]
): Promise<string | null> {
  const stockLines = stockLinesFromItems(items);
  if (stockLines.length === 0) return null;

  const snaps = await Promise.all(
    stockLines.map((line) =>
      db.collection(`negocios/${businessId}/stock`).doc(line.productoId!).get()
    )
  );

  for (let i = 0; i < stockLines.length; i++) {
    const line = stockLines[i];
    const itemSnap = snaps[i];
    const qty = Number(line.cantidad) || 0;
    if (!itemSnap.exists) {
      return `El producto "${line.productoNombre || line.productoId}" ya no existe en stock.`;
    }
    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    if (currentStock < qty) {
      const nombre = String(itemSnap.data()?.nombre ?? line.productoNombre ?? 'Producto');
      return `No hay stock suficiente de "${nombre}" para deshacer la compra (hay ${currentStock}, se necesitan ${qty}).`;
    }
  }
  return null;
}

async function reversePurchaseStockFromItems(
  businessId: string,
  compraId: string,
  compraLabel: string,
  items: ParsedPurchaseLine[]
): Promise<void> {
  const stockLines = stockLinesFromItems(items);
  if (stockLines.length === 0) return;

  const timestamp = new Date().toISOString();
  const snaps = await Promise.all(
    stockLines.map((line) =>
      db.collection(`negocios/${businessId}/stock`).doc(line.productoId!).get()
    )
  );

  const stockBatch = db.batch();
  const movementBatch = db.batch();

  stockLines.forEach((line, index) => {
    const snap = snaps[index];
    if (!snap.exists) return;
    const qty = Number(line.cantidad) || 0;
    const currentStock = Number(snap.data()?.stockActual) || 0;
    stockBatch.update(snap.ref, {
      stockActual: Math.max(0, currentStock - qty),
      updatedAt: timestamp,
    });
    const movementRef = db.collection(`negocios/${businessId}/movimientos_stock`).doc();
    movementBatch.set(movementRef, {
      productoId: line.productoId,
      tipo: 'salida',
      cantidad: qty,
      fecha: timestamp,
      motivo: `Ajuste compra #${compraLabel}`,
      origenId: compraId,
      origenTipo: 'compra_ajuste',
      origenGrupo: 'compra',
      compraId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  });

  await stockBatch.commit();
  await movementBatch.commit();
  scheduleStockMetricsRefresh(businessId);
}

/** Repone el stock que una nota de crédito de compra había sacado (devolución anulada). */
async function restorePurchaseStockFromNotaCredito(
  businessId: string,
  compraId: string,
  compraLabel: string,
  items: ParsedPurchaseLine[]
): Promise<void> {
  const stockLines = stockLinesFromItems(items);
  if (stockLines.length === 0) return;

  const timestamp = new Date().toISOString();
  const snaps = await Promise.all(
    stockLines.map((line) =>
      db.collection(`negocios/${businessId}/stock`).doc(line.productoId!).get()
    )
  );

  const stockBatch = db.batch();
  const movementBatch = db.batch();

  stockLines.forEach((line, index) => {
    const snap = snaps[index];
    if (!snap.exists) return;
    const qty = Number(line.cantidad) || 0;
    const currentStock = Number(snap.data()?.stockActual) || 0;
    stockBatch.update(snap.ref, {
      stockActual: currentStock + qty,
      updatedAt: timestamp,
    });
    const movementRef = db.collection(`negocios/${businessId}/movimientos_stock`).doc();
    movementBatch.set(movementRef, {
      productoId: line.productoId,
      tipo: 'entrada',
      cantidad: qty,
      fecha: timestamp,
      motivo: `Anulación nota de crédito compra #${compraLabel}`,
      origenId: compraId,
      origenTipo: 'compra_ajuste',
      origenGrupo: 'compra',
      compraId,
      usuarioId: 'admin',
      negocioId: businessId,
    });
  });

  await stockBatch.commit();
  await movementBatch.commit();
  scheduleStockMetricsRefresh(businessId);
}

/** Revierte los ingresos de caja generados por una nota de crédito de compra. */
async function reverseNotaCreditoCompraCash(
  businessId: string,
  compraId: string,
  compraLabel: string
): Promise<void> {
  const movimientosRef = db.collection(`negocios/${businessId}/movimientos_caja`);
  const ingresoSnap = await movimientosRef
    .where('compraId', '==', compraId)
    .where('tipo', '==', 'ingreso')
    .get();

  const caja = await loadCajaConfig(businessId);
  const timestamp = new Date().toISOString();
  const batch = db.batch();
  let writes = 0;

  for (const doc of ingresoSnap.docs) {
    const data = doc.data();
    if (String(data.origenTipo ?? '') !== 'compra_nota_credito') continue;
    batch.set(movimientosRef.doc(), {
      tipo: 'egreso',
      monto: Number(data.monto) || 0,
      concepto: `Anulación ${String(data.concepto ?? `Nota de crédito compra #${compraLabel}`).trim()}`,
      medio: data.medio ?? 'efectivo',
      medioPagoId: data.medioPagoId ?? null,
      ambito: resolveCashReversalAmbito(data.ambito, caja),
      fecha: timestamp,
      origenId: compraId,
      origenTipo: 'compra_ajuste',
      origenGrupo: 'compra',
      compraId,
      compraLabel,
      movimientoAnuladoId: doc.id,
      negocioId: businessId,
    });
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }
}

async function reversePurchaseCashMovements(
  businessId: string,
  compraId: string,
  compraLabel: string
): Promise<void> {
  const movimientosRef = db.collection(`negocios/${businessId}/movimientos_caja`);
  const [egresoSnap, ingresoSnap] = await Promise.all([
    movimientosRef.where('compraId', '==', compraId).where('tipo', '==', 'egreso').get(),
    movimientosRef.where('compraId', '==', compraId).where('tipo', '==', 'ingreso').get(),
  ]);

  const reversedIds = new Set<string>();
  for (const doc of ingresoSnap.docs) {
    const anulado = String(doc.data().movimientoAnuladoId ?? '').trim();
    if (anulado) reversedIds.add(anulado);
  }

  const caja = await loadCajaConfig(businessId);
  const timestamp = new Date().toISOString();
  const batch = db.batch();
  let writes = 0;

  for (const doc of egresoSnap.docs) {
    if (reversedIds.has(doc.id)) continue;
    const data = doc.data();
    batch.set(movimientosRef.doc(), {
      tipo: 'ingreso',
      monto: Number(data.monto) || 0,
      concepto: `Anulación ${String(data.concepto ?? `Compra #${compraLabel}`).trim()}`,
      medio: data.medio ?? 'efectivo',
      medioPagoId: data.medioPagoId ?? null,
      ambito: resolveCashReversalAmbito(data.ambito, caja),
      fecha: timestamp,
      origenId: compraId,
      origenTipo: 'compra_ajuste',
      origenGrupo: 'compra',
      compraId,
      compraLabel,
      movimientoAnuladoId: doc.id,
      negocioId: businessId,
    });
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }
}

async function removePurchasePayables(businessId: string, compraId: string): Promise<string | null> {
  const cuotasSnap = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('compraId', '==', compraId)
    .get();

  if (cuotasSnap.empty) return null;

  for (const doc of cuotasSnap.docs) {
    const data = doc.data();
    if (data.estado === 'pagada' || data.movimientoCajaId) {
      return 'No se puede editar: hay cuotas de esta compra ya pagadas en Cuentas a pagar.';
    }
  }

  const obligationIds = new Set<string>();
  const batch = db.batch();
  for (const doc of cuotasSnap.docs) {
    batch.delete(doc.ref);
    const obligacionId = String(doc.data().obligacionId ?? '').trim();
    if (obligacionId) obligationIds.add(obligacionId);
  }
  await batch.commit();

  if (obligationIds.size > 0) {
    const obligBatch = db.batch();
    for (const obligacionId of obligationIds) {
      obligBatch.delete(
        db.collection(`negocios/${businessId}/cuentas_pagar_obligaciones`).doc(obligacionId)
      );
    }
    await obligBatch.commit();
  }

  return null;
}

export async function updateConfirmedPurchase(
  businessId: string,
  compraId: string,
  input: ParsedPurchaseInput
): Promise<{ id: string; compraLabel: string; numeroCompra?: number }> {
  const ref = db.doc(`negocios/${businessId}/compras/${compraId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('PURCHASE_NOT_FOUND');
  }

  const existing = snap.data() ?? {};
  if (isPurchaseDraft(existing)) {
    throw new Error('NOT_CONFIRMED');
  }

  if (
    normalizeComprobanteTipo(existing.tipoComprobante) !== 'factura' ||
    esNotaCredito(input.tipoComprobante)
  ) {
    throw new Error(
      'Las notas de crédito/débito confirmadas no se pueden editar todavía. Eliminá y registrá una nueva.'
    );
  }

  const finanzas = await loadFinanzasConfig(businessId);
  const parsedOld = await parsePurchaseInput(businessId, existing as Record<string, unknown>, {
    skipSupplierLookup: true,
    finanzas,
  });
  if (parsedOld.error || !parsedOld.input) {
    throw new Error(parsedOld.error ?? 'La compra guardada tiene datos inválidos.');
  }

  const oldInput = parsedOld.input;
  const compraLabel = resolvePurchaseLabel({ ...existing, id: compraId });
  const numeroCompra = Number(existing.numeroCompra) || undefined;

  const stockChanged = stockLinesSignature(oldInput.items) !== stockLinesSignature(input.items);
  const stockQuantityChanged =
    stockQuantitySignature(oldInput.items) !== stockQuantitySignature(input.items);
  const costOnlyStockChange = stockChanged && !stockQuantityChanged;
  const oldPaymentKind = purchasePaymentKind(oldInput.pago.medioPagoId, finanzas);
  const newPaymentKind = purchasePaymentKind(input.pago.medioPagoId, finanzas);
  const paymentKindChanged = oldPaymentKind !== newPaymentKind;
  const payablesChanged = payablesSignature(oldInput) !== payablesSignature(input);

  const payablesStructureChanged =
    oldInput.pago.cuotas !== input.pago.cuotas ||
    (oldInput.pago.tarjetaId ?? '') !== (input.pago.tarjetaId ?? '') ||
    oldInput.pago.medioPagoId !== input.pago.medioPagoId ||
    (oldInput.pago.fechaPrimerVencimiento ?? '') !== (input.pago.fechaPrimerVencimiento ?? '');

  const oldTotals = totalsByAmbitoFromItems(oldInput.items);
  const newTotals = totalsByAmbitoFromItems(input.items);
  const payablesAmbitosChanged =
    [...oldTotals.keys()].sort().join('|') !== [...newTotals.keys()].sort().join('|');

  const mustRemovePayables =
    oldPaymentKind === 'payables' &&
    (paymentKindChanged ||
      newPaymentKind !== 'payables' ||
      payablesStructureChanged ||
      payablesAmbitosChanged);

  const hasExistingPayables = await purchaseHasCuotasForCompra(businessId, compraId);
  const mustApplyPayables =
    newPaymentKind === 'payables' && (payablesChanged || !hasExistingPayables);

  const totalsChanged = purchaseTotalsSignature(oldInput) !== purchaseTotalsSignature(input);
  const mustReverseCash = oldPaymentKind === 'cash' && (paymentKindChanged || totalsChanged);
  const mustApplyCash = newPaymentKind === 'cash' && (paymentKindChanged || totalsChanged);

  const documentOnlyChange =
    !stockChanged &&
    !mustRemovePayables &&
    !mustReverseCash &&
    !mustApplyCash &&
    !mustApplyPayables;

  if (documentOnlyChange) {
    const normalizedItems = input.items.map((line) => ({
      ...line,
      subtotal: line.importe,
      productoNombre: line.productoNombre,
    }));
    if (newPaymentKind === 'payables' && !hasExistingPayables) {
      await applyPayablesForPurchase(businessId, compraId, compraLabel, input, finanzas);
    }
    await ref.update(
      buildPurchaseDocumentFields(input, normalizedItems, {
        numeroCompra: numeroCompra ?? null,
        compraLabel,
        estado: String(existing.estado ?? 'recibida'),
        negocioId: businessId,
        updatedAt: new Date().toISOString(),
      })
    );
    return {
      id: compraId,
      compraLabel,
      ...(numeroCompra ? { numeroCompra } : {}),
    };
  }

  if (stockChanged && !costOnlyStockChange) {
    const stockError = await validateCanReversePurchaseStock(businessId, oldInput.items);
    if (stockError) {
      throw new Error(stockError);
    }
  }

  const reverseTasks: Promise<void>[] = [];
  if (mustRemovePayables) {
    reverseTasks.push(
      (async () => {
        const payablesError = await removePurchasePayables(businessId, compraId);
        if (payablesError) throw new Error(payablesError);
      })()
    );
  }
  if (mustReverseCash) {
    reverseTasks.push(reversePurchaseCashMovements(businessId, compraId, compraLabel));
  }
  if (stockChanged && !costOnlyStockChange) {
    reverseTasks.push(
      reversePurchaseStockFromItems(businessId, compraId, compraLabel, oldInput.items)
    );
  }
  if (reverseTasks.length > 0) {
    await Promise.all(reverseTasks);
  }

  const normalizedItems = await normalizePurchaseItems(businessId, input);

  await ref.update(
    buildPurchaseDocumentFields(input, normalizedItems, {
      numeroCompra: numeroCompra ?? null,
      compraLabel,
      estado: String(existing.estado ?? 'recibida'),
      negocioId: businessId,
      updatedAt: new Date().toISOString(),
    })
  );

  const applyTasks: Promise<void>[] = [];
  if (stockChanged && !costOnlyStockChange) {
    applyTasks.push(applyPurchaseStockEntries(businessId, compraId, compraLabel, normalizedItems));
  }
  if (costOnlyStockChange) {
    applyTasks.push(syncProductCostsFromPurchaseLines(businessId, normalizedItems));
  }
  if (mustApplyCash) {
    applyTasks.push(
      createCashEgresoForAmbitoTotals(businessId, newTotals, {
        concepto: `Compra #${compraLabel}${input.proveedor ? ` · ${input.proveedor}` : ''}`,
        medioPagoId: input.pago.medioPagoId,
        origenId: compraId,
        origenTipo: 'compra',
        origenGrupo: 'compra',
        compraId,
        compraLabel,
      })
    );
  }
  if (mustApplyPayables) {
    applyTasks.push(applyPayablesForPurchase(businessId, compraId, compraLabel, input, finanzas));
  }

  if (applyTasks.length > 0) {
    await Promise.all(applyTasks);
  }

  if (stockChanged && !costOnlyStockChange) {
    scheduleStockMetricsRefresh(businessId);
    scheduleReserveStockForPurchaseProducts(businessId, normalizedItems);
  } else if (costOnlyStockChange) {
    scheduleStockMetricsRefresh(businessId);
  }

  await ensurePurchasePayablesFromDocument(
    businessId,
    compraId,
    compraLabel,
    input,
    finanzas
  );

  return {
    id: compraId,
    compraLabel,
    ...(numeroCompra ? { numeroCompra } : {}),
  };
}

export async function deletePurchase(
  businessId: string,
  compraId: string
): Promise<{ id: string; compraLabel: string }> {
  const ref = db.doc(`negocios/${businessId}/compras/${compraId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('PURCHASE_NOT_FOUND');
  }

  const existing = snap.data() ?? {};
  const compraLabel = resolvePurchaseLabel({ ...existing, id: compraId });

  if (isPurchaseDraft(existing)) {
    await ref.delete();
    return { id: compraId, compraLabel: 'Borrador' };
  }

  const finanzas = await loadFinanzasConfig(businessId);
  const parsed = await parsePurchaseInput(businessId, existing as Record<string, unknown>, {
    skipSupplierLookup: true,
    finanzas,
  });
  if (parsed.error || !parsed.input) {
    throw new Error(parsed.error ?? 'La compra guardada tiene datos inválidos.');
  }

  const payablesError = await removePurchasePayables(businessId, compraId);
  if (payablesError) {
    throw new Error('PAID_INSTALLMENTS');
  }

  if (esNotaCredito(normalizeComprobanteTipo(existing.tipoComprobante))) {
    // La NC de compra sacó stock e ingresó dinero: al anularla reponemos ambos.
    await restorePurchaseStockFromNotaCredito(businessId, compraId, compraLabel, parsed.input.items);
    await reverseNotaCreditoCompraCash(businessId, compraId, compraLabel);
  } else {
    const stockError = await validateCanReversePurchaseStock(businessId, parsed.input.items);
    if (stockError) {
      throw new Error(stockError);
    }

    await reversePurchaseStockFromItems(businessId, compraId, compraLabel, parsed.input.items);
    await reversePurchaseCashMovements(businessId, compraId, compraLabel);
  }

  const productIds = parsed.input.items
    .filter((line) => line.afectaStock && line.productoId)
    .map((line) => String(line.productoId).trim());
  if (productIds.length > 0) {
    await syncPendingOrdersAfterStockChange(businessId, productIds);
  }

  await ref.delete();
  scheduleStockMetricsRefresh(businessId);

  return { id: compraId, compraLabel };
}
