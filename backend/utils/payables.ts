import { db } from '../firebase.ts';
import type { QuerySnapshot } from 'firebase-admin/firestore';
import { createCashEgreso } from './cash-egreso.ts';
import {
  getCategoriaGastoById,
  getMedioPagoById,
  getTarjetaById,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
} from './finance-config.ts';

export type PayableTipo = 'unico' | 'mensual';
export type PayableCuotaEstado = 'pendiente' | 'pagada';
export type PayableDisplayEstado = PayableCuotaEstado | 'vencida';

export interface PayableObligationRecord {
  id: string;
  beneficiario: string;
  monto: number;
  tipo: PayableTipo;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  activo: boolean;
  ambito?: string;
  notas?: string;
  categoriaId?: string;
  categoriaLabel?: string;
  origenTipo?: string;
  compraId?: string;
  compraLabel?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
  medioPagoId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PayableCuotaRecord {
  id: string;
  obligacionId: string;
  beneficiario: string;
  numeroCuota: number;
  fechaVencimiento: string;
  monto: number;
  estado: PayableCuotaEstado;
  fechaPago?: string;
  tipo: PayableTipo;
  ambito?: string;
  origenTipo?: string;
  compraId?: string;
  compraLabel?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
  medioPagoId?: string;
  cuotaTotal?: number;
  descripcion?: string;
  movimientoCajaId?: string;
  createdAt?: string;
}

export interface CreatePayableObligationInput {
  beneficiario: string;
  monto: number;
  tipo: PayableTipo;
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  ambito?: string;
  notas?: string;
  categoriaId?: string;
  categoriaLabel?: string;
  origenTipo?: string;
  compraId?: string;
  compraLabel?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
  medioPagoId?: string;
  cuotaTotal?: number;
  descripcionBase?: string;
}

const MENSUAL_HORIZON_MONTHS = 12;

function obligationsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/cuentas_pagar_obligaciones`);
}

function cuotasCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function addMonths(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resolveDisplayEstado(
  estado: PayableCuotaEstado,
  fechaVencimiento: string,
  referenceDate = todayIso()
): PayableDisplayEstado {
  if (estado === 'pagada') return 'pagada';
  if (fechaVencimiento < referenceDate) return 'vencida';
  return 'pendiente';
}

export function parseCreatePayableInput(raw: unknown): CreatePayableObligationInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const beneficiario = String(data.beneficiario ?? '').trim();
  const monto = Number(data.monto) || 0;
  const tipo: PayableTipo = data.tipo === 'mensual' ? 'mensual' : 'unico';
  const cantidadCuotas = Math.min(Math.max(1, Math.round(Number(data.cantidadCuotas) || 1)), 120);
  const fechaPrimerVencimiento = normalizeDate(data.fechaPrimerVencimiento);
  const notas = String(data.notas ?? '').trim();

  if (!beneficiario || monto === 0 || !fechaPrimerVencimiento) return null;

  const categoriaId = String(data.categoriaId ?? '').trim() || undefined;
  const origenRaw = String(data.origenTipo ?? '').trim().toLowerCase();
  const origenTipo =
    origenRaw === 'prestamo' ||
    origenRaw === 'compra' ||
    origenRaw === 'tarjeta' ||
    origenRaw === 'manual'
      ? origenRaw
      : undefined;

  const medioPagoId = String(data.medioPagoId ?? '').trim().toLowerCase() || undefined;
  const tarjetaId = String(data.tarjetaId ?? '').trim() || undefined;
  const tarjetaLabel = String(data.tarjetaLabel ?? '').trim() || undefined;

  return {
    beneficiario,
    monto,
    tipo: origenTipo === 'prestamo' ? 'unico' : tipo,
    cantidadCuotas:
      origenTipo === 'prestamo'
        ? cantidadCuotas
        : tipo === 'unico'
          ? cantidadCuotas
          : Math.max(cantidadCuotas, 1),
    fechaPrimerVencimiento,
    ambito: data.ambito ? String(data.ambito).trim().toLowerCase() : undefined,
    notas: notas || undefined,
    categoriaId,
    origenTipo,
    medioPagoId,
    tarjetaId,
    tarjetaLabel,
  };
}

function payableMedioGeneratesImmediateSinglePayment(
  medio: ReturnType<typeof getMedioPagoById>
): boolean {
  if (!medio || medio.activo === false) return false;
  return medioPagoGeneratesImmediateCash(medio) && !medioPagoGeneratesPayables(medio);
}

async function reconcilePendingInstallmentPayments(
  businessId: string
): Promise<number> {
  const snapshot = await cuotasCollection(businessId).where('estado', '==', 'pendiente').get();
  if (snapshot.empty) return 0;

  const pendingDocs = snapshot.docs;
  const linkedByCuotaId = new Map<
    string,
    { movId: string; fecha?: string; medioPagoId?: string }
  >();

  for (let index = 0; index < pendingDocs.length; index += 10) {
    const chunk = pendingDocs.slice(index, index + 10).map((doc) => doc.id);
    const movSnap = await db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .where('origenId', 'in', chunk)
      .where('origenTipo', '==', 'cuenta_pagar')
      .get();

    for (const movDoc of movSnap.docs) {
      const origenId = String(movDoc.data().origenId ?? '').trim();
      if (!origenId || linkedByCuotaId.has(origenId)) continue;
      linkedByCuotaId.set(origenId, {
        movId: movDoc.id,
        fecha: movDoc.data().fecha ? String(movDoc.data().fecha) : undefined,
        medioPagoId: movDoc.data().medioPagoId
          ? String(movDoc.data().medioPagoId).trim().toLowerCase()
          : undefined,
      });
    }
  }

  const batch = db.batch();
  let writes = 0;
  const now = new Date().toISOString();

  for (const doc of pendingDocs) {
    const data = doc.data();
    const movimientoCajaId = data.movimientoCajaId ? String(data.movimientoCajaId).trim() : '';
    const linked = linkedByCuotaId.get(doc.id);

    if (movimientoCajaId) {
      batch.update(doc.ref, {
        estado: 'pagada',
        fechaPago: data.fechaPago ?? now,
      });
      writes += 1;
      continue;
    }

    if (!linked) continue;

    batch.update(doc.ref, {
      estado: 'pagada',
      fechaPago: linked.fecha ?? now,
      movimientoCajaId: linked.movId,
      ...(linked.medioPagoId ? { medioPagoId: linked.medioPagoId } : {}),
    });
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
  }
  return writes;
}

async function autoPayImmediateCashCuotas(
  businessId: string,
  obligacionId: string,
  input: CreatePayableObligationInput
): Promise<void> {
  if (input.tipo !== 'unico' || !input.medioPagoId || input.cantidadCuotas > 1) return;

  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, input.medioPagoId);
  if (!payableMedioGeneratesImmediateSinglePayment(medio)) return;

  const cuotasSnap = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligacionId)
    .get();

  for (const doc of cuotasSnap.docs) {
    await setPayableInstallmentPaid(businessId, doc.id, true, {
      medioPagoId: input.medioPagoId,
    });
  }
}

function payableMedioRequiereCuenta(medio: ReturnType<typeof getMedioPagoById>): boolean {
  if (!medio || !medioPagoRequiereCuentaHija(medio)) return false;
  if (medioPagoGeneratesImmediateCash(medio) && !medioPagoGeneratesPayables(medio)) {
    return false;
  }
  return true;
}

function applyManualPaymentToInput(
  input: CreatePayableObligationInput,
  finanzas: Awaited<ReturnType<typeof loadFinanzasConfig>>
): void {
  if (input.origenTipo === 'compra' || input.origenTipo === 'prestamo') return;
  if (input.tipo !== 'unico') return;

  const medioId = String(input.medioPagoId ?? '').trim().toLowerCase();
  if (!medioId) return;

  const medio = getMedioPagoById(finanzas.mediosPago, medioId);
  if (!medio || medio.activo === false) {
    throw new Error('MEDIO_PAGO_INVALID');
  }

  if (payableMedioRequiereCuenta(medio)) {
    const tarjetaId = String(input.tarjetaId ?? '').trim();
    if (!tarjetaId) throw new Error('TARJETA_REQUIRED');
    const tarjeta = getTarjetaById(finanzas.tarjetas, tarjetaId);
    if (!tarjeta || tarjeta.activo === false) throw new Error('TARJETA_NOT_FOUND');
    input.tarjetaId = tarjeta.id;
    input.tarjetaLabel = String(input.tarjetaLabel ?? '').trim() || tarjeta.label;
  }

  if (!medioPagoGeneratesPayables(medio)) return;
  if (medioPagoGeneratesImmediateCash(medio) && !medioPagoRequiereCuentaHija(medio)) {
    return;
  }

  const cuotas = Math.min(Math.max(1, Math.round(input.cantidadCuotas) || 1), 120);
  const total = input.monto;
  input.monto = Math.round((total / cuotas) * 100) / 100;
  input.cuotaTotal = cuotas;
  input.cantidadCuotas = cuotas;
  if (!input.origenTipo || input.origenTipo === 'manual') {
    input.origenTipo = input.tarjetaId ? 'tarjeta' : 'manual';
  }
}

function mapObligation(id: string, data: Record<string, unknown>): PayableObligationRecord {
  return {
    id,
    beneficiario: String(data.beneficiario ?? '').trim(),
    monto: Number(data.monto) || 0,
    tipo: data.tipo === 'mensual' ? 'mensual' : 'unico',
    cantidadCuotas: Math.max(1, Number(data.cantidadCuotas) || 1),
    fechaPrimerVencimiento: normalizeDate(data.fechaPrimerVencimiento) ?? todayIso(),
    activo: data.activo !== false,
    ambito: data.ambito ? String(data.ambito).trim().toLowerCase() : undefined,
    notas: data.notas ? String(data.notas).trim() : undefined,
    categoriaId: data.categoriaId ? String(data.categoriaId).trim() : undefined,
    categoriaLabel: data.categoriaLabel ? String(data.categoriaLabel).trim() : undefined,
    origenTipo: data.origenTipo ? String(data.origenTipo).trim() : undefined,
    compraId: data.compraId ? String(data.compraId).trim() : undefined,
    compraLabel: data.compraLabel ? String(data.compraLabel).trim() : undefined,
    tarjetaId: data.tarjetaId ? String(data.tarjetaId).trim() : undefined,
    tarjetaLabel: data.tarjetaLabel ? String(data.tarjetaLabel).trim() : undefined,
    medioPagoId: data.medioPagoId ? String(data.medioPagoId).trim().toLowerCase() : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
}

function mapCuota(id: string, data: Record<string, unknown>): PayableCuotaRecord {
  return {
    id,
    obligacionId: String(data.obligacionId ?? '').trim(),
    beneficiario: String(data.beneficiario ?? '').trim(),
    numeroCuota: Math.max(1, Number(data.numeroCuota) || 1),
    fechaVencimiento: normalizeDate(data.fechaVencimiento) ?? todayIso(),
    monto: Number(data.monto) || 0,
    estado: data.estado === 'pagada' ? 'pagada' : 'pendiente',
    fechaPago: data.fechaPago ? String(data.fechaPago) : undefined,
    tipo: data.tipo === 'mensual' ? 'mensual' : 'unico',
    ambito: data.ambito ? String(data.ambito).trim().toLowerCase() : undefined,
    origenTipo: data.origenTipo ? String(data.origenTipo).trim() : undefined,
    compraId: data.compraId ? String(data.compraId).trim() : undefined,
    compraLabel: data.compraLabel ? String(data.compraLabel).trim() : undefined,
    tarjetaId: data.tarjetaId ? String(data.tarjetaId).trim() : undefined,
    tarjetaLabel: data.tarjetaLabel ? String(data.tarjetaLabel).trim() : undefined,
    medioPagoId: data.medioPagoId ? String(data.medioPagoId).trim().toLowerCase() : undefined,
    cuotaTotal: data.cuotaTotal ? Math.max(1, Number(data.cuotaTotal) || 1) : undefined,
    descripcion: data.descripcion ? String(data.descripcion).trim() : undefined,
    movimientoCajaId: data.movimientoCajaId ? String(data.movimientoCajaId).trim() : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
  };
}

function buildInitialCuotas(
  obligation: CreatePayableObligationInput
): Array<Omit<PayableCuotaRecord, 'id'>> {
  const count =
    obligation.tipo === 'unico'
      ? obligation.cantidadCuotas
      : Math.max(obligation.cantidadCuotas, MENSUAL_HORIZON_MONTHS);

  const cuotas: Array<Omit<PayableCuotaRecord, 'id'>> = [];
  for (let i = 0; i < count; i++) {
    cuotas.push({
      obligacionId: '',
      beneficiario: obligation.beneficiario,
      numeroCuota: i + 1,
      fechaVencimiento: addMonths(obligation.fechaPrimerVencimiento, i),
      monto: obligation.monto,
      estado: 'pendiente',
      tipo: obligation.tipo,
      ambito: obligation.ambito,
    });
  }
  return cuotas;
}

function buildCuotaDescripcion(
  cuota: { numeroCuota: number; fechaVencimiento: string },
  input: CreatePayableObligationInput,
  cuotaTotal: number,
  categoriaLabel?: string
): string {
  const descripcionBase = input.descripcionBase ?? input.beneficiario;
  if (input.origenTipo === 'compra' && input.compraLabel) {
    return `Cuota ${cuota.numeroCuota}/${cuotaTotal} · Compra #${input.compraLabel} · ${descripcionBase}${input.tarjetaLabel ? ` · ${input.tarjetaLabel}` : ''}`;
  }
  if (input.origenTipo === 'prestamo') {
    return `Préstamo · ${input.beneficiario} · Cuota ${cuota.numeroCuota}/${cuotaTotal}`;
  }
  if (input.origenTipo === 'tarjeta' && input.tarjetaLabel) {
    if (cuotaTotal > 1) {
      return `${descripcionBase} · Cuota ${cuota.numeroCuota}/${cuotaTotal} · ${input.tarjetaLabel}`;
    }
    return `${descripcionBase} · ${input.tarjetaLabel}`;
  }
  if (input.tipo === 'unico' && cuotaTotal > 1) {
    return `${input.beneficiario}${categoriaLabel ? ` · ${categoriaLabel}` : ''} · Cuota ${cuota.numeroCuota}/${cuotaTotal}`;
  }
  return `${input.beneficiario}${categoriaLabel ? ` · ${categoriaLabel}` : ''}${input.tipo === 'mensual' ? ` · ${cuota.fechaVencimiento.slice(0, 7)}` : ''}`;
}

async function getLatestCuotaNumber(
  businessId: string,
  obligacionId: string
): Promise<number> {
  const snapshot = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligacionId)
    .get();

  return snapshot.docs.reduce((max, doc) => {
    const numero = Number(doc.data().numeroCuota) || 0;
    return Math.max(max, numero);
  }, 0);
}

async function getLatestCuotaDate(
  businessId: string,
  obligacionId: string
): Promise<string | null> {
  const snapshot = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligacionId)
    .get();

  let latest: string | null = null;
  for (const doc of snapshot.docs) {
    const fecha = normalizeDate(doc.data().fechaVencimiento);
    if (!fecha) continue;
    if (!latest || fecha > latest) latest = fecha;
  }
  return latest;
}

export async function ensureMensualCuotasHorizon(businessId: string): Promise<void> {
  const snapshot = await obligationsCollection(businessId).get();

  const mensualActivas = snapshot.docs
    .map((doc) => mapObligation(doc.id, doc.data() as Record<string, unknown>))
    .filter((obligation) => obligation.tipo === 'mensual' && obligation.activo);

  if (mensualActivas.length === 0) return;

  const targetDate = addMonths(todayIso(), MENSUAL_HORIZON_MONTHS);
  const batch = db.batch();
  let writes = 0;

  for (const doc of snapshot.docs) {
    const obligation = mapObligation(doc.id, doc.data() as Record<string, unknown>);
    if (obligation.tipo !== 'mensual' || !obligation.activo) continue;
    let latestDate =
      (await getLatestCuotaDate(businessId, obligation.id)) ??
      obligation.fechaPrimerVencimiento;
    let numero = await getLatestCuotaNumber(businessId, obligation.id);

    while (latestDate < targetDate && writes < 400) {
      numero += 1;
      latestDate = addMonths(latestDate, 1);
      const ref = cuotasCollection(businessId).doc();
      batch.set(ref, {
        obligacionId: obligation.id,
        beneficiario: obligation.beneficiario,
        numeroCuota: numero,
        fechaVencimiento: latestDate,
        monto: obligation.monto,
        estado: 'pendiente',
        tipo: 'mensual',
        ambito: obligation.ambito ?? '',
        origenTipo: obligation.origenTipo ?? 'manual',
        descripcion: `${obligation.beneficiario}${obligation.categoriaLabel ? ` · ${obligation.categoriaLabel}` : ''} · ${latestDate.slice(0, 7)}`,
        createdAt: new Date().toISOString(),
      });
      writes += 1;
    }
  }

  if (writes > 0) {
    await batch.commit();
  }
}

export async function listPayableObligations(
  businessId: string
): Promise<PayableObligationRecord[]> {
  const snapshot = await obligationsCollection(businessId).orderBy('beneficiario').get();
  return snapshot.docs.map((doc) => mapObligation(doc.id, doc.data() as Record<string, unknown>));
}

export async function getPayableObligation(
  businessId: string,
  obligacionId: string
): Promise<PayableObligationRecord> {
  const ref = obligationsCollection(businessId).doc(obligacionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('OBLIGATION_NOT_FOUND');
  }
  return mapObligation(snap.id, snap.data() as Record<string, unknown>);
}

function installmentEstadoSortOrder(estado: PayableDisplayEstado): number {
  switch (estado) {
    case 'vencida':
      return 0;
    case 'pendiente':
      return 1;
    case 'pagada':
      return 2;
    default:
      return 3;
  }
}

function compareInstallmentsByDueDate(
  a: PayableCuotaRecord & { displayEstado: PayableDisplayEstado },
  b: PayableCuotaRecord & { displayEstado: PayableDisplayEstado }
): number {
  const statusCmp =
    installmentEstadoSortOrder(a.displayEstado) - installmentEstadoSortOrder(b.displayEstado);
  if (statusCmp !== 0) return statusCmp;

  const dateA = a.fechaVencimiento?.slice(0, 10) || '';
  const dateB = b.fechaVencimiento?.slice(0, 10) || '';
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  return a.beneficiario.localeCompare(b.beneficiario, 'es');
}

export async function listPayableInstallments(
  businessId: string
): Promise<Array<PayableCuotaRecord & { displayEstado: PayableDisplayEstado }>> {
  await ensureMensualCuotasHorizon(businessId);
  await reconcilePayablesAndCashData(businessId);
  await reconcilePendingInstallmentPayments(businessId);

  const snapshot = await cuotasCollection(businessId).orderBy('fechaVencimiento').get();
  return snapshot.docs
    .map((doc) => {
      const cuota = mapCuota(doc.id, doc.data() as Record<string, unknown>);
      return {
        ...cuota,
        displayEstado: resolveDisplayEstado(cuota.estado, cuota.fechaVencimiento),
      };
    })
    .sort(compareInstallmentsByDueDate);
}

export async function createPayableObligation(
  businessId: string,
  input: CreatePayableObligationInput
): Promise<{ obligation: PayableObligationRecord; cuotasCreated: number }> {
  const finanzas = await loadFinanzasConfig(businessId);
  const categoria = input.categoriaId
    ? getCategoriaGastoById(finanzas.categoriasGasto, input.categoriaId)
    : undefined;
  const categoriaLabel = input.categoriaLabel ?? categoria?.label;
  const categoriaId = categoria?.id ?? input.categoriaId;

  applyManualPaymentToInput(input, finanzas);

  const now = new Date().toISOString();
  const obligationRef = await obligationsCollection(businessId).add({
    beneficiario: input.beneficiario,
    monto: input.monto,
    tipo: input.tipo,
    cantidadCuotas: input.cantidadCuotas,
    fechaPrimerVencimiento: input.fechaPrimerVencimiento,
    activo: input.tipo === 'mensual',
    ambito: input.ambito ?? '',
    notas: input.notas ?? '',
    categoriaId: categoriaId ?? null,
    categoriaLabel: categoriaLabel ?? null,
    origenTipo: input.origenTipo ?? 'manual',
    compraId: input.compraId ?? null,
    compraLabel: input.compraLabel ?? null,
    tarjetaId: input.tarjetaId ?? null,
    tarjetaLabel: input.tarjetaLabel ?? null,
    medioPagoId: input.medioPagoId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const cuotaTotal = input.cuotaTotal ?? input.cantidadCuotas;

  const initialCuotas = buildInitialCuotas(input).map((cuota) => ({
    ...cuota,
    obligacionId: obligationRef.id,
    origenTipo: input.origenTipo ?? 'manual',
    compraId: input.compraId ?? null,
    compraLabel: input.compraLabel ?? null,
    tarjetaId: input.tarjetaId ?? null,
    tarjetaLabel: input.tarjetaLabel ?? null,
    medioPagoId: input.medioPagoId ?? null,
    cuotaTotal,
    descripcion: buildCuotaDescripcion(cuota, input, cuotaTotal, categoriaLabel),
    createdAt: now,
  }));

  const batch = db.batch();
  for (const cuota of initialCuotas) {
    batch.set(cuotasCollection(businessId).doc(), cuota);
  }
  await batch.commit();

  await autoPayImmediateCashCuotas(businessId, obligationRef.id, input);

  const obligationDoc = await obligationRef.get();
  return {
    obligation: mapObligation(obligationDoc.id, obligationDoc.data() as Record<string, unknown>),
    cuotasCreated: initialCuotas.length,
  };
}

export async function setPayableInstallmentPaid(
  businessId: string,
  cuotaId: string,
  paid: boolean,
  options?: { medioPagoId?: string; montoPago?: number; concepto?: string }
): Promise<PayableCuotaRecord & { displayEstado: PayableDisplayEstado }> {
  const ref = cuotasCollection(businessId).doc(cuotaId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('CUOTA_NOT_FOUND');
  }

  const before = mapCuota(snap.id, snap.data() as Record<string, unknown>);
  let movimientoCajaId = before.movimientoCajaId;
  let medioPagoId = before.medioPagoId;

  // Monto y detalle del pago: editables desde el popup, con fallback a lo guardado.
  const montoOverride =
    paid && typeof options?.montoPago === 'number' && Number.isFinite(options.montoPago) && options.montoPago > 0
      ? Math.round(options.montoPago * 100) / 100
      : null;
  const montoPago = montoOverride ?? before.monto;

  const isPaidAmountCorrection =
    before.estado === 'pagada' &&
    paid &&
    montoOverride !== null &&
    !before.tarjetaId &&
    !before.compraId &&
    before.tipo !== 'mensual';

  if (paid && montoOverride !== null && !isPaidAmountCorrection) {
    const isTarjetaCuota = !!(before.tarjetaId || before.compraId);
    const isMensualRecurrente = before.tipo === 'mensual';
    if (isTarjetaCuota && Math.abs(montoOverride - before.monto) > 0.009) {
      throw new Error('CUOTA_MONTO_FIJO');
    }
    if (
      !isMensualRecurrente &&
      !isTarjetaCuota &&
      (before.cuotaTotal ?? 1) > 1 &&
      Math.abs(montoOverride - before.monto) > 0.009
    ) {
      throw new Error('CUOTA_MONTO_FIJO');
    }
  }

  const conceptoOverride = paid ? String(options?.concepto ?? '').trim() : '';
  const concepto =
    conceptoOverride ||
    before.beneficiario ||
    before.descripcion ||
    'Cuenta a pagar';

  if (paid && !movimientoCajaId && options?.medioPagoId) {
    const finanzas = await loadFinanzasConfig(businessId);
    const medio = getMedioPagoById(finanzas.mediosPago, options.medioPagoId);
    if (!medio || !medioPagoGeneratesImmediateCash(medio)) {
      throw new Error('MEDIO_PAGO_INVALID');
    }

    movimientoCajaId = await createCashEgreso(businessId, {
      monto: montoPago,
      concepto,
      medioPagoId: options.medioPagoId,
      ambito: before.ambito ?? 'negocio',
      origenId: cuotaId,
      origenTipo: 'cuenta_pagar',
      origenGrupo: before.origenTipo === 'compra' ? 'compra' : 'manual',
      compraId: before.compraId,
      compraLabel: before.compraLabel,
    });
    medioPagoId = options.medioPagoId;
  }

  await ref.update({
    estado: paid ? 'pagada' : 'pendiente',
    fechaPago: paid ? new Date().toISOString() : null,
    movimientoCajaId: paid ? movimientoCajaId ?? null : before.movimientoCajaId ?? null,
    medioPagoId: paid ? medioPagoId ?? null : before.medioPagoId ?? null,
    ...(paid && montoOverride !== null ? { monto: montoOverride } : {}),
    ...(paid && conceptoOverride ? { descripcion: conceptoOverride } : {}),
  });

  if (paid && movimientoCajaId) {
    await syncCashMovementMonto(businessId, movimientoCajaId, montoPago);
  }

  const updated = await ref.get();
  const cuota = mapCuota(updated.id, updated.data() as Record<string, unknown>);
  return {
    ...cuota,
    displayEstado: resolveDisplayEstado(cuota.estado, cuota.fechaVencimiento),
  };
}

export async function setPayableObligationActive(
  businessId: string,
  obligacionId: string,
  activo: boolean
): Promise<PayableObligationRecord> {
  const ref = obligationsCollection(businessId).doc(obligacionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('OBLIGATION_NOT_FOUND');
  }

  await ref.update({
    activo,
    updatedAt: new Date().toISOString(),
  });

  if (activo) {
    await ensureMensualCuotasHorizon(businessId);
  }

  const updated = await ref.get();
  return mapObligation(updated.id, updated.data() as Record<string, unknown>);
}

export async function updatePayableObligation(
  businessId: string,
  obligacionId: string,
  input: CreatePayableObligationInput
): Promise<{ obligation: PayableObligationRecord; cuotasCreated: number }> {
  const ref = obligationsCollection(businessId).doc(obligacionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('OBLIGATION_NOT_FOUND');
  }

  const existing = mapObligation(snap.id, snap.data() as Record<string, unknown>);
  if (existing.origenTipo === 'compra') {
    throw new Error('OBLIGATION_NOT_EDITABLE');
  }

  const cuotasSnap = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligacionId)
    .get();

  const hasPaidCuotas = cuotasSnap.docs.some((doc) => doc.data().estado === 'pagada');
  if (hasPaidCuotas) {
    return updatePayableObligationPreservingPaid(
      businessId,
      obligacionId,
      input,
      existing,
      cuotasSnap
    );
  }

  const finanzas = await loadFinanzasConfig(businessId);
  const categoria = input.categoriaId
    ? getCategoriaGastoById(finanzas.categoriasGasto, input.categoriaId)
    : undefined;
  const categoriaLabel = input.categoriaLabel ?? categoria?.label;
  const categoriaId = categoria?.id ?? input.categoriaId;

  if (!input.origenTipo) {
    input.origenTipo = existing.origenTipo ?? 'manual';
  }
  applyManualPaymentToInput(input, finanzas);

  const now = new Date().toISOString();
  const cuotaTotal = input.cuotaTotal ?? input.cantidadCuotas;

  await ref.update({
    beneficiario: input.beneficiario,
    monto: input.monto,
    tipo: input.tipo,
    cantidadCuotas: input.cantidadCuotas,
    fechaPrimerVencimiento: input.fechaPrimerVencimiento,
    activo: input.tipo === 'mensual',
    ambito: input.ambito ?? '',
    notas: input.notas ?? '',
    categoriaId: categoriaId ?? null,
    categoriaLabel: categoriaLabel ?? null,
    origenTipo: input.origenTipo ?? 'manual',
    compraId: existing.compraId ?? null,
    compraLabel: existing.compraLabel ?? null,
    tarjetaId: input.tarjetaId ?? null,
    tarjetaLabel: input.tarjetaLabel ?? null,
    medioPagoId: input.medioPagoId ?? null,
    updatedAt: now,
  });

  const initialCuotas = buildInitialCuotas(input).map((cuota) => ({
    ...cuota,
    obligacionId,
    origenTipo: input.origenTipo ?? 'manual',
    compraId: existing.compraId ?? null,
    compraLabel: existing.compraLabel ?? null,
    tarjetaId: input.tarjetaId ?? null,
    tarjetaLabel: input.tarjetaLabel ?? null,
    medioPagoId: input.medioPagoId ?? null,
    cuotaTotal,
    descripcion: buildCuotaDescripcion(cuota, input, cuotaTotal, categoriaLabel),
    createdAt: now,
  }));

  const batch = db.batch();
  cuotasSnap.docs.forEach((doc) => batch.delete(doc.ref));
  for (const cuota of initialCuotas) {
    batch.set(cuotasCollection(businessId).doc(), cuota);
  }
  await batch.commit();

  const obligationDoc = await ref.get();
  return {
    obligation: mapObligation(obligationDoc.id, obligationDoc.data() as Record<string, unknown>),
    cuotasCreated: initialCuotas.length,
  };
}

async function syncCashMovementMonto(
  businessId: string,
  movimientoCajaId: string,
  monto: number
): Promise<boolean> {
  const ref = db.doc(`negocios/${businessId}/movimientos_caja/${movimientoCajaId}`);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const current = Number(snap.data()?.monto) || 0;
  const next = Math.round(monto * 100) / 100;
  if (Math.abs(current - next) <= 0.009) return false;
  await ref.update({ monto: next });
  return true;
}

/** Alinea egresos de caja con el monto de cuotas ya pagadas (corrección de datos). */
async function reconcilePaidInstallmentCashAmounts(businessId: string): Promise<number> {
  const snapshot = await cuotasCollection(businessId).where('estado', '==', 'pagada').get();
  let fixes = 0;

  for (const doc of snapshot.docs) {
    const cuota = mapCuota(doc.id, doc.data() as Record<string, unknown>);
    if (!cuota.movimientoCajaId) continue;
    const fixed = await syncCashMovementMonto(businessId, cuota.movimientoCajaId, cuota.monto);
    if (fixed) fixes += 1;
  }

  return fixes;
}

/**
 * Corrige cuotas donde se guardó el total (ej. 2823) en lugar del monto por cuota (941).
 * Actualiza obligación, cuotas y egresos de caja vinculados.
 */
async function reconcileSplitInstallmentMontos(businessId: string): Promise<number> {
  const obligationsSnap = await obligationsCollection(businessId).get();
  let fixes = 0;
  const now = new Date().toISOString();

  for (const oblDoc of obligationsSnap.docs) {
    const obligation = mapObligation(oblDoc.id, oblDoc.data() as Record<string, unknown>);
    if (obligation.tipo !== 'unico') continue;
    if (obligation.origenTipo === 'prestamo') continue;

    const cuotasSnap = await cuotasCollection(businessId)
      .where('obligacionId', '==', obligation.id)
      .get();
    if (cuotasSnap.empty) continue;

    const cuotaTotal =
      cuotasSnap.docs.reduce(
        (max, doc) => Math.max(max, Math.max(1, Number(doc.data().cuotaTotal) || 0)),
        0
      ) || Math.max(obligation.cantidadCuotas, cuotasSnap.size);
    if (cuotaTotal <= 1) continue;

    const montos = cuotasSnap.docs.map((doc) => Number(doc.data().monto) || 0);
    const firstMonto = montos[0] ?? 0;
    if (!firstMonto || montos.some((monto) => Math.abs(monto - firstMonto) > 0.02)) continue;

    const perCuotaFromObligation = Math.round((obligation.monto / cuotaTotal) * 100) / 100;
    const perCuotaFromInstallment = Math.round((firstMonto / cuotaTotal) * 100) / 100;

    let targetPerCuota: number | null = null;

    // Total duplicado: obligación y cuotas tienen el importe total (2823) con 3 cuotas → 941 c/u.
    if (
      Math.abs(obligation.monto - firstMonto) < 0.02 &&
      perCuotaFromObligation > 0 &&
      perCuotaFromObligation < obligation.monto - 0.02
    ) {
      targetPerCuota = perCuotaFromObligation;
    } else if (
      Math.abs(obligation.monto - perCuotaFromInstallment) < 0.02 &&
      firstMonto > obligation.monto * 1.5
    ) {
      // Obligación ya en monto por cuota; las cuotas quedaron con el total.
      targetPerCuota = obligation.monto;
    } else if (
      Math.abs(obligation.monto - firstMonto) < 0.02 &&
      perCuotaFromInstallment > 0 &&
      perCuotaFromInstallment < firstMonto - 0.02
    ) {
      targetPerCuota = perCuotaFromInstallment;
    }

    if (!targetPerCuota || Math.abs(firstMonto - targetPerCuota) < 0.009) continue;

    await oblDoc.ref.update({
      monto: targetPerCuota,
      cantidadCuotas: cuotaTotal,
      updatedAt: now,
    });

    for (const cuotaDoc of cuotasSnap.docs) {
      const cuota = mapCuota(cuotaDoc.id, cuotaDoc.data() as Record<string, unknown>);
      await cuotaDoc.ref.update({
        monto: targetPerCuota,
        cuotaTotal,
      });
      if (cuota.movimientoCajaId) {
        await syncCashMovementMonto(businessId, cuota.movimientoCajaId, targetPerCuota);
      }
      fixes += 1;
    }
  }

  return fixes;
}

/** Sincroniza egresos de caja con cuotas vinculadas por origenId / movimientoCajaId. */
async function reconcileCashMovementsFromLinkedCuotas(businessId: string): Promise<number> {
  const movSnap = await db
    .collection(`negocios/${businessId}/movimientos_caja`)
    .where('origenTipo', '==', 'cuenta_pagar')
    .get();

  let fixes = 0;

  for (const movDoc of movSnap.docs) {
    const origenId = String(movDoc.data().origenId ?? '').trim();
    if (!origenId) continue;

    const cuotaRef = cuotasCollection(businessId).doc(origenId);
    const cuotaSnap = await cuotaRef.get();
    if (!cuotaSnap.exists) continue;

    let cuota = mapCuota(cuotaSnap.id, cuotaSnap.data() as Record<string, unknown>);
    let targetMonto = cuota.monto;
    const movMonto = Number(movDoc.data().monto) || 0;
    const cuotaTotal = Math.max(1, cuota.cuotaTotal ?? 1);

    if (cuotaTotal > 1 && targetMonto > 0) {
      const perCuota = Math.round((targetMonto / cuotaTotal) * 100) / 100;
      if (perCuota > 0 && perCuota < targetMonto - 0.02) {
        targetMonto = perCuota;
        await cuotaRef.update({ monto: targetMonto });
        cuota = { ...cuota, monto: targetMonto };
        fixes += 1;
      }
    }

    if (Math.abs(movMonto - targetMonto) > 0.009) {
      await movDoc.ref.update({ monto: targetMonto });
      fixes += 1;
    }

    if (!cuota.movimientoCajaId) {
      await cuotaRef.update({ movimientoCajaId: movDoc.id });
      fixes += 1;
    }
  }

  return fixes;
}

/** Corrección de cuotas mal divididas + caja vinculada (llamar al listar payables o caja). */
export async function reconcilePayablesAndCashData(businessId: string): Promise<void> {
  await reconcileSplitInstallmentMontos(businessId);
  await reconcileCashMovementsFromLinkedCuotas(businessId);
  await reconcilePaidInstallmentCashAmounts(businessId);
}

async function updatePayableObligationPreservingPaid(
  businessId: string,
  obligacionId: string,
  input: CreatePayableObligationInput,
  existing: PayableObligationRecord,
  cuotasSnap: QuerySnapshot
): Promise<{ obligation: PayableObligationRecord; cuotasCreated: number }> {
  const finanzas = await loadFinanzasConfig(businessId);
  const categoria = input.categoriaId
    ? getCategoriaGastoById(finanzas.categoriasGasto, input.categoriaId)
    : undefined;
  const categoriaLabel = input.categoriaLabel ?? categoria?.label;
  const categoriaId = categoria?.id ?? input.categoriaId;
  const now = new Date().toISOString();

  if (!input.origenTipo) {
    input.origenTipo = existing.origenTipo ?? 'manual';
  }
  if (existing.origenTipo === 'prestamo') {
    input.origenTipo = 'prestamo';
    input.tipo = 'unico';
  }

  const scheduleInput: CreatePayableObligationInput = { ...input };
  if (scheduleInput.tipo === 'unico' && scheduleInput.origenTipo !== 'compra') {
    applyManualPaymentToInput(scheduleInput, finanzas);
  }

  const paidDocs = cuotasSnap.docs.filter((doc) => doc.data().estado === 'pagada');
  const pendingDocs = cuotasSnap.docs.filter((doc) => doc.data().estado !== 'pagada');
  const paidCount = paidDocs.length;
  const cuotaTotal = scheduleInput.cuotaTotal ?? scheduleInput.cantidadCuotas;

  const ref = obligationsCollection(businessId).doc(obligacionId);
  await ref.update({
    beneficiario: scheduleInput.beneficiario,
    monto: scheduleInput.monto,
    tipo: scheduleInput.tipo,
    cantidadCuotas: scheduleInput.cantidadCuotas,
    fechaPrimerVencimiento: scheduleInput.fechaPrimerVencimiento,
    activo: scheduleInput.tipo === 'mensual',
    ambito: scheduleInput.ambito ?? '',
    notas: scheduleInput.notas ?? '',
    categoriaId: categoriaId ?? null,
    categoriaLabel: categoriaLabel ?? null,
    origenTipo: scheduleInput.origenTipo ?? 'manual',
    compraId: existing.compraId ?? null,
    compraLabel: existing.compraLabel ?? null,
    tarjetaId: scheduleInput.tarjetaId ?? null,
    tarjetaLabel: scheduleInput.tarjetaLabel ?? null,
    medioPagoId: scheduleInput.medioPagoId ?? null,
    updatedAt: now,
  });

  const batch = db.batch();
  const shouldCorrectPaidCuotaMonto =
    scheduleInput.tipo === 'unico' && scheduleInput.origenTipo !== 'compra';

  for (const doc of paidDocs) {
    const cuota = mapCuota(doc.id, doc.data() as Record<string, unknown>);
    batch.update(doc.ref, {
      beneficiario: scheduleInput.beneficiario,
      descripcion: buildCuotaDescripcion(
        { numeroCuota: cuota.numeroCuota, fechaVencimiento: cuota.fechaVencimiento },
        scheduleInput,
        cuotaTotal,
        categoriaLabel
      ),
      cuotaTotal,
      ...(shouldCorrectPaidCuotaMonto ? { monto: scheduleInput.monto } : {}),
      ...(scheduleInput.ambito ? { ambito: scheduleInput.ambito } : {}),
    });
  }
  for (const doc of pendingDocs) {
    batch.delete(doc.ref);
  }
  await batch.commit();

  if (shouldCorrectPaidCuotaMonto) {
    for (const doc of paidDocs) {
      const cuota = mapCuota(doc.id, doc.data() as Record<string, unknown>);
      if (cuota.movimientoCajaId) {
        await syncCashMovementMonto(businessId, cuota.movimientoCajaId, scheduleInput.monto);
      }
    }
  }

  let cuotasCreated = 0;

  if (scheduleInput.tipo === 'mensual') {
    await ensureMensualCuotasHorizon(businessId);
  } else {
    const remaining = Math.max(0, scheduleInput.cantidadCuotas - paidCount);
    if (remaining > 0) {
      const pendingBatch = db.batch();
      for (let i = 0; i < remaining; i++) {
        const numeroCuota = paidCount + i + 1;
        const fechaVencimiento = addMonths(scheduleInput.fechaPrimerVencimiento, paidCount + i);
        const cuotaStub = { numeroCuota, fechaVencimiento };
        pendingBatch.set(cuotasCollection(businessId).doc(), {
          obligacionId,
          beneficiario: scheduleInput.beneficiario,
          numeroCuota,
          fechaVencimiento,
          monto: scheduleInput.monto,
          estado: 'pendiente',
          tipo: 'unico',
          ambito: scheduleInput.ambito ?? '',
          origenTipo: scheduleInput.origenTipo ?? 'manual',
          compraId: existing.compraId ?? null,
          compraLabel: existing.compraLabel ?? null,
          tarjetaId: scheduleInput.tarjetaId ?? null,
          tarjetaLabel: scheduleInput.tarjetaLabel ?? null,
          medioPagoId: scheduleInput.medioPagoId ?? null,
          cuotaTotal,
          descripcion: buildCuotaDescripcion(cuotaStub, scheduleInput, cuotaTotal, categoriaLabel),
          createdAt: now,
        });
        cuotasCreated += 1;
      }
      await pendingBatch.commit();
    }
  }

  const obligationDoc = await ref.get();
  return {
    obligation: mapObligation(obligationDoc.id, obligationDoc.data() as Record<string, unknown>),
    cuotasCreated,
  };
}

export async function deletePayableObligation(
  businessId: string,
  obligacionId: string
): Promise<void> {
  const ref = obligationsCollection(businessId).doc(obligacionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('OBLIGATION_NOT_FOUND');
  }

  const cuotasSnap = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligacionId)
    .get();

  const hasPaidCuotas = cuotasSnap.docs.some((doc) => doc.data().estado === 'pagada');
  if (hasPaidCuotas) {
    throw new Error('OBLIGATION_HAS_PAID_CUOTAS');
  }

  const batch = db.batch();
  cuotasSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(ref);
  await batch.commit();
}
