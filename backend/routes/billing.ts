import express from 'express';
import { requireAuth, requireSupervisor, type AuthenticatedRequest } from '../auth/middleware.ts';
import { getBusiness } from '../auth/business.ts';
import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import {
  discountedMonthly,
  hasIntroDiscount,
  introMonthsRemaining,
  overlayProductsForCountry,
  overlayUsagePacksForCountry,
  usagePackAmountFor,
  usagePackTitle,
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
  isMercadoPagoConfigured,
} from '../billing/mercadopago.ts';
import { isUsagePackId } from '../billing/activate-usage-pack.ts';
import { loadCommercialContext, quoteBusinessMonthly } from '../auth/commercial-pricing.ts';
import { quoteCommercialMonthly } from '../../shared/commercial-pricing.ts';
import { handleMercadoPagoWebhook } from '../billing/mp-webhook-handler.ts';
import {
  cancelAutoRenew,
  createAutoRenewCheckout,
  pauseAutoRenew,
  remainingTrialDaysFor,
} from '../billing/recurring.ts';
import { resolveSubscriptionLifecycle } from '../../shared/subscription-lifecycle.ts';

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
    const usagePacks = overlayUsagePacksForCountry(catalog, country);
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
      usagePacks,
      subscription: {
        autoRenew: business.billing?.autoRenew === true,
        status: business.billing?.mpPreapprovalStatus ?? null,
        lifecycleStatus: resolveSubscriptionLifecycle({
          estadoSuscripcion: business.estadoSuscripcion,
          enPrueba: business.enPrueba,
          trialStatus: business.trialStatus,
          trialEndDate: business.trialEndDate,
          trialStartDate: business.trialStartDate,
          paidUntil: business.billing?.paidUntil,
          autoRenew: business.billing?.autoRenew,
          mpPreapprovalStatus: business.billing?.mpPreapprovalStatus,
          lastPaymentStatus: business.billing?.lastPaymentStatus,
        }),
        nextPaymentDate: business.billing?.nextPaymentDate ?? null,
        quotedAmount: (await quoteBusinessMonthly(businessId)).total,
      },
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

    const ctx = await loadCommercialContext(businessId);
    const commercial = quoteCommercialMonthly({
      catalog,
      productId: productId as typeof ctx.productId,
      country,
      overrides: ctx.overrides,
      activeErpUsers: ctx.activeErpUsers,
      billableWhatsappNumbers: ctx.billableWhatsappNumbers,
      addonTotal: ctx.addonTotal,
      discount: ctx.discount,
    });
    const monthlyTotal = commercial.total > 0 ? commercial.total : priced.amountMonthly;

    const checkout = resolveCheckoutAmount(monthlyTotal, billingInterval);
    const paymentsUsed = await countSubscriptionPaymentPeriods(businessId);
    const introLeft = introMonthsRemaining(paymentsUsed, catalog);
    const introApplied =
      billingInterval === 'month' && introLeft > 0 && hasIntroDiscount(catalog);
    const unitPrice = introApplied
      ? discountedMonthly(monthlyTotal, catalog.introDiscountPercent)
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
        kind: 'plan',
        extraErpUsers: String(commercial.extraErpUsers),
        extraWhatsappNumbers: String(commercial.extraWhatsappNumbers),
        commercialTotal: String(monthlyTotal),
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
      extraErpUsers: commercial.extraErpUsers,
      extraWhatsappNumbers: commercial.extraWhatsappNumbers,
      commercialTotal: monthlyTotal,
    });
  } catch (error) {
    console.error('[billing] checkout error', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'No se pudo iniciar el pago.',
    });
  }
});

router.post('/checkout-pack', requireAuth, requireSupervisor, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    const userEmail =
      authReq.auth?.scope === 'company' ? authReq.auth.user.email : undefined;
    if (!businessId) {
      return res.status(401).json({ error: 'No autenticado.' });
    }

    const packId = String(req.body?.packId ?? '').trim();
    if (!isUsagePackId(packId)) {
      return res.status(400).json({ error: 'Pack inválido.' });
    }

    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    const country = countryFromBusiness(business);
    if (!isMercadoPagoConfigured(country)) {
      return res.status(503).json({
        error: `El pago online para ${country} todavía no está habilitado. Escribinos por WhatsApp.`,
        country,
      });
    }

    const catalog = await getCommercialCatalog();
    const pack = catalog.usagePacks[packId];
    const unitPrice = usagePackAmountFor(catalog, packId, country);
    if (unitPrice <= 0 || pack.quantity <= 0) {
      return res.status(400).json({ error: 'Este pack no está a la venta.' });
    }

    const currency = country === 'AR' ? 'ARS' : 'UYU';
    const productId = `pack-${packId}`;
    const externalReference = `${businessId}|${productId}|${country}|month|${Date.now()}`;
    const base = appBaseUrl();
    const title = `RILO · ${usagePackTitle(packId, pack.quantity)} (este mes)`;

    const preference = await createCheckoutPreference({
      country,
      currency,
      title,
      unitPrice,
      externalReference,
      metadata: {
        kind: 'usage_pack',
        businessId,
        packId,
        productId,
        country,
        quantity: String(pack.quantity),
      },
      payerEmail: userEmail || undefined,
      successUrl: `${base}/plan?pack=success`,
      failureUrl: `${base}/plan?pack=failure`,
      pendingUrl: `${base}/plan?pack=pending`,
      notificationUrl: `${apiBaseUrl()}/billing/webhooks/mercadopago`,
      itemDescription: `Pack extra este mes · ${title}`,
    });

    const useSandbox =
      process.env.MERCADOPAGO_USE_SANDBOX === 'true' && preference.sandboxInitPoint;

    res.json({
      preferenceId: preference.id,
      checkoutUrl: useSandbox ? preference.sandboxInitPoint : preference.initPoint,
      country,
      currency,
      amount: unitPrice,
      packId,
      quantity: pack.quantity,
    });
  } catch (error) {
    console.error('[billing] checkout-pack error', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'No se pudo iniciar el pago del pack.',
    });
  }
});

router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    if (!businessId) return res.status(401).json({ error: 'No autenticado.' });
    const business = await getBusiness(businessId);
    if (!business) return res.status(404).json({ error: 'Empresa no encontrada.' });
    const quote = await quoteBusinessMonthly(businessId);
    const trialDays = await remainingTrialDaysFor(business);
    res.json({
      autoRenew: business.billing?.autoRenew === true,
      mpPreapprovalId: business.billing?.mpPreapprovalId ?? null,
      mpPreapprovalStatus: business.billing?.mpPreapprovalStatus ?? null,
      nextPaymentDate: business.billing?.nextPaymentDate ?? null,
      paidUntil: business.billing?.paidUntil ?? null,
      quotedAmount: quote.total,
      currency: quote.rates.currency,
      lines: quote.lines,
      remainingTrialDays: trialDays,
      lifecycleStatus: resolveSubscriptionLifecycle({
        estadoSuscripcion: business.estadoSuscripcion,
        enPrueba: business.enPrueba,
        trialStatus: business.trialStatus,
        trialEndDate: business.trialEndDate,
        trialStartDate: business.trialStartDate,
        paidUntil: business.billing?.paidUntil,
        autoRenew: business.billing?.autoRenew,
        mpPreapprovalStatus: business.billing?.mpPreapprovalStatus,
        lastPaymentStatus: business.billing?.lastPaymentStatus,
      }),
    });
  } catch (error) {
    console.error('[billing] subscription get error', error);
    res.status(500).json({ error: 'No se pudo cargar la renovación automática.' });
  }
});

router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    const userEmail =
      authReq.auth?.scope === 'company' ? authReq.auth.user.email : undefined;
    if (!businessId) return res.status(401).json({ error: 'No autenticado.' });
    const created = await createAutoRenewCheckout({
      businessId,
      payerEmail: userEmail || String(req.body?.email ?? ''),
    });
    res.json(created);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'PAYER_EMAIL_REQUIRED') {
      return res.status(400).json({
        error: 'Necesitamos el email de la cuenta para autorizar la renovación en Mercado Pago.',
        code,
      });
    }
    if (code === 'MP_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Mercado Pago todavía no está habilitado.' });
    }
    console.error('[billing] subscribe error', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'No se pudo iniciar la renovación automática.',
    });
  }
});

router.post('/subscription/pause', requireAuth, requireSupervisor, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    if (!businessId) return res.status(401).json({ error: 'No autenticado.' });
    const result = await pauseAutoRenew(businessId);
    res.json(result);
  } catch (error) {
    console.error('[billing] pause error', error);
    res.status(500).json({ error: 'No se pudo pausar la renovación automática.' });
  }
});

router.post('/subscription/cancel', requireAuth, requireSupervisor, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const businessId = authReq.auth?.businessId;
    if (!businessId) return res.status(401).json({ error: 'No autenticado.' });
    const result = await cancelAutoRenew(businessId);
    res.json(result);
  } catch (error) {
    console.error('[billing] cancel error', error);
    res.status(500).json({ error: 'No se pudo cancelar la renovación automática.' });
  }
});

/** Webhook Mercado Pago (sin auth JWT). */
router.post('/webhooks/mercadopago', async (req, res) => {
  try {
    await handleMercadoPagoWebhook({
      query: req.query as Record<string, unknown>,
      body: (req.body ?? {}) as Record<string, unknown>,
    });
    res.sendStatus(200);
  } catch (error) {
    console.error('[billing] webhook error', error);
    res.sendStatus(200);
  }
});

export default router;
