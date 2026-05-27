export interface CajaAmbitoConfig {
  id: string;
  label: string;
  sistema?: boolean;
}

export const BUSINESS_CASH_AMBITO_ID = 'negocio';

export const DEFAULT_BUSINESS_CASH_AMBITO_LABEL = 'Negocio';

export const DEFAULT_CASH_AMBITO_ID = BUSINESS_CASH_AMBITO_ID;

const LEGACY_BUSINESS_AMBITO_IDS = new Set(['negocio', 'general', 'empresa']);

function isBusinessAmbitoId(id: string): boolean {
  return id === BUSINESS_CASH_AMBITO_ID;
}

export function isSystemCashAmbito(ambito: Pick<CajaAmbitoConfig, 'id' | 'sistema'>): boolean {
  return ambito.sistema === true || isBusinessAmbitoId(ambito.id);
}

export function normalizeCajaAmbitos(caja: { ambitos?: unknown } = {}): CajaAmbitoConfig[] {
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

export function getBusinessCashAmbitoId(): string {
  return BUSINESS_CASH_AMBITO_ID;
}

export function getDefaultCashAmbitoId(config?: { caja?: { ambitos?: unknown } }): string {
  return getBusinessCashAmbitoId();
}

export function usesCashAmbitoSeparation(config: { caja?: { ambitos?: unknown } }): boolean {
  return normalizeCajaAmbitos(config.caja ?? {}).length >= 1;
}

export function resolveCashAmbito(
  movement: { ambito?: string } | undefined,
  config: { caja?: { ambitos?: unknown } } = {}
): string {
  const ambitos = normalizeCajaAmbitos(config.caja ?? {});
  const businessId = getBusinessCashAmbitoId();
  if (ambitos.length <= 1) return businessId;

  const raw = String(movement?.ambito ?? '').trim().toLowerCase();
  if (raw && ambitos.some((entry) => entry.id === raw)) return raw;
  return businessId;
}

export function getCashAmbitoLabel(
  ambito: string,
  config: { caja?: { ambitos?: unknown } } = {}
): string {
  const match = normalizeCajaAmbitos(config.caja ?? {}).find((entry) => entry.id === ambito);
  return match?.label ?? ambito;
}
