import { db } from '../firebase.ts';
import { getBusiness, toPublicBusinessInfo, updateBusiness } from './business.ts';
import { platformAccessFromTrialProduct } from './platform-access.ts';
import {
  registerSubscriptionCoverage,
  currentPeriodo,
} from './subscription-payments.ts';
import {
  bindContactClaimToBusiness,
  releaseTrialContactClaim,
} from './trial-registration-store.ts';
import { isValidEmail } from './trial-registration-service.ts';
import {
  getBillingProduct,
  getProductPriceForCountry,
  resolveBillingCountry,
  resolveCheckoutAmount,
  type BillingCountryCode,
  type BillingInterval,
} from '../../shared/billing-catalog.ts';
import { isTrialProductId, type TrialProductId } from '../../shared/platform-access.ts';
import { addTrialDays } from '../../shared/trial-state.ts';
import { isValidE164Phone, normalizePhone } from '../../shared/phone.ts';
import type { TrialContactVerification, TrialLifecycle } from '../../shared/trial-registration.ts';
import { sendSubscriptionInvoiceEmail } from '../utils/transactional-email.ts';
import { seedBusinessWhatsappAccess } from '../whatsapp/seed-access.ts';

function normalizeContactPhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (isValidE164Phone(trimmed)) return trimmed;
  const normalized = normalizePhone(trimmed);
  if (normalized && isValidE164Phone(normalized)) return normalized;
  throw new Error('PHONE_INVALID');
}

export async function updateBusinessContact(params: {
  businessId: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  pais?: string;
  ciudad?: string;
  rubro?: string;
  whatsappOptIn?: boolean;
}): Promise<Awaited<ReturnType<typeof toPublicBusinessInfo>>> {
  const business = await getBusiness(params.businessId);
  if (!business) {
    throw new Error('BUSINESS_NOT_FOUND');
  }

  const ownerName =
    typeof params.ownerName === 'string' ? params.ownerName.trim() : undefined;
  const emailRaw =
    typeof params.email === 'string' ? params.email.trim().toLowerCase() : undefined;
  const phoneRaw = typeof params.phone === 'string' ? params.phone.trim() : undefined;
  const pais = typeof params.pais === 'string' ? params.pais.trim() : undefined;
  const ciudad = typeof params.ciudad === 'string' ? params.ciudad.trim() : undefined;
  const rubro = typeof params.rubro === 'string' ? params.rubro.trim() : undefined;

  if (emailRaw !== undefined && emailRaw && !isValidEmail(emailRaw)) {
    throw new Error('EMAIL_INVALID');
  }

  let phone = '';
  if (phoneRaw !== undefined) {
    phone = phoneRaw ? normalizeContactPhone(phoneRaw) : '';
  }

  const prevEmail = business.contactVerification?.email?.trim().toLowerCase() || '';
  const prevPhone = business.contactVerification?.phone?.trim() || '';
  const nextEmail = emailRaw !== undefined ? emailRaw : prevEmail;
  const nextPhone = phoneRaw !== undefined ? phone : prevPhone;

  if (nextEmail && nextEmail !== prevEmail) {
    const claimRef = db.collection('trial_contact_claims').doc(`email_${nextEmail}`);
    const snap = await claimRef.get();
    if (snap.exists) {
      const bound = String((snap.data() as { businessId?: string }).businessId ?? '');
      if (bound && bound !== params.businessId) {
        throw new Error('EMAIL_ALREADY_USED');
      }
    }
  }
  if (nextPhone && nextPhone !== prevPhone) {
    const claimKey = nextPhone.toLowerCase();
    const claimRef = db.collection('trial_contact_claims').doc(`phone_${claimKey}`);
    const snap = await claimRef.get();
    if (snap.exists) {
      const bound = String((snap.data() as { businessId?: string }).businessId ?? '');
      if (bound && bound !== params.businessId) {
        throw new Error('PHONE_ALREADY_USED');
      }
    }
  }

  const now = new Date().toISOString();
  const prevContact = business.contactVerification;
  const contactVerification: TrialContactVerification = {
    email: nextEmail,
    emailVerified: prevContact?.emailVerified === true && nextEmail === prevEmail,
    emailVerifiedAt:
      prevContact?.emailVerified === true && nextEmail === prevEmail
        ? prevContact.emailVerifiedAt ?? null
        : null,
    emailStatus: nextEmail
      ? prevContact?.emailVerified === true && nextEmail === prevEmail
        ? 'verified'
        : 'pending'
      : 'pending',
    phone: nextPhone,
    phoneVerified: prevContact?.phoneVerified === true && nextPhone === prevPhone,
    phoneVerifiedAt:
      prevContact?.phoneVerified === true && nextPhone === prevPhone
        ? prevContact.phoneVerifiedAt ?? null
        : null,
    phoneStatus: nextPhone
      ? prevContact?.phoneVerified === true && nextPhone === prevPhone
        ? 'verified'
        : 'pending'
      : 'pending',
    whatsappOptIn:
      typeof params.whatsappOptIn === 'boolean'
        ? params.whatsappOptIn
        : Boolean(prevContact?.whatsappOptIn),
    whatsappOptInAt: prevContact?.whatsappOptInAt ?? null,
    termsAcceptedAt: prevContact?.termsAcceptedAt ?? null,
    termsVersion: prevContact?.termsVersion ?? null,
    privacyAcceptedAt: prevContact?.privacyAcceptedAt ?? null,
    marketingEmailOptIn: prevContact?.marketingEmailOptIn === true,
  };

  const prevLife = business.lifecycle;
  const lifecycle: TrialLifecycle = {
    source: prevLife?.source ?? business.source ?? 'manual_platform',
    campaignSource: prevLife?.campaignSource ?? null,
    utmSource: prevLife?.utmSource ?? null,
    utmCampaign: prevLife?.utmCampaign ?? null,
    rubro: rubro !== undefined ? rubro || null : prevLife?.rubro ?? null,
    pais: pais !== undefined ? pais || null : prevLife?.pais ?? null,
    ciudad: ciudad !== undefined ? ciudad || null : prevLife?.ciudad ?? null,
    ownerName:
      ownerName !== undefined ? ownerName || null : prevLife?.ownerName ?? null,
    ownerUserId: prevLife?.ownerUserId ?? null,
    firstLoginAt: prevLife?.firstLoginAt ?? null,
    lastLoginAt: prevLife?.lastLoginAt ?? null,
    onboardingStep: prevLife?.onboardingStep ?? null,
    ...(prevLife?.usageSummary ? { usageSummary: prevLife.usageSummary } : {}),
  };

  await db.collection('negocios').doc(params.businessId).set(
    {
      contactVerification,
      lifecycle,
      source: business.source ?? lifecycle.source,
      updatedAt: now,
    },
    { merge: true }
  );

  if (prevEmail && prevEmail !== nextEmail) {
    try {
      await releaseTrialContactClaim('email', prevEmail, { force: true });
    } catch {
      // ignore
    }
  }
  if (prevPhone && prevPhone !== nextPhone) {
    try {
      await releaseTrialContactClaim('phone', prevPhone, { force: true });
    } catch {
      // ignore
    }
  }
  if (nextEmail) {
    await bindContactClaimToBusiness('email', nextEmail, params.businessId);
  }
  if (nextPhone) {
    await bindContactClaimToBusiness('phone', nextPhone, params.businessId);
  }

  const product =
    business.platformAccess?.trialProduct ??
    (business.platformAccess?.whatsappEnabled ? 'whatsapp' : null);
  const wantsWhatsapp =
    business.platformAccess?.whatsappEnabled === true ||
    product === 'whatsapp' ||
    product === 'completo';

  if (nextPhone && wantsWhatsapp) {
    await seedBusinessWhatsappAccess({
      businessId: params.businessId,
      phone: nextPhone,
      ownerName:
        (ownerName !== undefined ? ownerName : business.lifecycle?.ownerName) ||
        'Responsable',
      trialProduct: product,
      forceLine: true,
      erpUserId: business.lifecycle?.ownerUserId ?? null,
      status: business.enPrueba ? 'trial' : 'active',
    });

    if (!business.platformAccess?.whatsappEnabled) {
      const access = platformAccessFromTrialProduct(
        product === 'completo' ? 'completo' : 'whatsapp'
      );
      await db.collection('negocios').doc(params.businessId).set(
        {
          platformAccess: {
            ...(business.platformAccess ?? {}),
            whatsappEnabled: true,
            aiEnabled: access.aiEnabled,
            trialProduct: business.platformAccess?.trialProduct ?? access.trialProduct,
          },
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }

  return toPublicBusinessInfo(params.businessId);
}

export async function extendBusinessTrial(params: {
  businessId: string;
  days: number;
  changedBy?: string;
}): Promise<Awaited<ReturnType<typeof toPublicBusinessInfo>>> {
  const days = Math.floor(Number(params.days));
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new Error('INVALID_TRIAL_DAYS');
  }

  const business = await getBusiness(params.businessId);
  if (!business) {
    throw new Error('BUSINESS_NOT_FOUND');
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentEnd = business.trialEndDate
    ? new Date(`${String(business.trialEndDate).slice(0, 10)}T12:00:00`)
    : null;
  const base =
    currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd.getTime() > today.getTime()
      ? currentEnd
      : today;
  const trialEndDate = addTrialDays(base, days);
  const trialStartDate = business.trialStartDate
    ? String(business.trialStartDate).slice(0, 10)
    : todayIso;

  await updateBusiness(
    params.businessId,
    {
      estadoSuscripcion: 'activa',
      enPrueba: true,
      trialStatus: 'active',
      trialStartDate,
      trialEndDate,
    },
    {
      allowSubscriptionFields: true,
      changedBy: params.changedBy,
      historyNote: `Prueba extendida +${days} día${days === 1 ? '' : 's'} desde Plataforma`,
    }
  );

  return toPublicBusinessInfo(params.businessId);
}

export async function markBusinessAsPaid(params: {
  businessId: string;
  productId?: string;
  country?: BillingCountryCode;
  registerPayment?: boolean;
  amount?: number;
  billingInterval?: BillingInterval;
  enablePerUserPricing?: boolean;
  precioPorOperador?: number;
  changedBy?: string;
}): Promise<Awaited<ReturnType<typeof toPublicBusinessInfo>>> {
  const business = await getBusiness(params.businessId);
  if (!business) {
    throw new Error('BUSINESS_NOT_FOUND');
  }

  const country =
    params.country ??
    resolveBillingCountry(business.lifecycle?.pais ?? null);

  const productIdRaw =
    params.productId ||
    business.platformAccess?.trialProduct ||
    'completo';
  if (!isTrialProductId(productIdRaw)) {
    throw new Error('INVALID_PRODUCT');
  }
  const productId = productIdRaw as TrialProductId;
  const product = getBillingProduct(productId);
  if (!product) {
    throw new Error('INVALID_PRODUCT');
  }

  const billingInterval: BillingInterval =
    params.billingInterval === 'year' ? 'year' : 'month';
  const price = getProductPriceForCountry(productId, country);
  const catalogCheckout = resolveCheckoutAmount(price?.amountMonthly ?? 0, billingInterval);
  const amount =
    typeof params.amount === 'number' && Number.isFinite(params.amount) && params.amount > 0
      ? Math.round(params.amount)
      : catalogCheckout.amount;

  const coverageMonths = catalogCheckout.coverageMonths;
  const precioBaseMensual =
    billingInterval === 'year'
      ? Math.round(amount / coverageMonths)
      : amount;

  const platformAccess = platformAccessFromTrialProduct(productId);
  const now = new Date();
  const perUserEnabled = params.enablePerUserPricing === true;
  const precioPorOperador = perUserEnabled
    ? Math.max(
        0,
        Number(
          params.precioPorOperador ??
            price?.extraUserMonthly ??
            0
        ) || 0
      )
    : 0;

  let paidUntil = business.billing?.paidUntil;
  if (params.registerPayment !== false && amount > 0) {
    const coverage = await registerSubscriptionCoverage(params.businessId, {
      coverageMonths,
      montoTotal: amount,
      fechaPago: now.toISOString(),
      notas: `Marcado como pago desde Plataforma · ${product.name}${
        billingInterval === 'year' ? ' · anual' : ''
      }`,
      currency: price?.currency,
      productId,
      country,
    });
    paidUntil = coverage.paidUntil;
  } else {
    const coverage = resolveCheckoutAmount(precioBaseMensual || amount, billingInterval);
    const until = new Date(now);
    until.setMonth(until.getMonth() + coverage.coverageMonths);
    paidUntil = until.toISOString();
  }

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
        precioPorOperadorOverride: perUserEnabled ? precioPorOperador : 0,
        notasComerciales: `Marcado como pago desde Plataforma · ${product.name}`,
      },
    },
    {
      allowSubscriptionFields: true,
      changedBy: params.changedBy,
      historyNote: `Marcado como pago (${product.name}${
        billingInterval === 'year' ? ' · anual' : ''
      })${perUserEnabled ? ` · $/usuario extra ${precioPorOperador}` : ''}`,
    }
  );

  await db.collection('negocios').doc(params.businessId).set(
    {
      billing: {
        country,
        currency: price?.currency ?? (country === 'AR' ? 'ARS' : 'UYU'),
        productId,
        billingInterval,
        paidUntil,
        source: 'platform_manual',
        updatedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    },
    { merge: true }
  );

  return toPublicBusinessInfo(params.businessId);
}

export async function sendBusinessSubscriptionInvoiceEmail(params: {
  businessId: string;
  to?: string;
  periodo?: string;
  notes?: string;
  changedBy?: string;
}): Promise<{
  sent: boolean;
  devOnly: boolean;
  to: string;
  periodo: string;
  total: number;
}> {
  const info = await toPublicBusinessInfo(params.businessId);
  const to =
    (typeof params.to === 'string' ? params.to.trim().toLowerCase() : '') ||
    info.contactVerification?.email?.trim().toLowerCase() ||
    '';
  if (!to || !isValidEmail(to)) {
    throw new Error('INVOICE_EMAIL_REQUIRED');
  }

  const periodo =
    (typeof params.periodo === 'string' && /^\d{4}-\d{2}$/.test(params.periodo.trim())
      ? params.periodo.trim()
      : null) ||
    info.periodoPagoActual ||
    currentPeriodo();

  const cuota = info.cuotaDesglose ?? {
    lineas: [],
    subtotal: info.montoMensualEsperado,
    descuento: 0,
    total: info.montoMensualEsperado,
  };

  const result = await sendSubscriptionInvoiceEmail({
    to,
    businessName: info.nombre,
    businessId: info.id,
    periodo,
    ownerName: info.lifecycle?.ownerName ?? null,
    lineas: (cuota.lineas ?? []).map((line) => ({
      concepto: line.concepto,
      codigo: line.codigo,
      cantidad: line.cantidad,
      precioUnitario: line.precioUnitario,
      monto: line.monto,
    })),
    subtotal: cuota.subtotal,
    descuento: cuota.descuento,
    total: cuota.total,
    notes: params.notes?.trim() || null,
  });

  await db.collection(`negocios/${params.businessId}/facturas_enviadas`).add({
    to,
    periodo,
    total: cuota.total,
    subtotal: cuota.subtotal,
    descuento: cuota.descuento,
    lineas: cuota.lineas ?? [],
    notes: params.notes?.trim() || null,
    sent: result.sent,
    devOnly: result.devOnly,
    changedBy: params.changedBy ?? null,
    createdAt: new Date().toISOString(),
  });

  return {
    sent: result.sent,
    devOnly: result.devOnly,
    to,
    periodo,
    total: cuota.total,
  };
}
