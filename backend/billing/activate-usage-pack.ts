import { db } from '../firebase.ts';
import { getBusiness } from '../auth/business.ts';
import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import { usagePeriod } from '../auth/usage-meter.ts';
import {
  usagePackAmountFor,
  type UsagePackId,
} from '../../shared/commercial-catalog.ts';
import type { BillingCountryCode } from '../../shared/billing-catalog.ts';

export function isUsagePackId(value: unknown): value is UsagePackId {
  return value === 'whatsapp' || value === 'ai';
}

export async function activateUsagePack(params: {
  businessId: string;
  packId: UsagePackId;
  country: BillingCountryCode;
  amount: number;
  currency: string;
  mercadoPagoPaymentId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const business = await getBusiness(params.businessId);
  if (!business) return { ok: false, reason: 'Empresa no encontrada' };

  const catalog = await getCommercialCatalog();
  const pack = catalog.usagePacks[params.packId];
  if (!pack || pack.quantity <= 0) {
    return { ok: false, reason: 'Pack inválido' };
  }
  const expected = usagePackAmountFor(catalog, params.packId, params.country);
  if (expected > 0 && params.amount + 1 < expected * 0.5) {
    console.warn('[billing] usage pack amount low', params);
  }

  const field = params.packId === 'whatsapp' ? 'purchasedWhatsapp' : 'purchasedAi';
  const payRef = db.doc(
    `negocios/${params.businessId}/private/usage_pack_payments/${params.mercadoPagoPaymentId}`
  );
  const period = usagePeriod();
  const meterRef = db.doc(`negocios/${params.businessId}/private/usage_${period}`);

  await db.runTransaction(async (tx) => {
    const paySnap = await tx.get(payRef);
    if (paySnap.exists) return;
    const meterSnap = await tx.get(meterRef);
    const current = Math.max(0, Number(meterSnap.data()?.[field]) || 0);
    const now = new Date().toISOString();
    tx.set(payRef, {
      packId: params.packId,
      quantity: pack.quantity,
      amount: params.amount,
      currency: params.currency,
      country: params.country,
      mercadoPagoPaymentId: params.mercadoPagoPaymentId,
      createdAt: now,
    });
    tx.set(
      meterRef,
      {
        period,
        [field]: current + pack.quantity,
        waQuotaNotified: false,
        waQuotaWarned80: false,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  return { ok: true };
}
