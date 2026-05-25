import { slugifyOrigenGrupo } from './cash-origenes.ts';

export interface CajaAmbitoConfig {
  id: string;
  label: string;
}

export const DEFAULT_CASH_AMBITO_ID = 'general';

export function slugifyCajaAmbitoId(label: string): string {
  return slugifyOrigenGrupo(label);
}

export function normalizeCajaAmbitos(caja: Record<string, unknown> = {}): CajaAmbitoConfig[] {
  const raw = caja.ambitos;
  if (!Array.isArray(raw)) return [];

  const parsed: CajaAmbitoConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? '').trim().toLowerCase();
    const label = String(obj.label ?? '').trim();
    if (!id || !label || parsed.some((entry) => entry.id === id)) continue;
    parsed.push({ id, label });
  }

  return parsed.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function getDefaultCashAmbitoId(caja: Record<string, unknown> = {}): string {
  const ambitos = normalizeCajaAmbitos(caja);
  return ambitos[0]?.id ?? DEFAULT_CASH_AMBITO_ID;
}

export function usesCashAmbitoSeparationFromCaja(caja: Record<string, unknown> = {}): boolean {
  return normalizeCajaAmbitos(caja).length >= 2;
}

export function normalizeMovementAmbito(
  value: unknown,
  caja: Record<string, unknown> = {}
): string {
  const ambitos = normalizeCajaAmbitos(caja);
  const defaultId = getDefaultCashAmbitoId(caja);
  if (ambitos.length < 2) return defaultId;

  const raw = String(value ?? '').trim().toLowerCase();
  if (ambitos.some((entry) => entry.id === raw)) return raw;
  return defaultId;
}

export function getCashAmbitoLabelFromCaja(
  ambito: string,
  caja: Record<string, unknown> = {}
): string {
  const match = normalizeCajaAmbitos(caja).find((entry) => entry.id === ambito);
  return match?.label ?? ambito;
}
