import { db } from '../firebase.ts';
import {
  getBusinessCashAmbitoId,
  normalizeMovementAmbito,
} from './caja-ambitos.ts';
import { getMedioPagoById, loadFinanzasConfig } from './finance-config.ts';

export interface CreateCashEgresoParams {
  monto: number;
  concepto: string;
  medioPagoId: string;
  ambito: string;
  origenId: string;
  origenTipo: string;
  origenGrupo?: 'compra' | 'manual' | 'otro';
  compraId?: string;
  compraLabel?: string;
  colaboradorId?: string;
  colaboradorNombre?: string;
  fecha?: string;
}

export async function createCashEgreso(
  businessId: string,
  params: CreateCashEgresoParams
): Promise<string> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (appDoc.data()?.caja as Record<string, unknown>) ?? {};
  const finanzas = await loadFinanzasConfig(businessId);
  const medio = getMedioPagoById(finanzas.mediosPago, params.medioPagoId);
  const medioLabel = medio?.label ?? params.medioPagoId;

  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'egreso',
    monto: params.monto,
    concepto: params.concepto,
    medio: medioLabel,
    medioPagoId: params.medioPagoId,
    ambito: normalizeMovementAmbito(params.ambito, caja),
    fecha: params.fecha ?? new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: params.origenGrupo ?? 'compra',
    compraId: params.compraId ?? null,
    compraLabel: params.compraLabel ?? null,
    colaboradorId: params.colaboradorId ?? null,
    colaboradorNombre: params.colaboradorNombre ?? null,
    negocioId: businessId,
  });

  return docRef.id;
}

export async function createCashEgresoForAmbitoTotals(
  businessId: string,
  totalsByAmbito: Map<string, number>,
  params: Omit<CreateCashEgresoParams, 'monto' | 'ambito'>
): Promise<Map<string, string>> {
  const movementIds = new Map<string, string>();
  for (const [ambito, monto] of totalsByAmbito) {
    if (monto <= 0) continue;
    const id = await createCashEgreso(businessId, {
      ...params,
      ambito,
      monto,
      concepto:
        totalsByAmbito.size > 1
          ? `${params.concepto} · ${ambito === getBusinessCashAmbitoId() ? 'Negocio' : ambito}`
          : params.concepto,
    });
    movementIds.set(ambito, id);
  }
  return movementIds;
}
