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
}

export async function payCardStatement(
  businessId: string,
  input: PayCardStatementInput
): Promise<{
  cuotasPagadas: number;
  total: number;
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

  const cuotaIds = targets.flatMap((entry) => entry.cuotaIds);
  const total = Math.round(targets.reduce((acc, entry) => acc + entry.total, 0) * 100) / 100;

  const totalsByAmbito = new Map<string, number>();
  for (const entry of targets) {
    totalsByAmbito.set(
      entry.ambito,
      Math.round(((totalsByAmbito.get(entry.ambito) ?? 0) + entry.total) * 100) / 100
    );
  }

  const mesLabel = input.mes;
  const conceptoBase = `Resumen ${tarjeta.label} · ${mesLabel}`;
  const movementMap = await createCashEgresoForAmbitoTotals(businessId, totalsByAmbito, {
    concepto: conceptoBase,
    medioPagoId: input.medioPagoId,
    origenId: `tarjeta_${input.tarjetaId}_${input.mes}`,
    origenTipo: 'tarjeta_resumen',
    origenGrupo: 'compra',
  });

  const now = new Date().toISOString();
  const batch = db.batch();
  const movementIds = [...movementMap.values()];

  for (const target of targets) {
    const movimientoCajaId = movementMap.get(target.ambito) ?? movementIds[0] ?? null;
    for (const cuotaId of target.cuotaIds) {
      batch.update(cuotasCollection(businessId).doc(cuotaId), {
        estado: 'pagada',
        fechaPago: now,
        movimientoCajaId: movimientoCajaId,
        pagoResumenMes: input.mes,
        pagoResumenTarjetaId: input.tarjetaId,
      });
    }
  }

  await batch.commit();

  return {
    cuotasPagadas: cuotaIds.length,
    total,
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

  const { cuotasCreated, obligation } = await createPayableObligation(businessId, {
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

  // Patch cuotas with purchase link metadata (createPayableObligation already set obligation fields)
  const cuotasSnap = await cuotasCollection(businessId)
    .where('obligacionId', '==', obligation.id)
    .get();

  const batch = db.batch();
  for (const doc of cuotasSnap.docs) {
    const data = doc.data();
    const numero = Number(data.numeroCuota) || 1;
    batch.update(doc.ref, {
      compraId: params.compraId,
      compraLabel: params.compraLabel,
      tarjetaId: params.tarjetaId,
      tarjetaLabel: params.tarjetaLabel,
      medioPagoId: params.medioPagoId,
      cuotaTotal: cuotas,
      origenTipo: 'compra',
      descripcion: `Cuota ${numero}/${cuotas} · Compra #${params.compraLabel} · ${descripcionBase} · ${params.tarjetaLabel}`,
    });
  }
  await batch.commit();

  return { cuotasCreated };
}

export type { PayableCuotaRecord };
