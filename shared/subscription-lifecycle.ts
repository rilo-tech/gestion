import { resolveTrialState, type TrialStatus } from './trial-state.ts';

/** Estados comerciales de la EF. Inactive no borra datos. */
export type SubscriptionLifecycleStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'inactive'
  | 'archived';

export type MercadoPagoPreapprovalStatus =
  | 'pending'
  | 'authorized'
  | 'paused'
  | 'cancelled'
  | 'canceled'
  | 'finished';

export function normalizePreapprovalStatus(
  value: unknown
): MercadoPagoPreapprovalStatus | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (
    raw === 'pending' ||
    raw === 'authorized' ||
    raw === 'paused' ||
    raw === 'cancelled' ||
    raw === 'canceled' ||
    raw === 'finished'
  ) {
    return raw;
  }
  return null;
}

export function isPreapprovalAutoRenewing(status: unknown): boolean {
  return normalizePreapprovalStatus(status) === 'authorized';
}

function hasPaidCoverage(paidUntil?: string | null, at = new Date()): boolean {
  const raw = String(paidUntil ?? '').trim();
  if (!raw) return false;
  const date = new Date(raw.includes('T') ? raw : `${raw.slice(0, 10)}T23:59:59`);
  return !Number.isNaN(date.getTime()) && date.getTime() >= at.getTime();
}

export function resolveSubscriptionLifecycle(input: {
  archived?: boolean;
  estadoSuscripcion?: string;
  enPrueba?: boolean;
  trialStatus?: string | null;
  trialEndDate?: string | null;
  trialStartDate?: string | null;
  paidUntil?: string | null;
  autoRenew?: boolean;
  mpPreapprovalStatus?: string | null;
  lastPaymentStatus?: string | null;
  at?: Date;
}): SubscriptionLifecycleStatus {
  if (input.archived === true || input.estadoSuscripcion === 'archivada') {
    return 'archived';
  }

  const at = input.at ?? new Date();
  const paid = hasPaidCoverage(input.paidUntil, at);
  const trialStatusRaw = String(input.trialStatus ?? '').trim();
  const trialStatus: TrialStatus | null =
    trialStatusRaw === 'active' ||
    trialStatusRaw === 'expired' ||
    trialStatusRaw === 'converted' ||
    trialStatusRaw === 'cancelled'
      ? trialStatusRaw
      : null;
  const trial = resolveTrialState(
    {
      enPrueba: input.enPrueba,
      trialStatus,
      trialEndDate: input.trialEndDate,
      trialStartDate: input.trialStartDate,
    },
    at
  );
  const autoRenew =
    input.autoRenew === true || isPreapprovalAutoRenewing(input.mpPreapprovalStatus);
  const lastPayment = String(input.lastPaymentStatus ?? '').trim().toLowerCase();
  const paymentFailed =
    lastPayment === 'rejected' ||
    lastPayment === 'cancelled' ||
    lastPayment === 'canceled' ||
    lastPayment === 'refunded';

  if (trial.isTrialBillingActive) return 'trial';
  if (paymentFailed) return 'past_due';
  if (paid || autoRenew) return 'active';
  return 'inactive';
}

export function lifecycleToErpStatus(
  status: SubscriptionLifecycleStatus
): 'activa' | 'suspendida' | 'vencida' {
  if (status === 'active' || status === 'trial') return 'activa';
  if (status === 'past_due') return 'vencida';
  return 'suspendida';
}

export function webhookIdempotencyKey(topic: string, dataId: string): string {
  const safeTopic = String(topic ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 80);
  const safeId = String(dataId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
  return `${safeTopic || 'unknown'}:${safeId || 'none'}`;
}
