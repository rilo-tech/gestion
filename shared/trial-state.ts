export const DEFAULT_TRIAL_DAYS = 20;

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

function toDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addTrialDays(start: Date, days: number): string {
  const next = new Date(start);
  next.setDate(next.getDate() + days);
  return dateOnlyIso(next);
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
