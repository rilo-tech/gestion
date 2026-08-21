import { db } from '../firebase.ts';
import { getBusiness, updateBusiness } from '../auth/business.ts';
import { registerSubscriptionCoverage } from '../auth/subscription-payments.ts';
import { seedBusinessWhatsappAccess } from '../whatsapp/seed-access.ts';
import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import { amountMonthlyFor } from '../../shared/commercial-catalog.ts';
import {
  getBillingProduct,
  type BillingCountryCode,
  type BillingInterval,
} from '../../shared/billing-catalog.ts';
import {
  isTrialProductId,
  mergePlatformAccessWithProduct,
  normalizePlatformAccess,
  type TrialProductId,
} from '../../shared/platform-access.ts';

export async function activatePaidSubscription(params: {
  businessId: string;
  productId: string;
  country: BillingCountryCode;
  amount: number;
  currency: string;
  mercadoPagoPaymentId: string;
  payerEmail?: string;
  billingInterval?: BillingInterval;
  coverageMonths?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const product = getBillingProduct(params.productId);
  if (!product || !isTrialProductId(params.productId)) {
    return { ok: false, reason: 'Producto inválido' };
  }

  const business = await getBusiness(params.businessId);
  if (!business) {
    return { ok: false, reason: 'Empresa no encontrada' };
  }

  const existing = await db
    .collection(`negocios/${params.businessId}/pagos_suscripcion`)
    .where('mercadoPagoPaymentId', '==', params.mercadoPagoPaymentId)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { ok: true };
  }

  const billingInterval: BillingInterval =
    params.billingInterval === 'year' ? 'year' : 'month';
  const coverageMonths = Math.max(
    1,
    Math.min(
      24,
      Math.floor(
        params.coverageMonths ?? (billingInterval === 'year' ? 12 : 1)
      )
    )
  );

  const now = new Date();
  const productId = params.productId as TrialProductId;
  const platformAccess = mergePlatformAccessWithProduct(
    normalizePlatformAccess(business.platformAccess),
    productId
  );

  const coverage = await registerSubscriptionCoverage(params.businessId, {
    coverageMonths,
    montoTotal: params.amount,
    fechaPago: now.toISOString(),
    notas: `Mercado Pago ${params.mercadoPagoPaymentId} · ${product.name} · ${params.currency}${
      billingInterval === 'year' ? ' · anual' : ''
    }`,
    mercadoPagoPaymentId: params.mercadoPagoPaymentId,
    currency: params.currency,
    productId,
    country: params.country,
    payerEmail: params.payerEmail,
  });

  // La cuota esperada es siempre el precio de lista. El % off de los primeros meses
  // es solo lo cobrado en este pago, no el precio permanente.
  const catalog = await getCommercialCatalog();
  const precioBaseMensual = amountMonthlyFor(catalog, productId, params.country);

  await updateBusiness(
    params.businessId,
    {
      planId: product.erpPlanId,
      estadoSuscripcion: 'activa',
      enPrueba: false,
      trialStatus: 'converted',
      platformAccess,
      suscripcion: {
        precioBaseOverride: precioBaseMensual,
        precioPorAdministradorOverride: 0,
      },
    },
    {
      allowSubscriptionFields: true,
      changedBy: 'system',
      historyNote: `Pago Mercado Pago aprobado (${params.mercadoPagoPaymentId}) — ${product.name} (${
        billingInterval === 'year' ? 'anual' : 'mensual'
      })`,
    }
  );

  if (platformAccess.whatsappEnabled) {
    await seedBusinessWhatsappAccess({
      businessId: params.businessId,
      phone: String(business.contactVerification?.phone ?? ''),
      ownerName: String(business.lifecycle?.ownerName ?? ''),
      trialProduct: platformAccess.trialProduct,
      forceLine: true,
      erpUserId: business.lifecycle?.ownerUserId ?? null,
      status: 'active',
    });
  }

  await db.collection('negocios').doc(params.businessId).set(
    {
      billing: {
        country: params.country,
        currency: params.currency,
        productId,
        billingInterval,
        paidUntil: coverage.paidUntil,
        lastMercadoPagoPaymentId: params.mercadoPagoPaymentId,
        source: 'mercadopago',
        updatedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    },
    { merge: true }
  );

  return { ok: true };
}
