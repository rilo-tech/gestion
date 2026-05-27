import { slugifyOrigenGrupo } from './cash-origenes.ts';

export interface CajaAmbitoConfig {
  id: string;
  label: string;
  /** Ámbito principal del negocio: no se puede quitar, solo renombrar. */
  sistema?: boolean;
}

/** Id fijo del ámbito donde caen pedidos, ventas y demás movimientos automáticos. */
export const BUSINESS_CASH_AMBITO_ID = 'negocio';

export const DEFAULT_BUSINESS_CASH_AMBITO_LABEL = 'Negocio';

/** @deprecated Usar BUSINESS_CASH_AMBITO_ID */
export const DEFAULT_CASH_AMBITO_ID = BUSINESS_CASH_AMBITO_ID;

const LEGACY_BUSINESS_AMBITO_IDS = new Set(['negocio', 'general', 'empresa']);

export function slugifyCajaAmbitoId(label: string): string {
  return slugifyOrigenGrupo(label);
}

function isBusinessAmbitoId(id: string): boolean {
  return id === BUSINESS_CASH_AMBITO_ID;
}

export function isSystemCashAmbito(ambito: Pick<CajaAmbitoConfig, 'id' | 'sistema'>): boolean {
  return ambito.sistema === true || isBusinessAmbitoId(ambito.id);
}

export function normalizeCajaAmbitos(caja: Record<string, unknown> = {}): CajaAmbitoConfig[] {
  const raw = caja.ambitos;
  const extras: CajaAmbitoConfig[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const id = String(obj.id ?? '').trim().toLowerCase();
      const label = String(obj.label ?? '').trim();
      if (!id || !label || isBusinessAmbitoId(id)) continue;
      if (extras.some((entry) => entry.id === id)) continue;
      extras.push({ id, label, sistema: false });
    }
  }

  let businessLabel = DEFAULT_BUSINESS_CASH_AMBITO_LABEL;
  if (Array.isArray(raw)) {
    const businessEntry = raw.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const id = String((item as Record<string, unknown>).id ?? '')
        .trim()
        .toLowerCase();
      return isBusinessAmbitoId(id) || LEGACY_BUSINESS_AMBITO_IDS.has(id);
    }) as Record<string, unknown> | undefined;
    const savedLabel = String(businessEntry?.label ?? '').trim();
    if (savedLabel) businessLabel = savedLabel;
  }

  const business: CajaAmbitoConfig = {
    id: BUSINESS_CASH_AMBITO_ID,
    label: businessLabel,
    sistema: true,
  };

  extras.sort((a, b) => a.label.localeCompare(b.label, 'es'));
  return [business, ...extras];
}

export function getBusinessCashAmbitoId(_caja: Record<string, unknown> = {}): string {
  return BUSINESS_CASH_AMBITO_ID;
}

export function getDefaultCashAmbitoId(caja: Record<string, unknown> = {}): string {
  return getBusinessCashAmbitoId(caja);
}

export function usesCashAmbitoSeparationFromCaja(caja: Record<string, unknown> = {}): boolean {
  return normalizeCajaAmbitos(caja).length >= 1;
}

export function normalizeMovementAmbito(
  value: unknown,
  caja: Record<string, unknown> = {}
): string {
  const ambitos = normalizeCajaAmbitos(caja);
  const businessId = getBusinessCashAmbitoId(caja);
  if (ambitos.length <= 1) return businessId;

  const raw = String(value ?? '').trim().toLowerCase();
  if (raw && ambitos.some((entry) => entry.id === raw)) return raw;
  return businessId;
}

/** Al anular, conserva el ámbito original si sigue siendo válido. */
export function resolveCashReversalAmbito(
  originalAmbito: unknown,
  caja: Record<string, unknown> = {}
): string {
  return normalizeMovementAmbito(originalAmbito, caja);
}

export function getCashAmbitoLabelFromCaja(
  ambito: string,
  caja: Record<string, unknown> = {}
): string {
  const match = normalizeCajaAmbitos(caja).find((entry) => entry.id === ambito);
  return match?.label ?? ambito;
}
