import { db } from '../firebase.ts';
import { createCashEgreso } from './cash-egreso.ts';
import { getBusinessCashAmbitoId } from './caja-ambitos.ts';
import {
  getMedioPagoById,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
} from './finance-config.ts';

export type CollaboratorModalidad = 'por_hora' | 'fijo' | 'mixto';
export type CollaboratorPeriodoReferencia = 'semana' | 'quincena' | 'mes';
export type CollaboratorMovementTipo = 'horas' | 'extra' | 'pago';
export type CollaboratorExtraTipo =
  | 'reparto'
  | 'premio'
  | 'aguinaldo'
  | 'bonificacion'
  | 'otro';

export type CollaboratorRecord = {
  id: string;
  nombre: string;
  telefono?: string;
  email?: string;
  notas?: string;
  modalidad: CollaboratorModalidad;
  valorHora?: number;
  montoFijoPeriodo?: number;
  periodoReferencia: CollaboratorPeriodoReferencia;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CollaboratorMovementRecord = {
  id: string;
  colaboradorId: string;
  colaboradorNombre?: string;
  tipo: CollaboratorMovementTipo;
  fecha: string;
  horas?: number;
  valorHora?: number;
  extraTipo?: CollaboratorExtraTipo;
  concepto?: string;
  monto: number;
  periodoDesde?: string;
  periodoHasta?: string;
  notas?: string;
  medioPagoId?: string;
  movimientoCajaId?: string;
  createdAt: string;
};

export type CollaboratorSummaryRow = {
  colaboradorId: string;
  nombre: string;
  activo: boolean;
  horas: number;
  montoHoras: number;
  montoExtras: number;
  devengado: number;
  pagado: number;
  pendientePeriodo: number;
  saldoAcumulado: number;
  movimientosCount: number;
};

export type CollaboratorsPeriodSummary = {
  from: string;
  to: string;
  totalHoras: number;
  totalDevengado: number;
  totalExtras: number;
  totalPagado: number;
  totalPendientePeriodo: number;
  totalSaldoAcumulado: number;
  colaboradores: CollaboratorSummaryRow[];
  extrasPorTipo: Array<{ tipo: string; label: string; monto: number }>;
};

const EXTRA_LABELS: Record<CollaboratorExtraTipo, string> = {
  reparto: 'Repartos',
  premio: 'Premios',
  aguinaldo: 'Aguinaldo',
  bonificacion: 'Bonificaciones',
  otro: 'Otros extras',
};

function collaboratorsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/colaboradores`);
}

function movementsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/colaboradores_movimientos`);
}

function parseDateOnly(value: string, endOfDay = false): Date | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && trimmed.length === 10) date.setHours(23, 59, 59, 999);
  return date;
}

function inRange(fecha: string, from: Date, to: Date): boolean {
  const date = parseDateOnly(fecha.slice(0, 10));
  if (!date) return false;
  return date >= from && date <= to;
}

function normalizeModalidad(value: unknown): CollaboratorModalidad {
  const raw = String(value ?? '').trim();
  if (raw === 'fijo' || raw === 'mixto') return raw;
  return 'por_hora';
}

function normalizePeriodo(value: unknown): CollaboratorPeriodoReferencia {
  const raw = String(value ?? '').trim();
  if (raw === 'quincena' || raw === 'mes') return raw;
  return 'semana';
}

function normalizeMovementTipo(value: unknown): CollaboratorMovementTipo | null {
  const raw = String(value ?? '').trim();
  if (raw === 'horas' || raw === 'extra' || raw === 'pago') return raw;
  return null;
}

function normalizeExtraTipo(value: unknown): CollaboratorExtraTipo {
  const raw = String(value ?? '').trim();
  if (raw === 'reparto' || raw === 'premio' || raw === 'aguinaldo' || raw === 'bonificacion') {
    return raw;
  }
  return 'otro';
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseCollaboratorInput(body: Record<string, unknown>) {
  const nombre = String(body.nombre ?? '').trim();
  if (!nombre) return null;

  return {
    nombre,
    telefono: String(body.telefono ?? '').trim() || null,
    email: String(body.email ?? '').trim() || null,
    notas: String(body.notas ?? '').trim() || null,
    modalidad: normalizeModalidad(body.modalidad),
    valorHora: Number(body.valorHora) > 0 ? roundMoney(Number(body.valorHora)) : null,
    montoFijoPeriodo:
      Number(body.montoFijoPeriodo) > 0 ? roundMoney(Number(body.montoFijoPeriodo)) : null,
    periodoReferencia: normalizePeriodo(body.periodoReferencia),
    activo: body.activo !== false,
  };
}

export async function listCollaborators(businessId: string): Promise<CollaboratorRecord[]> {
  const snapshot = await collaboratorsCollection(businessId).get();
  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<CollaboratorRecord, 'id'>),
    }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

export async function getCollaborator(
  businessId: string,
  colaboradorId: string
): Promise<CollaboratorRecord | null> {
  const doc = await collaboratorsCollection(businessId).doc(colaboradorId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<CollaboratorRecord, 'id'>) };
}

export async function listCollaboratorMovements(
  businessId: string,
  filters: { from?: string; to?: string; colaboradorId?: string }
): Promise<CollaboratorMovementRecord[]> {
  const snapshot = await movementsCollection(businessId).orderBy('fecha', 'desc').get();
  const from = filters.from ? parseDateOnly(filters.from) : null;
  const to = filters.to ? parseDateOnly(filters.to, true) : null;

  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<CollaboratorMovementRecord, 'id'>),
    }))
    .filter((row) => {
      if (filters.colaboradorId && row.colaboradorId !== filters.colaboradorId) return false;
      if (from && to && !inRange(row.fecha, from, to)) return false;
      return true;
    });
}

export async function parseMovementInput(
  businessId: string,
  body: Record<string, unknown>
): Promise<Omit<CollaboratorMovementRecord, 'id' | 'createdAt' | 'colaboradorNombre'> | null> {
  const colaboradorId = String(body.colaboradorId ?? '').trim();
  const tipo = normalizeMovementTipo(body.tipo);
  const fecha = String(body.fecha ?? '').slice(0, 10);
  if (!colaboradorId || !tipo || !fecha) return null;

  const collaborator = await getCollaborator(businessId, colaboradorId);
  if (!collaborator) return null;

  const notas = String(body.notas ?? '').trim() || undefined;
  const periodoDesde = String(body.periodoDesde ?? '').slice(0, 10) || undefined;
  const periodoHasta = String(body.periodoHasta ?? '').slice(0, 10) || undefined;

  if (tipo === 'horas') {
    const horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas <= 0) return null;
    const valorHora =
      Number(body.valorHora) > 0
        ? roundMoney(Number(body.valorHora))
        : Number(collaborator.valorHora) > 0
          ? roundMoney(Number(collaborator.valorHora))
          : 0;
    return {
      colaboradorId,
      tipo,
      fecha,
      horas: roundMoney(horas),
      valorHora: valorHora || undefined,
      monto: roundMoney(horas * valorHora),
      periodoDesde,
      periodoHasta,
      notas,
    };
  }

  if (tipo === 'extra') {
    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) return null;
    return {
      colaboradorId,
      tipo,
      fecha,
      extraTipo: normalizeExtraTipo(body.extraTipo),
      concepto: String(body.concepto ?? '').trim() || undefined,
      monto: roundMoney(monto),
      periodoDesde,
      periodoHasta,
      notas,
    };
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0) return null;
  const medioPagoId = String(body.medioPagoId ?? 'efectivo').trim().toLowerCase();
  return {
    colaboradorId,
    tipo,
    fecha,
    monto: roundMoney(monto),
    periodoDesde,
    periodoHasta,
    notas,
    medioPagoId,
  };
}

function cashFechaFromDateOnly(fecha: string): string {
  const raw = String(fecha ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`).toISOString();
  }
  return new Date().toISOString();
}

function buildCollaboratorPaymentConcepto(
  colaboradorNombre: string,
  periodoDesde?: string,
  periodoHasta?: string
): string {
  let concepto = `Pago colaborador · ${colaboradorNombre}`;
  if (periodoDesde && periodoHasta) {
    concepto += ` · ${periodoDesde} → ${periodoHasta}`;
  } else if (periodoDesde) {
    concepto += ` · ${periodoDesde}`;
  }
  return concepto;
}

export async function createCashForCollaboratorPayment(
  businessId: string,
  params: {
    movementId: string;
    colaboradorId: string;
    colaboradorNombre: string;
    monto: number;
    medioPagoId: string;
    fecha: string;
    periodoDesde?: string;
    periodoHasta?: string;
  }
): Promise<string> {
  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, params.medioPagoId);
  if (!medio || !medioPagoGeneratesImmediateCash(medio)) {
    throw new Error('MEDIO_PAGO_INVALID');
  }

  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};

  return createCashEgreso(businessId, {
    monto: params.monto,
    concepto: buildCollaboratorPaymentConcepto(
      params.colaboradorNombre,
      params.periodoDesde,
      params.periodoHasta
    ),
    medioPagoId: params.medioPagoId,
    ambito: getBusinessCashAmbitoId(caja),
    origenId: params.movementId,
    origenTipo: 'colaborador_pago',
    origenGrupo: 'otro',
    colaboradorId: params.colaboradorId,
    colaboradorNombre: params.colaboradorNombre,
    fecha: cashFechaFromDateOnly(params.fecha),
  });
}

export async function updateCashForCollaboratorPayment(
  businessId: string,
  movimientoCajaId: string,
  params: {
    colaboradorNombre: string;
    monto: number;
    medioPagoId: string;
    fecha: string;
    periodoDesde?: string;
    periodoHasta?: string;
  }
): Promise<void> {
  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, params.medioPagoId);
  if (!medio || !medioPagoGeneratesImmediateCash(medio)) {
    throw new Error('MEDIO_PAGO_INVALID');
  }

  const ref = db.collection(`negocios/${businessId}/movimientos_caja`).doc(movimientoCajaId);
  const snap = await ref.get();
  if (!snap.exists) return;

  await ref.update({
    monto: params.monto,
    concepto: buildCollaboratorPaymentConcepto(
      params.colaboradorNombre,
      params.periodoDesde,
      params.periodoHasta
    ),
    medio: medio.label,
    medioPagoId: params.medioPagoId,
    fecha: cashFechaFromDateOnly(params.fecha),
  });
}

export async function deleteCashForCollaboratorPayment(
  businessId: string,
  movimientoCajaId: string
): Promise<void> {
  const ref = db.collection(`negocios/${businessId}/movimientos_caja`).doc(movimientoCajaId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.delete();
}

export async function syncCollaboratorPaymentCash(
  businessId: string,
  movementId: string,
  input: Omit<CollaboratorMovementRecord, 'id' | 'createdAt' | 'colaboradorNombre'> & {
    colaboradorNombre: string;
  },
  existingMovimientoCajaId?: string
): Promise<string | null> {
  if (input.tipo !== 'pago') {
    if (existingMovimientoCajaId) {
      await deleteCashForCollaboratorPayment(businessId, existingMovimientoCajaId);
    }
    return null;
  }

  const medioPagoId = input.medioPagoId ?? 'efectivo';
  const params = {
    colaboradorNombre: input.colaboradorNombre,
    monto: input.monto,
    medioPagoId,
    fecha: input.fecha,
    periodoDesde: input.periodoDesde,
    periodoHasta: input.periodoHasta,
  };

  if (existingMovimientoCajaId) {
    await updateCashForCollaboratorPayment(businessId, existingMovimientoCajaId, params);
    return existingMovimientoCajaId;
  }

  return createCashForCollaboratorPayment(businessId, {
    movementId,
    colaboradorId: input.colaboradorId,
    ...params,
  });
}

export async function buildCollaboratorsPeriodSummary(
  businessId: string,
  from: string,
  to: string
): Promise<CollaboratorsPeriodSummary> {
  const fromDate = parseDateOnly(from) ?? parseDateOnly(defaultFromDate())!;
  const toDate = parseDateOnly(to, true) ?? parseDateOnly(defaultToDate(), true)!;

  const [collaborators, movementsSnap] = await Promise.all([
    listCollaborators(businessId),
    movementsCollection(businessId).get(),
  ]);

  const movements = movementsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<CollaboratorMovementRecord, 'id'>),
  }));

  const byCollaborator = new Map<string, CollaboratorSummaryRow>();
  for (const c of collaborators) {
    byCollaborator.set(c.id, {
      colaboradorId: c.id,
      nombre: c.nombre,
      activo: c.activo !== false,
      horas: 0,
      montoHoras: 0,
      montoExtras: 0,
      devengado: 0,
      pagado: 0,
      pendientePeriodo: 0,
      saldoAcumulado: 0,
      movimientosCount: 0,
    });
  }

  const extrasPorTipoMap = new Map<string, number>();
  let totalHoras = 0;
  let totalDevengado = 0;
  let totalExtras = 0;
  let totalPagado = 0;

  const lifetimeDevengado = new Map<string, number>();
  const lifetimePagado = new Map<string, number>();

  for (const movement of movements) {
    const row = byCollaborator.get(movement.colaboradorId);
    if (!row) continue;

    const monto = Number(movement.monto ?? 0);
    const inPeriod = inRange(movement.fecha, fromDate, toDate);

    if (movement.tipo === 'horas') {
      const horas = Number(movement.horas ?? 0);
      lifetimeDevengado.set(
        movement.colaboradorId,
        (lifetimeDevengado.get(movement.colaboradorId) ?? 0) + monto
      );
      if (inPeriod) {
        row.horas += horas;
        row.montoHoras += monto;
        row.devengado += monto;
        row.movimientosCount += 1;
        totalHoras += horas;
        totalDevengado += monto;
      }
      continue;
    }

    if (movement.tipo === 'extra') {
      lifetimeDevengado.set(
        movement.colaboradorId,
        (lifetimeDevengado.get(movement.colaboradorId) ?? 0) + monto
      );
      if (inPeriod) {
        row.montoExtras += monto;
        row.devengado += monto;
        row.movimientosCount += 1;
        totalExtras += monto;
        totalDevengado += monto;
        const extraKey = movement.extraTipo ?? 'otro';
        extrasPorTipoMap.set(extraKey, (extrasPorTipoMap.get(extraKey) ?? 0) + monto);
      }
      continue;
    }

    lifetimePagado.set(
      movement.colaboradorId,
      (lifetimePagado.get(movement.colaboradorId) ?? 0) + monto
    );
    if (inPeriod) {
      row.pagado += monto;
      row.movimientosCount += 1;
      totalPagado += monto;
    }
  }

  let totalPendientePeriodo = 0;
  let totalSaldoAcumulado = 0;

  for (const row of byCollaborator.values()) {
    row.pendientePeriodo = roundMoney(row.devengado - row.pagado);
    const dev = lifetimeDevengado.get(row.colaboradorId) ?? 0;
    const pag = lifetimePagado.get(row.colaboradorId) ?? 0;
    row.saldoAcumulado = roundMoney(dev - pag);
    totalPendientePeriodo += row.pendientePeriodo;
    totalSaldoAcumulado += row.saldoAcumulado;
  }

  const extrasPorTipo = [...extrasPorTipoMap.entries()]
    .map(([tipo, monto]) => ({
      tipo,
      label: EXTRA_LABELS[tipo as CollaboratorExtraTipo] ?? tipo,
      monto: roundMoney(monto),
    }))
    .sort((a, b) => b.monto - a.monto);

  return {
    from: from.slice(0, 10),
    to: to.slice(0, 10),
    totalHoras: roundMoney(totalHoras),
    totalDevengado: roundMoney(totalDevengado),
    totalExtras: roundMoney(totalExtras),
    totalPagado: roundMoney(totalPagado),
    totalPendientePeriodo: roundMoney(totalPendientePeriodo),
    totalSaldoAcumulado: roundMoney(totalSaldoAcumulado),
    colaboradores: [...byCollaborator.values()]
      .filter((row) => row.movimientosCount > 0 || row.saldoAcumulado !== 0)
      .sort((a, b) => b.pendientePeriodo - a.pendientePeriodo || a.nombre.localeCompare(b.nombre, 'es')),
    extrasPorTipo,
  };
}

export function defaultFromDate(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  return date.toISOString().slice(0, 10);
}

export function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export { collaboratorsCollection, movementsCollection, EXTRA_LABELS };
