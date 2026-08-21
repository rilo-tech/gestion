import express from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.ts';
import { getBusiness } from '../auth/business.ts';
import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import {
  discountedMonthly,
  hasIntroDiscount,
  introMonthsRemaining,
  overlayProductsForCountry,
} from '../../shared/commercial-catalog.ts';
import { countSubscriptionPaymentPeriods } from '../auth/subscription-payments.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';
import {
  resolveBillingCountry,
  getBillingProduct,
  resolveCheckoutAmount,
  type BillingCountryCode,
  type BillingInterval,
} from '../../shared/billing-catalog.ts';
import {
  createCheckoutPreference,
  fetchMercadoPagoPaymentAnyCountry,
  isMercadoPagoConfigured,
} from '../billing/mercadopago.ts';
import { activatePaidSubscription } from '../billing/activate-paid-subscription.ts';

const router = express.Router();

function parseBillingInterval(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month';
}

function appBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    'https://rilo-7eff4.web.app'
  ).replace(/\/$/, '');
}

function apiBaseUrl(): string {
  // En prod el webhook llega por hosting rewrite /api/**
  return `${appBaseUrl()}/api`;
}

function countryFromBusiness(business: Awaited<ReturnType<typeof getBusiness>>): BillingCountryCode {
  const lifecycle = (business as { lifecycle?: { pais?: string } } | null)?.lifecycle;
  return resolveBillingCountry(lifecycle?.pais);
}

router.get('/plans', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    if (!businessId) {
      return res.status(401).json({ error: 'No autenticado.' });
    }

    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    const country = countryFromBusiness(business);
    const catalog = await getCommercialCatalog();
    const products = overlayProductsForCountry(catalog, country);
    const configured = isMercadoPagoConfigured(country);
    const paymentsUsed = await countSubscriptionPaymentPeriods(businessId);

    res.json({
      available: configured,
      country,
      currency: country === 'AR' ? 'ARS' : 'UYU',
      trialWithoutCard: true,
      trialDays: catalog.trialDays,
      lite: catalog.lite,
      introDiscountMonths: catalog.introDiscountMonths,
      introDiscountPercent: catalog.introDiscountPercent,
      introMonthsRemaining: introMonthsRemaining(paymentsUsed, catalog),
      message: configured
        ? null
        : `Mercado Pago aún no configurado para ${country}. Contactá a soporte.`,
      products,
    });
  } catch (error) {
    console.error('[billing] plans error', error);
    res.status(500).json({ error: 'No se pudieron cargar los planes.' });
  }
});

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    const userEmail =
      authReq.auth?.scope === 'company' ? authReq.auth.user.email : undefined;
    if (!businessId) {
      return res.status(401).json({ error: 'No autenticado.' });
    }

    const productId = String(req.body?.productId ?? '').trim();
    const product = getBillingProduct(productId);
    if (!product) {
      return res.status(400).json({ error: 'Producto inválido.' });
    }

    const billingInterval = parseBillingInterval(req.body?.billingInterval);

    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    const currentAccess = normalizePlatformAccess(business.platformAccess);
    if (
      (productId === 'whatsapp' || productId === 'completo') &&
      currentAccess.whatsappEnabled !== true
    ) {
      const phone = String(business.contactVerification?.phone ?? '').trim();
      const verified = business.contactVerification?.phoneVerified === true;
      if (!phone || !verified) {
        return res.status(400).json({
          error: 'Antes de pagar RILO Bot tenés que confirmar el celular en Mi cuenta.',
          code: 'WHATSAPP_PHONE_REQUIRED',
        });
      }
    }

    const country = countryFromBusiness(business);
    if (!isMercadoPagoConfigured(country)) {
      return res.status(503).json({
        error: `El pago online para ${country} todavía no está habilitado. Escribinos por WhatsApp.`,
        country,
      });
    }

    const catalog = await getCommercialCatalog();
    const priced = overlayProductsForCountry(catalog, country).find((row) => row.id === productId);
    if (!priced) {
      return res.status(400).json({ error: 'Sin precio para este país.' });
    }

    const checkout = resolveCheckoutAmount(priced.amountMonthly, billingInterval);
    const paymentsUsed = await countSubscriptionPaymentPeriods(businessId);
    const introLeft = introMonthsRemaining(paymentsUsed, catalog);
    const introApplied =
      billingInterval === 'month' && introLeft > 0 && hasIntroDiscount(catalog);
    const unitPrice = introApplied
      ? discountedMonthly(priced.amountMonthly, catalog.introDiscountPercent)
      : checkout.amount;
    const titleSuffix = introApplied
      ? `1 mes · ${catalog.introDiscountPercent}% off`
      : checkout.titleSuffix;
    const externalReference = `${businessId}|${productId}|${country}|${billingInterval}|${Date.now()}`;
    const base = appBaseUrl();

    const preference = await createCheckoutPreference({
      country,
      currency: priced.currency,
      title: `RILO · ${product.name} (${titleSuffix})`,
      unitPrice,
      externalReference,
      metadata: {
        businessId,
        productId,
        country,
        billingInterval,
        coverageMonths: String(checkout.coverageMonths),
        introApplied: introApplied ? 'true' : 'false',
      },
      payerEmail: userEmail || undefined,
      successUrl: `${base}/activar-suscripcion?status=success`,
      failureUrl: `${base}/activar-suscripcion?status=failure`,
      pendingUrl: `${base}/activar-suscripcion?status=pending`,
      notificationUrl: `${apiBaseUrl()}/billing/webhooks/mercadopago`,
    });

    const useSandbox =
      process.env.MERCADOPAGO_USE_SANDBOX === 'true' && preference.sandboxInitPoint;

    res.json({
      preferenceId: preference.id,
      checkoutUrl: useSandbox ? preference.sandboxInitPoint : preference.initPoint,
      country,
      currency: priced.currency,
      amount: unitPrice,
      billingInterval,
      coverageMonths: checkout.coverageMonths,
      introApplied,
      productId,
    });
  } catch (error) {
    console.error('[billing] checkout error', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'No se pudo iniciar el pago.',
    });
  }
});

/** Webhook Mercado Pago (sin auth JWT). */
router.post('/webhooks/mercadopago', async (req, res) => {
  try {
    const topic = String(req.query.topic ?? req.query.type ?? req.body?.type ?? '').toLowerCase();
    const paymentId = String(
      req.query['data.id'] ?? req.body?.data?.id ?? req.body?.id ?? ''
    ).trim();

    // MP a veces manda topic=merchant_order; nos interesan payments
    if (topic && topic !== 'payment' && !paymentId) {
      return res.sendStatus(200);
    }

    if (!paymentId) {
      return res.sendStatus(200);
    }

    const fetched = await fetchMercadoPagoPaymentAnyCountry(paymentId);
    if (!fetched) {
      console.warn('[billing] webhook payment not found', paymentId);
      return res.sendStatus(200);
    }

    const { country, payment } = fetched;
    if (payment.status !== 'approved') {
      return res.sendStatus(200);
    }

    const meta = payment.metadata ?? {};
    let businessId = String(meta.businessId ?? meta.business_id ?? '').trim();
    let productId = String(meta.productId ?? meta.product_id ?? '').trim();
    let billingInterval = parseBillingInterval(
      meta.billingInterval ?? meta.billing_interval
    );
    let coverageMonths = Number(meta.coverageMonths ?? meta.coverage_months);

    if ((!businessId || !productId) && payment.externalReference) {
      const parts = payment.externalReference.split('|');
      businessId = businessId || parts[0] || '';
      productId = productId || parts[1] || '';
      if (parts[3] === 'year' || parts[3] === 'month') {
        billingInterval = parseBillingInterval(parts[3]);
      }
    }

    if (!Number.isFinite(coverageMonths) || coverageMonths < 1) {
      coverageMonths = billingInterval === 'year' ? 12 : 1;
    }

    if (!businessId || !productId) {
      console.error('[billing] webhook missing business/product', payment);
      return res.sendStatus(200);
    }

    const result = await activatePaidSubscription({
      businessId,
      productId,
      country,
      amount: payment.transactionAmount,
      currency: payment.currencyId,
      mercadoPagoPaymentId: payment.id,
      billingInterval,
      coverageMonths,
    });

    if (!result.ok) {
      console.error('[billing] activate failed', result.reason);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[billing] webhook error', error);
    res.sendStatus(200);
  }
});

export default router;
