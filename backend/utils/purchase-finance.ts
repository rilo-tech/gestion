import { db } from '../firebase.ts';
import { normalizeMovementAmbito } from './caja-ambitos.ts';
import { createCashEgresoForAmbitoTotals } from './cash-egreso.ts';
import { createPurchasePayables } from './card-statements.ts';
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
import { autoReserveIncomingStockForProduct } from './order-stock-reservations.ts';
import { allocatePurchaseNumber } from './purchase-number.ts';
import { scheduleStockMetricsRefresh } from './stock-metrics.ts';

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

export async function parsePurchaseInput(
  businessId: string,
  body: Record<string, unknown>,
  options?: { relaxed?: boolean }
): Promise<{ input?: ParsedPurchaseInput; error?: string }> {
  const finanzas = await loadFinanzasConfig(businessId);
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};

  const proveedorId = String(body.proveedorId ?? '').trim();
  let proveedor = String(body.proveedor ?? '').trim();
  if (proveedorId) {
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
    const costoUnitario = Math.max(0, Number(line.costoUnitario) || 0);
    let importe = Math.max(0, Number(line.importe) || 0);

    if (tipoLinea === 'stock') {
      if (!productoId) {
        return { error: 'Cada línea de stock debe tener un producto.' };
      }
      if (cantidad <= 0) {
        return { error: 'Cada línea de stock debe tener cantidad.' };
      }
      if (importe <= 0) importe = cantidad * costoUnitario;
    } else {
      if (!descripcion && categoria) descripcion = categoria.label;
      if (!descripcion) {
        return { error: 'Cada línea de gasto debe tener descripción o categoría.' };
      }
      if (importe <= 0) {
        return { error: `La línea "${descripcion}" debe tener importe.` };
      }
    }

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
  if (medioPagoRequiereCuentaHija(medio) && !tarjeta && !options?.relaxed) {
    return { error: 'Seleccioná la cuenta para este medio de pago.' };
  }
  if (tarjeta && tarjeta.medioPagoId !== medio.id) {
    return { error: 'La cuenta seleccionada no corresponde a este medio de pago.' };
  }

  const cuotas = Math.min(Math.max(1, Math.round(Number(pagoRaw.cuotas ?? body.cuotas) || 1)), 120);
  const fechaPrimerVencimiento = normalizeDate(
    pagoRaw.fechaPrimerVencimiento ?? body.fechaPrimerVencimiento
  );

  if (medioPagoGeneratesPayables(medio) && !fechaPrimerVencimiento && !options?.relaxed) {
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
      fecha: normalizeDate(body.fecha),
      items,
      pago: {
        medioPagoId,
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
  const normalizedItems = [];
  for (const line of input.items) {
    if (line.afectaStock && line.productoId) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        throw new Error(`PRODUCT_NOT_FOUND:${line.productoId}`);
      }
      const itemData = itemSnap.data() ?? {};
      normalizedItems.push({
        ...line,
        productoNombre: line.productoNombre || String(itemData.nombre ?? 'Producto'),
        subtotal: line.importe,
      });
    } else {
      normalizedItems.push({ ...line, subtotal: line.importe });
    }
  }
  return normalizedItems;
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
    fecha: `${input.fecha}T12:00:00.000Z`,
    items: normalizedItems,
    pago: input.pago,
    totalNegocio: input.totalNegocio,
    totalPersonal: input.totalPersonal,
    total: input.total,
    negocioId: extra.negocioId,
    ...extra,
  });
}

async function applyPurchaseSideEffects(
  businessId: string,
  compraId: string,
  compraLabel: string,
  input: ParsedPurchaseInput,
  normalizedItems: Array<ParsedPurchaseLine & { subtotal: number; productoNombre?: string }>
): Promise<void> {
  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, input.pago.medioPagoId)!;
  const tarjeta = input.pago.tarjetaId
    ? getTarjetaById(finanzas.tarjetas, input.pago.tarjetaId)
    : undefined;
  const timestamp = new Date().toISOString();

  for (const line of normalizedItems) {
    if (!line.afectaStock || !line.productoId) continue;
    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.productoId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    await itemRef.update({
      stockActual: currentStock + line.cantidad,
      ...(line.costoUnitario > 0 ? { costo: line.costoUnitario } : {}),
      updatedAt: timestamp,
    });

    await db.collection(`negocios/${businessId}/movimientos_stock`).add({
      productoId: line.productoId,
      tipo: 'entrada',
      cantidad: line.cantidad,
      fecha: timestamp,
      motivo: `Compra #${compraLabel}`,
      origenId: compraId,
      origenTipo: 'compra',
      origenGrupo: 'compra',
      compraId,
      usuarioId: 'admin',
      negocioId: businessId,
    });

    await autoReserveIncomingStockForProduct(businessId, line.productoId);
  }

  scheduleStockMetricsRefresh(businessId);

  const totalsByAmbito = new Map<string, number>();
  for (const line of input.items) {
    totalsByAmbito.set(
      line.ambito,
      Math.round(((totalsByAmbito.get(line.ambito) ?? 0) + line.importe) * 100) / 100
    );
  }

  if (medioPagoGeneratesImmediateCash(medio)) {
    await createCashEgresoForAmbitoTotals(businessId, totalsByAmbito, {
      concepto: `Compra #${compraLabel}${input.proveedor ? ` · ${input.proveedor}` : ''}`,
      medioPagoId: input.pago.medioPagoId,
      origenId: compraId,
      origenTipo: 'compra',
      origenGrupo: 'compra',
      compraId,
      compraLabel,
    });
  } else if (medioPagoGeneratesPayables(medio)) {
    for (const [ambito, montoTotal] of totalsByAmbito) {
      if (montoTotal <= 0) continue;
      const ambitoLines = input.items.filter((line) => line.ambito === ambito);
      await createPurchasePayables(businessId, {
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
    }
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

  await applyPurchaseSideEffects(businessId, docRef.id, compraLabel, input, normalizedItems);

  return { id: docRef.id, compraLabel, numeroCompra };
}
