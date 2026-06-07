import { db } from '../firebase.ts';
import { createCashEgresoForAmbitoTotals } from './cash-egreso.ts';
import {
  getMedioPagoById,
  getTarjetaById,
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
} from './finance-config.ts';
import {
  createPayableObligation,
  listPayableInstallments,
  type PayableCuotaRecord,
} from './payables.ts';
import { normalizeMovementAmbito } from './caja-ambitos.ts';

export interface CardStatementSummary {
  tarjetaId: string;
  tarjetaLabel: string;
  medioPagoId: string;
  medioPagoLabel: string;
  mes: string;
  ambito: string;
  cuotaIds: string[];
  total: number;
  cuotasCount: number;
}

function cuotasCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`);
}

function obligationsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/cuentas_pagar_obligaciones`);
}

function addMonthsToDate(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function monthKeyFromDate(dateStr: string): string {
  return String(dateStr ?? '').slice(0, 7);
}

export async function listCardStatementSummaries(
  businessId: string,
  mes?: string
): Promise<CardStatementSummary[]> {
  const finanzas = await loadFinanzasConfig(businessId);
  const installments = await listPayableInstallments(businessId);
  const pending = installments.filter(
    (cuota) => cuota.estado === 'pendiente' && cuota.tarjetaId
  );

  const groups = new Map<string, CardStatementSummary>();

  for (const cuota of pending) {
    const cuotaMes = monthKeyFromDate(cuota.fechaVencimiento);
    if (mes && cuotaMes !== mes) continue;

    const tarjetaId = String(cuota.tarjetaId ?? '').trim();
    if (!tarjetaId) continue;
    const ambito = String(cuota.ambito ?? 'negocio').trim().toLowerCase();
    const key = `${tarjetaId}|${cuotaMes}|${ambito}`;

    const tarjeta = getTarjetaById(finanzas.tarjetas, tarjetaId);
    const medioPagoId =
      tarjeta?.medioPagoId ??
      String(cuota.medioPagoId ?? '').trim().toLowerCase() ??
      'tarjeta_credito';
    const medio = getMedioPagoById(finanzas.mediosPago, medioPagoId);
    const current = groups.get(key) ?? {
      tarjetaId,
      tarjetaLabel: tarjeta?.label ?? cuota.tarjetaLabel ?? tarjetaId,
      medioPagoId,
      medioPagoLabel: medio?.label ?? medioPagoId,
      mes: cuotaMes,
      ambito,
      cuotaIds: [],
      total: 0,
      cuotasCount: 0,
    };

    current.cuotaIds.push(cuota.id);
    current.total = Math.round((current.total + (Number(cuota.monto) || 0)) * 100) / 100;
    current.cuotasCount += 1;
    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => {
    const dateCompare = a.mes.localeCompare(b.mes);
    if (dateCompare !== 0) return dateCompare;
    return a.tarjetaLabel.localeCompare(b.tarjetaLabel, 'es');
  });
}

export interface PayCardStatementInput {
  tarjetaId: string;
  mes: string;
  medioPagoId: string;
  ambito?: string;
  notas?: string;
  /** Monto del egreso de caja. Si falta o es >= total pendiente, se paga el resumen completo. */
  montoPago?: number;
}

function sortCuotasByDueDate(
  a: PayableCuotaRecord,
  b: PayableCuotaRecord
): number {
  const dateA = a.fechaVencimiento?.slice(0, 10) || '';
  const dateB = b.fechaVencimiento?.slice(0, 10) || '';
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return (a.numeroCuota || 0) - (b.numeroCuota || 0);
}

export async function payCardStatement(
  businessId: string,
  input: PayCardStatementInput
): Promise<{
  cuotasPagadas: number;
  cuotasParciales: number;
  total: number;
  saldoPendiente: number;
  movimientoCajaIds: string[];
}> {
  const finanzas = await loadFinanzasConfig(businessId);
  const tarjeta = getTarjetaById(finanzas.tarjetas, input.tarjetaId);
  if (!tarjeta) {
    throw new Error('TARJETA_NOT_FOUND');
  }

  const medio = getMedioPagoById(finanzas.mediosPago, input.medioPagoId);
  if (!medio || !medioPagoGeneratesImmediateCash(medio)) {
    throw new Error('MEDIO_PAGO_INVALID');
  }

  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};

  const summaries = await listCardStatementSummaries(businessId, input.mes);
  const targets = summaries.filter((entry) => {
    if (entry.tarjetaId !== input.tarjetaId) return false;
    if (input.ambito) return entry.ambito === normalizeMovementAmbito(input.ambito, caja);
    return true;
  });

  if (targets.length === 0) {
    throw new Error('NO_CUOTAS_PENDING');
  }

  const cuotaIdSet = new Set(targets.flatMap((entry) => entry.cuotaIds));
  const cuotaSnaps = await Promise.all(
    [...cuotaIdSet].map((id) => cuotasCollection(businessId).doc(id).get())
  );

  const pendingCuotas = cuotaSnaps
    .filter((snap) => snap.exists)
    .map((snap) => {
      const data = snap.data() as Record<string, unknown>;
      if (data.estado === 'pagada') return null;
      return {
        id: snap.id,
        ref: snap.ref,
        monto: Math.round((Number(data.monto) || 0) * 100) / 100,
        ambito: String(data.ambito ?? 'negocio').trim().toLowerCase(),
        fechaVencimiento: String(data.fechaVencimiento ?? ''),
        numeroCuota: Math.max(1, Number(data.numeroCuota) || 1),
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row && row.monto > 0)
    .sort((a, b) => sortCuotasByDueDate(
      { fechaVencimiento: a.fechaVencimiento, numeroCuota: a.numeroCuota } as PayableCuotaRecord,
      { fechaVencimiento: b.fechaVencimiento, numeroCuota: b.numeroCuota } as PayableCuotaRecord
    ));

  if (pendingCuotas.length === 0) {
    throw new Error('NO_CUOTAS_PENDING');
  }

  const totalPendiente = Math.round(
    pendingCuotas.reduce((acc, cuota) => acc + cuota.monto, 0) * 100
  ) / 100;

  const montoPagoRaw =
    typeof input.montoPago === 'number' && Number.isFinite(input.montoPago) && input.montoPago > 0
      ? Math.round(input.montoPago * 100) / 100
      : totalPendiente;
  const montoPago = Math.min(montoPagoRaw, totalPendiente);

  if (montoPago <= 0) {
    throw new Error('MONTO_PAGO_INVALID');
  }

  let remaining = montoPago;
  let cuotasPagadas = 0;
  let cuotasParciales = 0;
  const egressByAmbito = new Map<string, number>();
  const now = new Date().toISOString();

  type CuotaUpdate =
    | {
        kind: 'full';
        ref: (typeof pendingCuotas)[number]['ref'];
        ambito: string;
        monto: number;
      }
    | {
        kind: 'partial';
        ref: (typeof pendingCuotas)[number]['ref'];
        ambito: string;
        montoPagado: number;
        saldoCuota: number;
      };

  const updates: CuotaUpdate[] = [];

  for (const cuota of pendingCuotas) {
    if (remaining <= 0) break;
    const ambito = cuota.ambito || 'negocio';

    if (remaining >= cuota.monto) {
      updates.push({ kind: 'full', ref: cuota.ref, ambito, monto: cuota.monto });
      egressByAmbito.set(
        ambito,
        Math.round(((egressByAmbito.get(ambito) ?? 0) + cuota.monto) * 100) / 100
      );
      remaining = Math.round((remaining - cuota.monto) * 100) / 100;
      cuotasPagadas += 1;
      continue;
    }

    const saldoCuota = Math.round((cuota.monto - remaining) * 100) / 100;
    updates.push({
      kind: 'partial',
      ref: cuota.ref,
      ambito,
      montoPagado: remaining,
      saldoCuota,
    });
    egressByAmbito.set(
      ambito,
      Math.round(((egressByAmbito.get(ambito) ?? 0) + remaining) * 100) / 100
    );
    cuotasParciales += 1;
    remaining = 0;
  }

  const mesLabel = input.mes;
  const conceptoBase =
    montoPago >= totalPendiente
      ? `Resumen ${tarjeta.label} · ${mesLabel}`
      : `Pago parcial resumen ${tarjeta.label} · ${mesLabel}`;

  const movementMap = await createCashEgresoForAmbitoTotals(businessId, egressByAmbito, {
    concepto: conceptoBase,
    medioPagoId: input.medioPagoId,
    origenId: `tarjeta_${input.tarjetaId}_${input.mes}_${Date.now()}`,
    origenTipo: 'tarjeta_resumen',
    origenGrupo: 'compra',
  });

  const movementIds = [...movementMap.values()];
  const batch = db.batch();

  for (const update of updates) {
    const movimientoCajaId = movementMap.get(update.ambito) ?? movementIds[0] ?? null;
    if (update.kind === 'full') {
      batch.update(update.ref, {
        estado: 'pagada',
        fechaPago: now,
        movimientoCajaId,
        pagoResumenMes: input.mes,
        pagoResumenTarjetaId: input.tarjetaId,
      });
      continue;
    }
    batch.update(update.ref, {
      monto: update.saldoCuota,
      estado: 'pendiente',
      fechaPago: null,
    });
  }

  await batch.commit();

  return {
    cuotasPagadas,
    cuotasParciales,
    total: montoPago,
    saldoPendiente: Math.round((totalPendiente - montoPago) * 100) / 100,
    movimientoCajaIds: movementIds,
  };
}

export interface CreatePurchasePayablesParams {
  compraId: string;
  compraLabel: string;
  proveedor: string;
  tarjetaId: string;
  tarjetaLabel: string;
  medioPagoId: string;
  ambito: string;
  montoTotal: number;
  cuotas: number;
  fechaPrimerVencimiento: string;
  lineDescriptions: string[];
}

export async function createPurchasePayables(
  businessId: string,
  params: CreatePurchasePayablesParams
): Promise<{ cuotasCreated: number }> {
  const cuotas = Math.min(Math.max(1, Math.round(params.cuotas)), 120);
  const montoCuota = Math.round((params.montoTotal / cuotas) * 100) / 100;
  const descripcionBase = params.lineDescriptions.slice(0, 2).join(' · ') || params.proveedor;
  const beneficiario = `${params.tarjetaLabel} · Compra #${params.compraLabel}`;

  const { cuotasCreated } = await createPayableObligation(businessId, {
    beneficiario,
    monto: montoCuota,
    tipo: 'unico',
    cantidadCuotas: cuotas,
    fechaPrimerVencimiento: params.fechaPrimerVencimiento,
    ambito: params.ambito,
    notas: params.lineDescriptions.join('; '),
    origenTipo: 'compra',
    compraId: params.compraId,
    compraLabel: params.compraLabel,
    tarjetaId: params.tarjetaId,
    tarjetaLabel: params.tarjetaLabel,
    medioPagoId: params.medioPagoId,
    cuotaTotal: cuotas,
    descripcionBase,
  });

  return { cuotasCreated };
}

/** Actualiza cuotas pendientes de la compra si la estructura coincide; si no, recrea. */
export async function syncPurchasePayablesForCompra(
  businessId: string,
  params: CreatePurchasePayablesParams
): Promise<{ cuotasCreated: number }> {
  const cuotasTotal = Math.min(Math.max(1, Math.round(params.cuotas)), 120);
  const montoCuota = Math.round((params.montoTotal / cuotasTotal) * 100) / 100;
  const descripcionBase = params.lineDescriptions.slice(0, 2).join(' · ') || params.proveedor;
  const beneficiario = `${params.tarjetaLabel} · Compra #${params.compraLabel}`;

  const snap = await cuotasCollection(businessId).where('compraId', '==', params.compraId).get();
  const ambitoKey = String(params.ambito ?? '').trim().toLowerCase();
  const scoped = snap.docs.filter(
    (doc) => String(doc.data().ambito ?? '').trim().toLowerCase() === ambitoKey
  );

  for (const doc of scoped) {
    const data = doc.data();
    if (data.estado === 'pagada' || data.movimientoCajaId) {
      throw new Error('PAID_INSTALLMENTS');
    }
  }

  const sorted = [...scoped].sort(
    (a, b) => (Number(a.data().numeroCuota) || 0) - (Number(b.data().numeroCuota) || 0)
  );

  if (sorted.length === cuotasTotal) {
    const now = new Date().toISOString();
    const batch = db.batch();
    for (let i = 0; i < sorted.length; i++) {
      const numero = i + 1;
      batch.update(sorted[i].ref, {
        monto: montoCuota,
        fechaVencimiento: addMonthsToDate(params.fechaPrimerVencimiento, i),
        beneficiario,
        tarjetaId: params.tarjetaId,
        tarjetaLabel: params.tarjetaLabel,
        medioPagoId: params.medioPagoId,
        cuotaTotal: cuotasTotal,
        descripcion: `Cuota ${numero}/${cuotasTotal} · Compra #${params.compraLabel} · ${descripcionBase} · ${params.tarjetaLabel}`,
      });
    }
    await batch.commit();

    const obligacionId = String(sorted[0]?.data()?.obligacionId ?? '').trim();
    if (obligacionId) {
      await obligationsCollection(businessId).doc(obligacionId).update({
        beneficiario,
        monto: montoCuota,
        cantidadCuotas: cuotasTotal,
        fechaPrimerVencimiento: params.fechaPrimerVencimiento,
        tarjetaId: params.tarjetaId,
        tarjetaLabel: params.tarjetaLabel,
        medioPagoId: params.medioPagoId,
        notas: params.lineDescriptions.join('; '),
        updatedAt: now,
      });
    }

    return { cuotasCreated: cuotasTotal };
  }

  if (scoped.length > 0 && sorted.length !== cuotasTotal) {
    const obligationIds = new Set<string>();
    const batch = db.batch();
    for (const doc of scoped) {
      batch.delete(doc.ref);
      const obligacionId = String(doc.data().obligacionId ?? '').trim();
      if (obligacionId) obligationIds.add(obligacionId);
    }
    await batch.commit();
    if (obligationIds.size > 0) {
      const obligBatch = db.batch();
      for (const obligacionId of obligationIds) {
        obligBatch.delete(obligationsCollection(businessId).doc(obligacionId));
      }
      await obligBatch.commit();
    }
  }

  return createPurchasePayables(businessId, params);
}

export type { PayableCuotaRecord };
