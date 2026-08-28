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
  return normalizeCajaAmbitos(caja).length > 1;
}

export function parseCashAmbitoOrNull(
  value: unknown,
  caja: Record<string, unknown> = {}
): string | null {
  const ambitos = normalizeCajaAmbitos(caja);
  const raw = foldCashText(value);
  if (!raw) return null;
  if (ambitos.some((entry) => entry.id === raw)) return raw;
  const byLabel = ambitos.find((entry) => foldCashText(entry.label) === raw);
  return byLabel?.id ?? null;
}

function foldCashText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cashAmbitoTokens(ambito: CajaAmbitoConfig): string[] {
  const id = foldCashText(ambito.id);
  const label = foldCashText(ambito.label);
  const tokens = new Set<string>([id, label].filter((token) => token.length >= 2));
  if (id === 'personal' || /\bpersonal\b/.test(label)) {
    tokens.add('personal');
    tokens.add('mia');
    tokens.add('particular');
    tokens.add('propia');
  }
  if (id === BUSINESS_CASH_AMBITO_ID || LEGACY_BUSINESS_AMBITO_IDS.has(id) || /\bnegocio\b/.test(label)) {
    tokens.add('negocio');
    tokens.add('empresa');
    tokens.add('local');
    tokens.add('general');
    tokens.add('comercio');
  }
  return [...tokens];
}

/** «en personal», «caja del negocio», «la mía». Uno solo o null si no se entiende. */
export function matchCashAmbitoFromText(
  text: string,
  ambitos: CajaAmbitoConfig[]
): CajaAmbitoConfig | null {
  if (!ambitos.length) return null;
  const folded = foldCashText(text);
  if (!folded) return null;

  const hits: CajaAmbitoConfig[] = [];
  for (const ambito of ambitos) {
    const matched = cashAmbitoTokens(ambito).some((token) => {
      const re = new RegExp(`(?<![\\p{L}])${escapeRegExp(token)}(?![\\p{L}])`, 'iu');
      return re.test(folded);
    });
    if (matched) hits.push(ambito);
  }
  return hits.length === 1 ? hits[0]! : null;
}

export function formatCashAmbitoChoices(
  ambitos: CajaAmbitoConfig[],
  cashType?: 'ingreso' | 'egreso'
): string {
  const tipo = cashType === 'ingreso' ? 'el ingreso' : 'el egreso';
  const lines = [`¿En qué caja anoto ${tipo}?`, ''];
  ambitos.forEach((ambito, index) => {
    lines.push(`${index + 1}) ${ambito.label}`);
  });
  lines.push('');
  lines.push('*Cómo responder*');
  lines.push('• Un *número* o el nombre (negocio, personal, …)');
  lines.push('• *NO* — cancelar');
  return lines.join('\n');
}

export function normalizeMovementAmbito(
  value: unknown,
  caja: Record<string, unknown> = {}
): string {
  const ambitos = normalizeCajaAmbitos(caja);
  const businessId = getBusinessCashAmbitoId(caja);
  if (ambitos.length <= 1) return businessId;

  const parsed = parseCashAmbitoOrNull(value, caja);
  if (parsed) return parsed;
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
