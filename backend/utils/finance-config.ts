import { slugifyOrigenGrupo } from './cash-origenes.ts';
import { BUSINESS_CASH_AMBITO_ID } from './caja-ambitos.ts';
import {
  DEFAULT_CATEGORIAS_GASTO,
  DEFAULT_MEDIOS_PAGO,
  medioPagoRequiereCuentaHija,
  syncMedioPagoFlags,
  type CategoriaGastoConfig,
  type MedioPagoComportamiento,
  type MedioPagoConfig,
  type TarjetaConfig,
} from '../../shared/finance-config.ts';

export type {
  CategoriaGastoConfig,
  MedioPagoComportamiento,
  MedioPagoConfig,
  PurchaseLineTipo,
  TarjetaConfig,
} from '../../shared/finance-config.ts';

export {
  DEFAULT_CATEGORIAS_GASTO,
  DEFAULT_MEDIOS_PAGO,
  enrichPurchasePago,
  findMedioPagoInConfig,
  findTarjetaInConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  normalizeMedioPagoLookupId,
  purchaseLineAffectsStock,
  resolvePurchasePagoDisplayLabel,
  syncMedioPagoFlags,
} from '../../shared/finance-config.ts';

export type { PurchasePagoShape } from '../../shared/finance-config.ts';

function normalizeComportamiento(value: unknown): MedioPagoComportamiento {
  if (value === 'cuotas' || value === 'proveedor') return value;
  return 'caja_inmediata';
}

function sortMedios(a: MedioPagoConfig, b: MedioPagoConfig): number {
  if (a.sistema && !b.sistema) return -1;
  if (!a.sistema && b.sistema) return 1;
  return a.label.localeCompare(b.label, 'es');
}

export function normalizeMediosPago(raw: unknown): MedioPagoConfig[] {
  const defaultById = new Map(
    DEFAULT_MEDIOS_PAGO.map((def) => [def.id, syncMedioPagoFlags({ ...def })])
  );

  if (!Array.isArray(raw) || raw.length === 0) {
    return [...defaultById.values()].sort(sortMedios);
  }

  const items: MedioPagoConfig[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? '').trim().toLowerCase();
    const label = String(obj.label ?? '').trim();
    if (!id || !label) continue;

    const def = defaultById.get(id);
    const requiereCuentaRaw =
      obj.requiereCuentaHija === true ||
      obj.requiereTarjeta === true ||
      (def?.requiereCuentaHija === true && obj.requiereCuentaHija !== false && obj.requiereTarjeta !== false);

    items.push(
      syncMedioPagoFlags({
        id,
        label,
        comportamiento: normalizeComportamiento(obj.comportamiento ?? def?.comportamiento),
        activo: obj.activo !== false,
        generaEgresoCaja:
          typeof obj.generaEgresoCaja === 'boolean'
            ? obj.generaEgresoCaja
            : def?.generaEgresoCaja,
        generaCuentasPagar:
          typeof obj.generaCuentasPagar === 'boolean'
            ? obj.generaCuentasPagar
            : def?.generaCuentasPagar,
        requiereCuentaHija: requiereCuentaRaw,
        requiereTarjeta: requiereCuentaRaw,
        sistema: def?.sistema === true || obj.sistema === true,
      })
    );
  }

  const savedIds = new Set(items.map((item) => item.id));
  const creditoDefault = defaultById.get('credito');
  if (creditoDefault && !savedIds.has('credito')) {
    items.push(syncMedioPagoFlags({ ...creditoDefault }));
  }

  return items.sort(sortMedios);
}

export function getMediosPagoConCuentaHija(medios: MedioPagoConfig[]): MedioPagoConfig[] {
  return medios.filter((medio) => medio.activo !== false && medioPagoRequiereCuentaHija(medio));
}

export function normalizeTarjetas(raw: unknown, medios: MedioPagoConfig[]): TarjetaConfig[] {
  if (!Array.isArray(raw)) return [];
  const cuentaMedioIds = getMediosPagoConCuentaHija(medios).map((m) => m.id);
  const fallbackMedioId =
    cuentaMedioIds.find((id) => id === 'tarjeta_credito') ??
    cuentaMedioIds[0] ??
    'tarjeta_credito';

  const items: TarjetaConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label ?? '').trim();
    if (!label) continue;
    const id = String(obj.id ?? slugifyOrigenGrupo(label)).trim().toLowerCase();
    if (!id || items.some((entry) => entry.id === id)) continue;

    const medioPagoId = String(obj.medioPagoId ?? fallbackMedioId).trim().toLowerCase();
    const row: TarjetaConfig = {
      id,
      label,
      ambitoDefault: String(obj.ambitoDefault ?? BUSINESS_CASH_AMBITO_ID).trim().toLowerCase(),
      medioPagoId: cuentaMedioIds.includes(medioPagoId) ? medioPagoId : fallbackMedioId,
      activa: obj.activa !== false,
    };

    const emisor = String(obj.emisor ?? '').trim();
    if (emisor) row.emisor = emisor;

    if (Number.isFinite(Number(obj.diaCierre))) {
      row.diaCierre = Number(obj.diaCierre);
    }
    if (Number.isFinite(Number(obj.diaVencimiento))) {
      row.diaVencimiento = Number(obj.diaVencimiento);
    }

    items.push(row);
  }

  return items.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function normalizeCategoriasGasto(raw: unknown): CategoriaGastoConfig[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_CATEGORIAS_GASTO.map((def) => ({ ...def })).sort((a, b) =>
      a.label.localeCompare(b.label, 'es')
    );
  }

  const byId = new Map<string, CategoriaGastoConfig>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label ?? '').trim();
    if (!label) continue;
    const id = String(obj.id ?? slugifyOrigenGrupo(label)).trim().toLowerCase();
    byId.set(id, {
      id,
      label,
      ambitoDefault: String(obj.ambitoDefault ?? BUSINESS_CASH_AMBITO_ID).trim().toLowerCase(),
      afectaReporteNegocio: obj.afectaReporteNegocio !== false,
    });
  }

  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function normalizeFinanzasConfig(raw: Record<string, unknown> = {}) {
  const mediosPago = normalizeMediosPago(raw.mediosPago);
  return {
    mediosPago,
    tarjetas: normalizeTarjetas(raw.tarjetas, mediosPago),
    categoriasGasto: normalizeCategoriasGasto(raw.categoriasGasto),
  };
}

export function getMedioPagoById(
  medios: MedioPagoConfig[],
  id: string | undefined | null
): MedioPagoConfig | undefined {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return medios.find((m) => m.id === key && m.activo !== false);
}

export function getTarjetaById(
  tarjetas: TarjetaConfig[],
  id: string | undefined | null
): TarjetaConfig | undefined {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return tarjetas.find((t) => t.id === key && t.activa !== false);
}

export function getCategoriaGastoById(
  categorias: CategoriaGastoConfig[],
  id: string | undefined | null
): CategoriaGastoConfig | undefined {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return categorias.find((c) => c.id === key);
}

export async function loadFinanzasConfig(businessId: string) {
  const { db } = await import('../firebase.ts');
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return normalizeFinanzasConfig({});
  const finanzas = (appDoc.data()?.finanzas as Record<string, unknown>) ?? {};
  return normalizeFinanzasConfig(finanzas);
}
