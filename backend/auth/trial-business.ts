import { db } from '../firebase.ts';
import {
  defaultTrialRange,
  resolveTrialState,
  type TrialStatus,
} from '../../shared/trial-state.ts';
import type { BusinessRecord } from './business.ts';

function businessRef(businessId: string) {
  return db.collection('negocios').doc(businessId);
}

export function parseTrialStatus(value: unknown): TrialStatus | null {
  if (
    value === 'active' ||
    value === 'expired' ||
    value === 'converted' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return null;
}

export function buildTrialFieldUpdates(
  payload: Record<string, unknown>,
  current?: BusinessRecord
): Partial<
  Pick<BusinessRecord, 'enPrueba' | 'trialStartDate' | 'trialEndDate' | 'trialStatus'>
> {
  const next: Partial<
    Pick<BusinessRecord, 'enPrueba' | 'trialStartDate' | 'trialEndDate' | 'trialStatus'>
  > = {};

  if (payload.enPrueba !== undefined) {
    next.enPrueba = payload.enPrueba === true;
  }
  if (typeof payload.trialStartDate === 'string' && payload.trialStartDate.trim()) {
    next.trialStartDate = payload.trialStartDate.trim().slice(0, 10);
  }
  if (typeof payload.trialEndDate === 'string' && payload.trialEndDate.trim()) {
    next.trialEndDate = payload.trialEndDate.trim().slice(0, 10);
  }
  if (payload.trialStatus !== undefined) {
    next.trialStatus = parseTrialStatus(payload.trialStatus);
  }

  const willBeOnTrial =
    next.enPrueba === true || (next.enPrueba === undefined && current?.enPrueba === true);

  if (next.enPrueba === true) {
    if (!current?.trialStartDate && !next.trialStartDate) {
      const range = defaultTrialRange();
      next.trialStartDate = range.trialStartDate;
      next.trialEndDate = range.trialEndDate;
    }
    if (!next.trialStatus) {
      next.trialStatus =
        current?.trialStatus === 'expired' || current?.trialStatus === 'cancelled'
          ? 'active'
          : (current?.trialStatus ?? 'active');
    }
  }

  if (next.enPrueba === false && next.trialStatus === undefined) {
    if (current?.trialStatus === 'active' || current?.trialStatus === 'expired') {
      next.trialStatus = 'converted';
    }
  }

  if (!willBeOnTrial && next.trialStatus === undefined && payload.trialAction === 'cancel') {
    next.trialStatus = 'cancelled';
  }

  return next;
}

export async function syncExpiredTrialStatus(
  business: BusinessRecord
): Promise<BusinessRecord> {
  const trial = resolveTrialState(business);
  if (
    business.enPrueba &&
    trial.trialStatus === 'expired' &&
    business.trialStatus !== 'expired'
  ) {
    await businessRef(business.id).update({
      trialStatus: 'expired',
      updatedAt: new Date().toISOString(),
    });
    return { ...business, trialStatus: 'expired' };
  }
  return business;
}

export function isTrialActiveForBilling(business: BusinessRecord): boolean {
  return resolveTrialState(business).isTrialBillingActive;
}
