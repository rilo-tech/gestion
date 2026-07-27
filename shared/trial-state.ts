import type { TrialProductId } from './platform-access.ts';

/** Días de prueba por producto (plan comercial). */
export const TRIAL_DAYS_BY_PRODUCT: Record<TrialProductId, number> = {
  whatsapp: 10,
  erp: 20,
  completo: 20,
};

/** RiloBot: valor rápido el primer día. */
export const RILOBOT_TRIAL_DAYS = TRIAL_DAYS_BY_PRODUCT.whatsapp;

/** Panel / Completo: más tiempo de aprendizaje. */
export const PANEL_TRIAL_DAYS = TRIAL_DAYS_BY_PRODUCT.erp;

/** Default genérico (Panel). Preferir trialDaysForProduct. */
export const DEFAULT_TRIAL_DAYS = PANEL_TRIAL_DAYS;

export function trialDaysForProduct(product: TrialProductId | null | undefined): number {
  if (product && product in TRIAL_DAYS_BY_PRODUCT) {
    return TRIAL_DAYS_BY_PRODUCT[product];
  }
  return DEFAULT_TRIAL_DAYS;
}

export type TrialStatus = 'active' | 'expired' | 'converted' | 'cancelled';

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  active: 'Prueba activa',
  expired: 'Prueba vencida',
  converted: 'Convertida a pago',
  cancelled: 'Prueba cancelada',
};

export interface TrialStateInput {
  enPrueba?: boolean;
  trialStartDate?: string | null;
  trialEndDate?: string | null;
  trialStatus?: TrialStatus | null;
}

export interface ResolvedTrialState {
  enPrueba: boolean;
  trialStartDate: string | null;
  trialEndDate: string | null;
  trialStatus: TrialStatus | null;
  /** Prueba vigente para cobros y badge «en prueba». */
  isTrialBillingActive: boolean;
  daysRemaining: number | null;
  isExpiringSoon: boolean;
}

/** Zona horaria comercial (UY/AR) para conteo de días de prueba. */
export const TRIAL_CALENDAR_TIMEZONE = 'America/Montevideo';

function toDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** YYYY-MM-DD en zona comercial (no UTC del servidor). */
export function dateOnlyIso(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TRIAL_CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Suma días calendario sobre una fecha YYYY-MM-DD (sin depender del TZ del host). */
export function addTrialDays(start: Date, days: number): string {
  const startIso = dateOnlyIso(start);
  const [year, month, day] = startIso.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + days));
  return [
    end.getUTCFullYear(),
    String(end.getUTCMonth() + 1).padStart(2, '0'),
    String(end.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function defaultTrialRange(
  start = new Date(),
  days = DEFAULT_TRIAL_DAYS
): { trialStartDate: string; trialEndDate: string } {
  return {
    trialStartDate: dateOnlyIso(start),
    trialEndDate: addTrialDays(start, days),
  };
}

export function resolveTrialState(
  input: TrialStateInput,
  now = new Date()
): ResolvedTrialState {
  const enPrueba = input.enPrueba === true;
  const trialStartDate = input.trialStartDate ? String(input.trialStartDate).slice(0, 10) : null;
  const trialEndDate = input.trialEndDate ? String(input.trialEndDate).slice(0, 10) : null;
  let trialStatus = input.trialStatus ?? null;

  if (!enPrueba) {
    return {
      enPrueba: false,
      trialStartDate,
      trialEndDate,
      trialStatus,
      isTrialBillingActive: false,
      daysRemaining: null,
      isExpiringSoon: false,
    };
  }

  const end = toDateOnly(trialEndDate);
  const today = toDateOnly(dateOnlyIso(now))!;

  if (trialStatus === 'active' && end && end < today) {
    trialStatus = 'expired';
  }

  let daysRemaining: number | null = null;
  if (end) {
    const ms = end.getTime() - today.getTime();
    daysRemaining = Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  const isTrialBillingActive =
    enPrueba && trialStatus === 'active' && (daysRemaining === null || daysRemaining >= 0);

  return {
    enPrueba,
    trialStartDate,
    trialEndDate,
    trialStatus,
    isTrialBillingActive,
    daysRemaining,
    isExpiringSoon:
      isTrialBillingActive && daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 3,
  };
}
