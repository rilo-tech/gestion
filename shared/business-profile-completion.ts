import type { TrialLifecycle } from './trial-registration.ts';

const PLACEHOLDER_CITY = /^(a\s+completar)$/i;

export type BusinessProfileFields = Pick<TrialLifecycle, 'rubro' | 'pais' | 'ciudad'>;

/** Ciudad aún no definida (null, vacío o placeholder legacy "A completar"). */
export function isCityUnset(ciudad: string | null | undefined): boolean {
  const value = String(ciudad ?? '').trim();
  return !value || PLACEHOLDER_CITY.test(value);
}

/**
 * Perfil incompleto: falta rubro, país o ciudad real.
 * No bloquea el producto; solo indica onboarding pendiente.
 */
export function isBusinessProfileIncomplete(
  lifecycle?: BusinessProfileFields | null
): boolean {
  const rubro = String(lifecycle?.rubro ?? '').trim();
  const pais = String(lifecycle?.pais ?? '').trim();
  return !rubro || !pais || isCityUnset(lifecycle?.ciudad);
}

export function normalizeOptionalCity(ciudad: unknown): string | null {
  if (ciudad == null) return null;
  const value = String(ciudad).trim();
  if (!value || PLACEHOLDER_CITY.test(value)) return null;
  return value;
}
