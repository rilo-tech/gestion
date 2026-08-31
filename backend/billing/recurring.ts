import { db } from '../firebase.ts';
import { getBusiness } from '../auth/business.ts';
import { quoteBusinessMonthly } from '../auth/commercial-pricing.ts';
import { resolveBillingCountry, type BillingCountryCode } from '../../shared/billing-catalog.ts';
import { resolveTrialState } from '../../shared/trial-state.ts';
import {
  isPreapprovalAutoRenewing,
  lifecycleToErpStatus,
  resolveSubscriptionLifecycle,
} from '../../shared/subscription-lifecycle.ts';
import {
  buildPreapprovalPayload,
  createPreapproval,
  fetchPreapproval,
  updatePreapprovalAmount,
  updatePreapprovalStatus,
} from './preapproval.ts';
import { isMercadoPagoConfigured } from './mercadopago.ts';

function appBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    'https://rilo-7eff4.web.app'
  ).replace(/\/$/, '');
}

function apiBaseUrl(): string {
  return `${appBaseUrl()}/api`;
}

function countryFromBusiness(business: NonNullable<Awaited<ReturnType<typeof getBusiness>>>): BillingCountryCode {
  return resolveBillingCountry(business.lifecycle?.pais);
}

export type RecurringSyncResult = {
  synced: boolean;
  requiresReauth: boolean;
  initPoint?: string;
  amount: number;
  currency: 'UYU' | 'ARS';
  preapprovalId?: string | null;
  status?: string | null;
  reason?: string;
};

export async function remainingTrialDaysFor(business: {
  enPrueba?: boolean;
  trialStatus?: string | null;
  trialEndDate?: string | null;
  trialStartDate?: string | null;
}): Promise<number> {
  const trial = resolveTrialState({
    enPrueba: business.enPrueba,
    trialStatus:
      business.trialStatus === 'active' ||
      business.trialStatus === 'expired' ||
      business.trialStatus === 'converted' ||
      business.trialStatus === 'cancelled'
        ? business.trialStatus
        : null,
    trialEndDate: business.trialEndDate,
    trialStartDate: business.trialStartDate,
  });
  if (!trial.isTrialBillingActive) return 0;
  return Math.max(0, trial.daysRemaining ?? 0);
}

export async function createAutoRenewCheckout(input: {
  businessId: string;
  payerEmail?: string;
}): Promise<RecurringSyncResult & { checkoutUrl?: string }> {
  const business = await getBusiness(input.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const country = countryFromBusiness(business);
  if (!isMercadoPagoConfigured(country)) {
    throw new Error('MP_NOT_CONFIGURED');
  }
  const email = String(input.payerEmail || business.contactVerification?.email || '').trim();
  if (!email) {
    throw new Error('PAYER_EMAIL_REQUIRED');
  }
  const quote = await quoteBusinessMonthly(input.businessId);
  const currency = quote.rates.currency;
  const amount = quote.total;
  if (!(amount > 0)) throw new Error('AMOUNT_INVALID');
  const trialDays = await remainingTrialDaysFor(business);
  const payload = buildPreapprovalPayload({
    reason: `RILO · ${quote.rates.productId} · ${input.businessId}`,
    payerEmail: email,
    externalReference: `${input.businessId}|${quote.rates.productId}|${country}|preapproval`,
    amount,
    currency,
    backUrl: `${appBaseUrl()}/activar-suscripcion?status=success&renew=1`,
    notificationUrl: `${apiBaseUrl()}/billing/webhooks/mercadopago`,
    remainingTrialDays: trialDays,
  });
  const created = await createPreapproval(country, payload);
  const now = new Date().toISOString();
  await db.collection('negocios').doc(input.businessId).set(
    {
      billing: {
        country,
        currency,
        productId: quote.rates.productId,
        autoRenew: false,
        mpPreapprovalId: created.id,
        mpPreapprovalStatus: created.status,
        mpQuotedAmount: amount,
        nextPaymentDate: created.nextPaymentDate ?? null,
        source: 'mercadopago_preapproval',
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );
  const useSandbox =
    process.env.MERCADOPAGO_USE_SANDBOX === 'true' && created.sandboxInitPoint;
  const checkoutUrl = useSandbox ? created.sandboxInitPoint : created.initPoint;
  return {
    synced: false,
    requiresReauth: true,
    initPoint: checkoutUrl,
    checkoutUrl,
    amount,
    currency,
    preapprovalId: created.id,
    status: created.status,
  };
}

export async function syncRecurringAmount(businessId: string): Promise<RecurringSyncResult> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const quote = await quoteBusinessMonthly(businessId);
  const amount = quote.total;
  const currency = quote.rates.currency;
  const preapprovalId = String(business.billing?.mpPreapprovalId ?? '').trim();
  const country = countryFromBusiness(business);
  if (!preapprovalId || !isPreapprovalAutoRenewing(business.billing?.mpPreapprovalStatus)) {
    return {
      synced: false,
      requiresReauth: false,
      amount,
      currency,
      preapprovalId: preapprovalId || null,
      status: business.billing?.mpPreapprovalStatus ?? null,
      reason: 'NO_ACTIVE_PREAPPROVAL',
    };
  }
  if (!isMercadoPagoConfigured(country)) {
    return {
      synced: false,
      requiresReauth: false,
      amount,
      currency,
      preapprovalId,
      reason: 'MP_NOT_CONFIGURED',
    };
  }
  try {
    const updated = await updatePreapprovalAmount(country, preapprovalId, amount, currency);
    const now = new Date().toISOString();
    await db.collection('negocios').doc(businessId).set(
      {
        billing: {
          mpQuotedAmount: amount,
          mpPreapprovalStatus: updated.status,
          nextPaymentDate: updated.nextPaymentDate ?? business.billing?.nextPaymentDate ?? null,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );
    const pendingReauth = updated.status === 'pending';
    return {
      synced: !pendingReauth,
      requiresReauth: pendingReauth,
      initPoint: pendingReauth ? updated.initPoint : undefined,
      amount,
      currency,
      preapprovalId,
      status: updated.status,
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 409 || status === 401) {
      const created = await createAutoRenewCheckout({
        businessId,
        payerEmail: business.contactVerification?.email,
      });
      return {
        ...created,
        synced: false,
        requiresReauth: true,
        reason: 'MP_REQUIRES_REAUTH',
      };
    }
    throw error;
  }
}

export async function pauseAutoRenew(businessId: string): Promise<RecurringSyncResult> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const preapprovalId = String(business.billing?.mpPreapprovalId ?? '').trim();
  const quote = await quoteBusinessMonthly(businessId);
  if (!preapprovalId) {
    const now = new Date().toISOString();
    await db.collection('negocios').doc(businessId).set(
      { billing: { autoRenew: false, updatedAt: now }, updatedAt: now },
      { merge: true }
    );
    return {
      synced: true,
      requiresReauth: false,
      amount: quote.total,
      currency: quote.rates.currency,
      reason: 'NO_PREAPPROVAL',
    };
  }
  const country = countryFromBusiness(business);
  const updated = await updatePreapprovalStatus(country, preapprovalId, 'paused');
  const now = new Date().toISOString();
  await db.collection('negocios').doc(businessId).set(
    {
      billing: {
        autoRenew: false,
        mpPreapprovalStatus: updated.status,
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );
  return {
    synced: true,
    requiresReauth: false,
    amount: quote.total,
    currency: quote.rates.currency,
    preapprovalId,
    status: updated.status,
  };
}

export async function cancelAutoRenew(businessId: string): Promise<RecurringSyncResult> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const preapprovalId = String(business.billing?.mpPreapprovalId ?? '').trim();
  const quote = await quoteBusinessMonthly(businessId);
  if (preapprovalId && isMercadoPagoConfigured(countryFromBusiness(business))) {
    await updatePreapprovalStatus(countryFromBusiness(business), preapprovalId, 'cancelled');
  }
  const now = new Date().toISOString();
  await db.collection('negocios').doc(businessId).set(
    {
      billing: {
        autoRenew: false,
        mpPreapprovalStatus: 'cancelled',
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );
  return {
    synced: true,
    requiresReauth: false,
    amount: quote.total,
    currency: quote.rates.currency,
    preapprovalId: preapprovalId || null,
    status: 'cancelled',
  };
}

export async function applyPreapprovalSnapshot(input: {
  businessId: string;
  preapprovalId: string;
  status: string;
  nextPaymentDate?: string;
  amount?: number;
}): Promise<void> {
  const autoRenew = isPreapprovalAutoRenewing(input.status);
  const now = new Date().toISOString();
  await db.collection('negocios').doc(input.businessId).set(
    {
      billing: {
        autoRenew,
        mpPreapprovalId: input.preapprovalId,
        mpPreapprovalStatus: input.status,
        nextPaymentDate: input.nextPaymentDate ?? null,
        mpQuotedAmount: input.amount,
        source: 'mercadopago_preapproval',
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );
}

export async function reconcileBusinessLifecycle(businessId: string): Promise<void> {
  const business = await getBusiness(businessId);
  if (!business) return;
  const status = resolveSubscriptionLifecycle({
    estadoSuscripcion: business.estadoSuscripcion,
    enPrueba: business.enPrueba,
    trialStatus: business.trialStatus,
    trialEndDate: business.trialEndDate,
    trialStartDate: business.trialStartDate,
    paidUntil: business.billing?.paidUntil,
    autoRenew: business.billing?.autoRenew,
    mpPreapprovalStatus: business.billing?.mpPreapprovalStatus,
    lastPaymentStatus: business.billing?.lastPaymentStatus,
  });
  const stored = business.billing?.lifecycleStatus;
  const erpStatus = lifecycleToErpStatus(status);
  const trialExpiredToInactive = status === 'inactive' && business.enPrueba === true;
  if (stored === status && business.estadoSuscripcion === erpStatus && !trialExpiredToInactive) {
    return;
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    billing: {
      lifecycleStatus: status,
      updatedAt: now,
    },
    estadoSuscripcion: erpStatus,
    updatedAt: now,
  };
  if (status === 'inactive' && business.enPrueba === true) {
    patch.enPrueba = false;
    patch.trialStatus = 'expired';
  }
  if (status === 'active' && business.enPrueba === true) {
    patch.enPrueba = false;
    patch.trialStatus = 'converted';
  }
  await db.collection('negocios').doc(businessId).set(patch, { merge: true });
}

export async function safeSyncRecurringAmount(businessId: string): Promise<RecurringSyncResult> {
  try {
    return await syncRecurringAmount(businessId);
  } catch (error) {
    console.error('[billing] sync recurring amount failed', businessId, error);
    return {
      synced: false,
      requiresReauth: false,
      amount: 0,
      currency: 'UYU',
      reason: 'SYNC_FAILED',
    };
  }
}

export async function refreshPreapprovalFromMercadoPago(
  country: BillingCountryCode,
  preapprovalId: string,
  businessId?: string
): Promise<void> {
  const preapproval = await fetchPreapproval(country, preapprovalId);
  if (!preapproval) return;
  const id =
    businessId ||
    String(preapproval.externalReference ?? '')
      .split('|')[0]
      .trim();
  if (!id) return;
  await applyPreapprovalSnapshot({
    businessId: id,
    preapprovalId: preapproval.id,
    status: preapproval.status,
    nextPaymentDate: preapproval.nextPaymentDate,
    amount: preapproval.autoRecurring?.transactionAmount,
  });
  await reconcileBusinessLifecycle(id);
}
