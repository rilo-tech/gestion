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
  syncLinkedCashMovementMonto,
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

/** Reparte un total en cuotas; la última absorbe centavos de redondeo. */
export function buildInstallmentMontos(montoTotal: number, count: number): number[] {
  const total = Math.round(montoTotal * 100) / 100;
  const cuotas = Math.min(Math.max(1, Math.round(count)), 120);
  const base = Math.floor((total / cuotas) * 100) / 100;
  let remaining = total;
  const montos: number[] = [];

  for (let i = 0; i < cuotas; i++) {
    const isLast = i === cuotas - 1;
    const monto = isLast ? Math.round(remaining * 100) / 100 : base;
    remaining = Math.round((remaining - monto) * 100) / 100;
    montos.push(monto);
  }

  return montos;
}

export interface SyncPurchasePayablesOptions {
  /** Permite corregir montos aunque haya cuotas pagadas (reparación de datos). */
  allowPaid?: boolean;
  /** No tocar egresos de caja (evita pisar pagos de resumen de tarjeta compartidos). */
  skipCashSync?: boolean;
}

export interface SyncPurchasePayablesResult {
  cuotasCreated: number;
  cuotasUpdated: number;
  cashMovementsFixed: number;
}

function monthKeyFromDate(dateStr: string): string {
  return String(dateStr ?? '').slice(0, 7);
}

export async function listCardStatementSummaries(
  businessId: string,
  mes?: string
): Promise<CardStatementSummary[]> {
  const finanzas = await loadFinanzasConfig(businessId);
  const pendingSnap = await cuotasCollection(businessId).where('estado', '==', 'pendiente').get();
  const pending = pendingSnap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        estado: 'pendiente' as const,
        tarjetaId: data.tarjetaId ? String(data.tarjetaId).trim() : undefined,
        tarjetaLabel: data.tarjetaLabel ? String(data.tarjetaLabel).trim() : undefined,
        medioPagoId: data.medioPagoId ? String(data.medioPagoId).trim().toLowerCase() : undefined,
        fechaVencimiento: String(data.fechaVencimiento ?? ''),
        ambito: String(data.ambito ?? 'negocio').trim().toLowerCase(),
        monto: Number(data.monto) || 0,
      };
    })
    .filter((cuota) => !!cuota.tarjetaId);

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
  /** Cuotas incluidas en el resumen (las que el usuario vio al confirmar). */
  cuotaIds?: string[];
  /** Monto del egreso de caja. Si falta o es >= total pendiente, se paga el resumen completo. */
  montoPago?: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildResumenEgressByAmbito(
  rows: Array<{ ambito: string; monto: number }>,
  montoPago: number
): Map<string, number> {
  const egress = new Map<string, number>();
  const ambitos = [...new Set(rows.map((row) => row.ambito || 'negocio'))];

  if (ambitos.length === 1) {
    egress.set(ambitos[0], montoPago);
    return egress;
  }

  const netByAmbito = new Map<string, number>();
  let netTotal = 0;
  for (const ambito of ambitos) {
    const net = roundMoney(
      rows
        .filter((row) => (row.ambito || 'negocio') === ambito)
        .reduce((acc, row) => acc + row.monto, 0)
    );
    if (net > 0) {
      netByAmbito.set(ambito, net);
      netTotal = roundMoney(netTotal + net);
    }
  }

  if (netTotal <= 0) {
    egress.set(ambitos[0], montoPago);
    return egress;
  }

  let assigned = 0;
  const entries = [...netByAmbito.entries()];
  entries.forEach(([ambito, net], index) => {
    const isLast = index === entries.length - 1;
    const share = isLast
      ? roundMoney(montoPago - assigned)
      : roundMoney((montoPago * net) / netTotal);
    egress.set(ambito, share);
    assigned = roundMoney(assigned + share);
  });

  return egress;
}

function normalizeResumenEgress(
  egressByAmbito: Map<string, number>,
  montoPago: number,
  fallbackAmbito: string
): Map<string, number> {
  const total = roundMoney([...egressByAmbito.values()].reduce((acc, value) => acc + value, 0));
  if (total > 0 && Math.abs(total - montoPago) <= 0.02) {
    return egressByAmbito;
  }
  return new Map([[fallbackAmbito || 'negocio', montoPago]]);
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

  const cuotaIdSet = new Set(
    (input.cuotaIds ?? [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean)
  );
  if (cuotaIdSet.size === 0) {
    if (targets.length === 0) {
      throw new Error('NO_CUOTAS_PENDING');
    }
    for (const id of targets.flatMap((entry) => entry.cuotaIds)) {
      cuotaIdSet.add(id);
    }
  } else if (targets.length === 0) {
    // Cuotas elegidas en pantalla aunque el resumen cacheado esté desactualizado.
  }

  const cuotaSnaps = await Promise.all(
    [...cuotaIdSet].map((id) => cuotasCollection(businessId).doc(id).get())
  );

  type ResumenCuotaRow = {
    id: string;
    ref: (typeof cuotaSnaps)[number]['ref'];
    monto: number;
    ambito: string;
    fechaVencimiento: string;
    numeroCuota: number;
    compraLabel: string;
    tarjetaId: string;
  };

  const allPendingRows = cuotaSnaps
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
        compraLabel: String(data.compraLabel ?? '').trim(),
        tarjetaId: String(data.tarjetaId ?? '').trim(),
      } satisfies ResumenCuotaRow;
    })
    .filter((row): row is ResumenCuotaRow => !!row)
    .filter((row) => {
      const rowMes = monthKeyFromDate(row.fechaVencimiento);
      if (rowMes !== input.mes) return false;
      return !row.tarjetaId || row.tarjetaId === input.tarjetaId;
    });

  if (allPendingRows.length === 0) {
    throw new Error('NO_CUOTAS_PENDING');
  }

  const sortResumenCuotas = (a: ResumenCuotaRow, b: ResumenCuotaRow): number => {
    const dateCompare = sortCuotasByDueDate(
      { fechaVencimiento: a.fechaVencimiento, numeroCuota: a.numeroCuota } as PayableCuotaRecord,
      { fechaVencimiento: b.fechaVencimiento, numeroCuota: b.numeroCuota } as PayableCuotaRecord
    );
    if (dateCompare !== 0) return dateCompare;
    return a.compraLabel.localeCompare(b.compraLabel, 'es');
  };

  const creditCuotas = allPendingRows.filter((row) => row.monto <= 0).sort(sortResumenCuotas);
  const pendingCuotas = allPendingRows.filter((row) => row.monto > 0).sort(sortResumenCuotas);

  if (pendingCuotas.length === 0 && creditCuotas.length === 0) {
    throw new Error('NO_CUOTAS_PENDING');
  }

  const netResumen = Math.round(
    allPendingRows.reduce((acc, cuota) => acc + cuota.monto, 0) * 100
  ) / 100;
  const totalPositivo = Math.round(
    pendingCuotas.reduce((acc, cuota) => acc + cuota.monto, 0) * 100
  ) / 100;
  const maxPago = netResumen > 0 ? netResumen : totalPositivo;

  const montoPagoRaw =
    typeof input.montoPago === 'number' && Number.isFinite(input.montoPago) && input.montoPago > 0
      ? Math.round(input.montoPago * 100) / 100
      : maxPago;
  const montoPago = Math.min(montoPagoRaw, maxPago);

  if (montoPago <= 0) {
    throw new Error('MONTO_PAGO_INVALID');
  }

  let remaining = montoPago;
  let cuotasPagadas = 0;
  let cuotasParciales = 0;
  const egressByAmbito = new Map<string, number>();
  const now = new Date().toISOString();
  const isFullResumenPayment = netResumen > 0 && montoPago >= netResumen - 0.009;

  type CuotaUpdate =
    | {
        kind: 'full';
        ref: ResumenCuotaRow['ref'];
        ambito: string;
        monto: number;
        compensada?: boolean;
      }
    | {
        kind: 'partial';
        ref: ResumenCuotaRow['ref'];
        ambito: string;
        montoPagado: number;
        saldoCuota: number;
      };

  const updates: CuotaUpdate[] = [];

  if (isFullResumenPayment) {
    const egress = buildResumenEgressByAmbito(allPendingRows, montoPago);
    for (const [ambito, monto] of egress) {
      egressByAmbito.set(ambito, monto);
    }

    for (const cuota of pendingCuotas) {
      updates.push({ kind: 'full', ref: cuota.ref, ambito: cuota.ambito, monto: cuota.monto });
      cuotasPagadas += 1;
    }
    for (const cuota of creditCuotas) {
      updates.push({
        kind: 'full',
        ref: cuota.ref,
        ambito: cuota.ambito,
        monto: cuota.monto,
        compensada: true,
      });
      cuotasPagadas += 1;
    }
  } else {
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
  }

  const mesLabel = input.mes;
  const conceptoBase =
    isFullResumenPayment
      ? `Resumen ${tarjeta.label} · ${mesLabel}`
      : `Pago parcial resumen ${tarjeta.label} · ${mesLabel}`;

  const normalizedEgress = normalizeResumenEgress(
    egressByAmbito,
    montoPago,
    allPendingRows[0]?.ambito || 'negocio'
  );

  const movementMap = await createCashEgresoForAmbitoTotals(businessId, normalizedEgress, {
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
    saldoPendiente: Math.round((netResumen - montoPago) * 100) / 100,
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
  const montos = buildInstallmentMontos(params.montoTotal, cuotas);
  const montoCuota = montos[0];
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

/** Actualiza cuotas de la compra si la estructura coincide; si no, recrea (salvo cuotas pagadas). */
export async function syncPurchasePayablesForCompra(
  businessId: string,
  params: CreatePurchasePayablesParams,
  options?: SyncPurchasePayablesOptions
): Promise<SyncPurchasePayablesResult> {
  const allowPaid = options?.allowPaid === true;
  const cuotasTotal = Math.min(Math.max(1, Math.round(params.cuotas)), 120);
  const montos = buildInstallmentMontos(params.montoTotal, cuotasTotal);
  const obligationMonto = montos[0];
  const descripcionBase = params.lineDescriptions.slice(0, 2).join(' · ') || params.proveedor;
  const beneficiario = `${params.tarjetaLabel} · Compra #${params.compraLabel}`;

  const snap = await cuotasCollection(businessId).where('compraId', '==', params.compraId).get();
  const ambitoKey = String(params.ambito ?? '').trim().toLowerCase();
  const scoped = snap.docs.filter(
    (doc) => String(doc.data().ambito ?? '').trim().toLowerCase() === ambitoKey
  );

  for (const doc of scoped) {
    const data = doc.data();
    if (!allowPaid && (data.estado === 'pagada' || data.movimientoCajaId)) {
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
        monto: montos[i],
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

    let cashMovementsFixed = 0;
    if (allowPaid && !options?.skipCashSync) {
      for (let i = 0; i < sorted.length; i++) {
        const movimientoCajaId = String(sorted[i].data().movimientoCajaId ?? '').trim();
        if (!movimientoCajaId) continue;

        const movSnap = await db
          .doc(`negocios/${businessId}/movimientos_caja/${movimientoCajaId}`)
          .get();
        const movOrigenTipo = String(movSnap.data()?.origenTipo ?? '').trim();
        if (movOrigenTipo === 'tarjeta_resumen') continue;

        const fixed = await syncLinkedCashMovementMonto(
          businessId,
          movimientoCajaId,
          montos[i]
        );
        if (fixed) cashMovementsFixed += 1;
      }
    }

    const obligacionId = String(sorted[0]?.data()?.obligacionId ?? '').trim();
    if (obligacionId) {
      await obligationsCollection(businessId).doc(obligacionId).update({
        beneficiario,
        monto: obligationMonto,
        cantidadCuotas: cuotasTotal,
        fechaPrimerVencimiento: params.fechaPrimerVencimiento,
        tarjetaId: params.tarjetaId,
        tarjetaLabel: params.tarjetaLabel,
        medioPagoId: params.medioPagoId,
        notas: params.lineDescriptions.join('; '),
        updatedAt: now,
      });
    }

    return { cuotasCreated: cuotasTotal, cuotasUpdated: cuotasTotal, cashMovementsFixed };
  }

  if (allowPaid && scoped.some((doc) => doc.data().estado === 'pagada' || doc.data().movimientoCajaId)) {
    throw new Error('CUOTA_COUNT_MISMATCH');
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

  const created = await createPurchasePayables(businessId, params);
  return { cuotasCreated: created.cuotasCreated, cuotasUpdated: 0, cashMovementsFixed: 0 };
}

export type { PayableCuotaRecord };
