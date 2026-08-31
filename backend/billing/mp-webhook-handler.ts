import { getBusiness } from '../auth/business.ts';
import { activatePaidSubscription } from './activate-paid-subscription.ts';
import { activateUsagePack, isUsagePackId } from './activate-usage-pack.ts';
import { fetchMercadoPagoPayment, fetchMercadoPagoPaymentAnyCountry } from './mercadopago.ts';
import type { BillingCountryCode } from '../../shared/billing-catalog.ts';
import {
  fetchAuthorizedPaymentAnyCountry,
  fetchPreapprovalAnyCountry,
} from './preapproval.ts';
import { applyPreapprovalSnapshot, reconcileBusinessLifecycle } from './recurring.ts';
import {
  claimWebhookEvent,
  markWebhookProcessed,
  parseMercadoPagoWebhook,
  saveMpPayment,
} from './mp-webhooks.ts';
import { db } from '../firebase.ts';
import type { BillingInterval } from '../../shared/billing-catalog.ts';

function parseBillingInterval(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month';
}

async function persistAndActivatePayment(input: {
  country: BillingCountryCode;
  payment: NonNullable<Awaited<ReturnType<typeof fetchMercadoPagoPayment>>>;
  topic: string;
  preapprovalId?: string;
}): Promise<void> {
  const payment = input.payment;
  const meta = payment.metadata ?? {};
  let businessId = String(meta.businessId ?? meta.business_id ?? '').trim();
  let productId = String(meta.productId ?? meta.product_id ?? '').trim();
  let billingInterval = parseBillingInterval(meta.billingInterval ?? meta.billing_interval);
  let coverageMonths = Number(meta.coverageMonths ?? meta.coverage_months);

  if ((!businessId || !productId) && payment.externalReference) {
    const parts = payment.externalReference.split('|');
    businessId = businessId || parts[0] || '';
    productId = productId || parts[1] || '';
    if (parts[3] === 'year' || parts[3] === 'month') {
      billingInterval = parseBillingInterval(parts[3]);
    }
  }

  if (!businessId && input.preapprovalId) {
    const business = await findBusinessByPreapproval(input.preapprovalId);
    if (business) {
      businessId = business.id;
      productId = productId || String(business.billing?.productId ?? business.platformAccess?.trialProduct ?? '');
    }
  }

  if (!Number.isFinite(coverageMonths) || coverageMonths < 1) {
    coverageMonths = billingInterval === 'year' ? 12 : 1;
  }

  if (!businessId) {
    console.error('[billing] webhook missing business', payment.id);
    return;
  }

  await saveMpPayment({
    paymentId: payment.id,
    preapprovalId: input.preapprovalId || payment.preapprovalId || null,
    status: payment.status,
    grossAmount: payment.transactionAmount,
    feeAmount: payment.feeAmount ?? null,
    netAmount: payment.netAmount ?? null,
    currency: payment.currencyId,
    date: payment.dateApproved || payment.dateCreated || new Date().toISOString(),
    businessId,
    topic: input.topic,
    country: input.country,
  });

  const now = new Date().toISOString();
  await db.collection('negocios').doc(businessId).set(
    {
      billing: {
        lastPaymentStatus: payment.status,
        lastMercadoPagoPaymentId: payment.id,
        mpPreapprovalId: input.preapprovalId || payment.preapprovalId || undefined,
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );

  if (payment.status !== 'approved') {
    await reconcileBusinessLifecycle(businessId);
    return;
  }

  const kind = String(meta.kind ?? meta.Kind ?? '').trim();
  const packFromMeta = String(meta.packId ?? meta.pack_id ?? '').trim();
  const packId = isUsagePackId(packFromMeta)
    ? packFromMeta
    : productId.startsWith('pack-') && isUsagePackId(productId.slice(5))
      ? productId.slice(5)
      : null;

  if (kind === 'usage_pack' || packId) {
    if (!packId || !isUsagePackId(packId)) {
      console.error('[billing] usage pack missing packId', payment.id);
      return;
    }
    await activateUsagePack({
      businessId,
      packId,
      country: input.country,
      amount: payment.transactionAmount,
      currency: payment.currencyId,
      mercadoPagoPaymentId: payment.id,
    });
    return;
  }

  if (!productId) {
    const business = await getBusiness(businessId);
    productId = String(business?.billing?.productId ?? business?.platformAccess?.trialProduct ?? '');
  }
  if (!productId) {
    console.error('[billing] webhook missing product', payment.id);
    return;
  }

  const result = await activatePaidSubscription({
    businessId,
    productId,
    country: input.country,
    amount: payment.transactionAmount,
    currency: payment.currencyId,
    mercadoPagoPaymentId: payment.id,
    billingInterval,
    coverageMonths,
  });
  if (result.ok === false) {
    console.error('[billing] activate failed', result.reason);
  }
  await reconcileBusinessLifecycle(businessId);
}

async function findBusinessByPreapproval(preapprovalId: string) {
  const snap = await db
    .collection('negocios')
    .where('billing.mpPreapprovalId', '==', preapprovalId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return getBusiness(snap.docs[0].id);
}

export async function handleMercadoPagoWebhook(input: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): Promise<{ duplicate: boolean; topic: string; dataId: string }> {
  const parsed = parseMercadoPagoWebhook(input);
  if (!parsed.dataId) {
    return { duplicate: false, topic: parsed.topic, dataId: '' };
  }
  const claimed = await claimWebhookEvent(parsed.topic, parsed.dataId);
  if (claimed.duplicate) {
    return { duplicate: true, topic: parsed.topic, dataId: parsed.dataId };
  }

  try {
    if (parsed.topic === 'subscription_preapproval') {
      const fetched = await fetchPreapprovalAnyCountry(parsed.dataId);
      if (fetched) {
        const businessId =
          String(fetched.preapproval.externalReference ?? '').split('|')[0].trim() ||
          (await findBusinessByPreapproval(fetched.preapproval.id))?.id ||
          '';
        if (businessId) {
          await applyPreapprovalSnapshot({
            businessId,
            preapprovalId: fetched.preapproval.id,
            status: fetched.preapproval.status,
            nextPaymentDate: fetched.preapproval.nextPaymentDate,
            amount: fetched.preapproval.autoRecurring?.transactionAmount,
          });
          await reconcileBusinessLifecycle(businessId);
        }
      }
    } else if (parsed.topic === 'subscription_authorized_payment') {
      const authorized = await fetchAuthorizedPaymentAnyCountry(parsed.dataId);
      if (authorized) {
        const paymentId = authorized.payment.paymentId;
        if (paymentId) {
          const fetched = await fetchMercadoPagoPaymentAnyCountry(paymentId);
          if (fetched) {
            await persistAndActivatePayment({
              country: fetched.country,
              payment: fetched.payment,
              topic: parsed.topic,
              preapprovalId: authorized.payment.preapprovalId,
            });
          }
        } else if (authorized.payment.paymentStatus === 'rejected' || authorized.payment.status === 'rejected') {
          const business = authorized.payment.preapprovalId
            ? await findBusinessByPreapproval(authorized.payment.preapprovalId)
            : null;
          if (business) {
            const now = new Date().toISOString();
            await db.collection('negocios').doc(business.id).set(
              {
                billing: {
                  lastPaymentStatus: 'rejected',
                  mpPreapprovalId: authorized.payment.preapprovalId,
                  updatedAt: now,
                },
                updatedAt: now,
              },
              { merge: true }
            );
            await reconcileBusinessLifecycle(business.id);
          }
        }
      }
    } else if (parsed.topic === 'payment' || parsed.topic === 'unknown') {
      const fetched = await fetchMercadoPagoPaymentAnyCountry(parsed.dataId);
      if (fetched) {
        await persistAndActivatePayment({
          country: fetched.country,
          payment: fetched.payment,
          topic: 'payment',
          preapprovalId: fetched.payment.preapprovalId,
        });
      }
    }
    await markWebhookProcessed(claimed.key, { topic: parsed.topic, dataId: parsed.dataId });
  } catch (error) {
    console.error('[billing] webhook handler error', error);
    throw error;
  }

  return { duplicate: false, topic: parsed.topic, dataId: parsed.dataId };
}
