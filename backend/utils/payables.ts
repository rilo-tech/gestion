import { db } from '../firebase.ts';
import { createCashEgreso } from './cash-egreso.ts';
import {
  getCategoriaGastoById,
  getMedioPagoById,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
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
  const monto = Math.max(0, Number(data.monto) || 0);
  const tipo: PayableTipo = data.tipo === 'mensual' ? 'mensual' : 'unico';
  const cantidadCuotas = Math.min(Math.max(1, Math.round(Number(data.cantidadCuotas) || 1)), 120);
  const fechaPrimerVencimiento = normalizeDate(data.fechaPrimerVencimiento);
  const notas = String(data.notas ?? '').trim();

  if (!beneficiario || monto <= 0 || !fechaPrimerVencimiento) return null;

  const categoriaId = String(data.categoriaId ?? '').trim() || undefined;

  return {
    beneficiario,
    monto,
    tipo,
    cantidadCuotas: tipo === 'unico' ? cantidadCuotas : Math.max(cantidadCuotas, 1),
    fechaPrimerVencimiento,
    ambito: data.ambito ? String(data.ambito).trim().toLowerCase() : undefined,
    notas: notas || undefined,
    categoriaId,
  };
}

function mapObligation(id: string, data: Record<string, unknown>): PayableObligationRecord {
  return {
    id,
    beneficiario: String(data.beneficiario ?? '').trim(),
    monto: Math.max(0, Number(data.monto) || 0),
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
    monto: Math.max(0, Number(data.monto) || 0),
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
  const descripcionBase = input.descripcionBase ?? input.beneficiario;

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
    descripcion:
      input.origenTipo === 'compra' && input.compraLabel
        ? `Cuota ${cuota.numeroCuota}/${cuotaTotal} · Compra #${input.compraLabel} · ${descripcionBase}${input.tarjetaLabel ? ` · ${input.tarjetaLabel}` : ''}`
        : `${input.beneficiario}${categoriaLabel ? ` · ${categoriaLabel}` : ''}${input.tipo === 'mensual' ? ` · ${cuota.fechaVencimiento.slice(0, 7)}` : ''}`,
    createdAt: now,
  }));

  const batch = db.batch();
  for (const cuota of initialCuotas) {
    batch.set(cuotasCollection(businessId).doc(), cuota);
  }
  await batch.commit();

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
  options?: { medioPagoId?: string }
): Promise<PayableCuotaRecord & { displayEstado: PayableDisplayEstado }> {
  const ref = cuotasCollection(businessId).doc(cuotaId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('CUOTA_NOT_FOUND');
  }

  const before = mapCuota(snap.id, snap.data() as Record<string, unknown>);
  let movimientoCajaId = before.movimientoCajaId;
  let medioPagoId = before.medioPagoId;

  if (paid && !movimientoCajaId && options?.medioPagoId) {
    const finanzas = await loadFinanzasConfig(businessId);
    const medio = getMedioPagoById(finanzas.mediosPago, options.medioPagoId);
    if (!medio || !medioPagoGeneratesImmediateCash(medio)) {
      throw new Error('MEDIO_PAGO_INVALID');
    }

    movimientoCajaId = await createCashEgreso(businessId, {
      monto: before.monto,
      concepto: before.descripcion || before.beneficiario,
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
  });

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

  const batch = db.batch();
  cuotasSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(ref);
  await batch.commit();
}
