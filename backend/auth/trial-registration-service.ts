import { db } from '../firebase.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createBusiness, getBusiness, type BusinessRecord } from './business.ts';
import { getPlan } from './plans.ts';
import { buildTrialFieldUpdates } from './trial-business.ts';
import { allocateUniqueBusinessId } from '../utils/business-slug.ts';
import {
  bindContactClaimToBusiness,
  claimContactUnique,
  getContactClaim,
  getTrialRegistration,
  updateTrialRegistration,
} from './trial-registration-store.ts';
import { appendSubscriptionHistory } from './subscription-history.ts';
import { toPublicUser, findUserByEmail } from './users.ts';
import { signAuthToken } from './jwt.ts';
import type { TrialContactVerification, TrialLifecycle } from '../../shared/trial-registration.ts';
import { CURRENT_TERMS_VERSION } from '../../shared/trial-registration.ts';
import {
  DEFAULT_PHONE_DIAL,
  isValidE164Phone,
  parsePhoneInput,
} from '../../shared/phone.ts';
import {
  parseTrialProductFromBody,
  platformAccessFromTrialProduct,
} from './platform-access.ts';
import {
  normalizePlatformAccess,
  productAlreadyEnabled,
  type TrialProductId,
} from '../../shared/platform-access.ts';
import { getCommercialCatalog } from './commercial-catalog.ts';
import { trialDaysForProduct } from '../../shared/trial-state.ts';
import { getBillingProduct } from '../../shared/billing-catalog.ts';
import { INCLUDED_ADMIN_SEATS } from '../../shared/subscription-modules.ts';
import { seedBusinessWhatsappAccess } from '../whatsapp/seed-access.ts';
import { enableProductOnBusiness } from './enable-product.ts';

const FALLBACK_TRIAL_PLAN_ID = process.env.TRIAL_DEFAULT_PLAN_ID ?? 'plan_intermedio';

export type TrialCompleteOutcome = 'created' | 'module_added' | 'already_active';

export type TrialCompleteResult = {
  business: BusinessRecord;
  businessId: string;
  user: ReturnType<typeof toPublicUser>;
  token: string;
  outcome: TrialCompleteOutcome;
  registeredPhone: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function loginFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'admin';
  return local.replace(/[^a-z0-9._-]/gi, '').toLowerCase().slice(0, 40) || 'admin';
}

async function seedBusinessConfig(
  businessId: string,
  rubro: string,
  pais: string
): Promise<void> {
  const ref = db.doc(`negocios/${businessId}/config/app`);
  const snap = await ref.get();
  if (snap.exists) return;

  await ref.set({
    general: {
      moneda: pais.toLowerCase().includes('uruguay') || pais === 'UY' ? 'UYU' : 'ARS',
      nombreComercial: '',
    },
    onboarding: {
      rubro,
      completed: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function resolveExistingBusinessId(params: {
  email: string;
  phone: string;
  existingBusinessId?: string | null;
}): Promise<string | null> {
  if (params.existingBusinessId) return params.existingBusinessId;
  const emailClaim = await getContactClaim('email', params.email);
  const phoneClaim = await getContactClaim('phone', params.phone);
  const emailBiz = emailClaim?.businessId?.trim() || null;
  const phoneBiz = phoneClaim?.businessId?.trim() || null;
  if (emailBiz && phoneBiz && emailBiz !== phoneBiz) {
    throw new Error('CONTACT_MISMATCH');
  }
  return emailBiz || phoneBiz || null;
}

async function assertPasswordForExistingBusiness(
  businessId: string,
  email: string,
  password: string | undefined
): Promise<void> {
  if (!password) throw new Error('EXISTING_ACCOUNT_PASSWORD_REQUIRED');
  const user = await findUserByEmail(businessId, email);
  if (!user) throw new Error('EXISTING_ACCOUNT_EMAIL_MISMATCH');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error('EXISTING_ACCOUNT_WRONG_PASSWORD');
}

function signCompanySession(userId: string, businessId: string, rol: 'supervisor' | 'admin' | 'staff') {
  return signAuthToken({
    userId,
    businessId,
    rol,
    scope: 'company',
  });
}

async function attachProductToExistingBusiness(
  registrationId: string,
  registration: NonNullable<Awaited<ReturnType<typeof getTrialRegistration>>>,
  businessId: string,
  trialProduct: TrialProductId
): Promise<TrialCompleteResult> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('REGISTRATION_NOT_FOUND');

  const user = await findUserByEmail(businessId, registration.email);
  if (!user) throw new Error('EXISTING_ACCOUNT_EMAIL_MISMATCH');

  const currentAccess = normalizePlatformAccess(business.platformAccess);
  const already = productAlreadyEnabled(currentAccess, trialProduct);
  let updated = business;
  if (!already) {
    const enabled = await enableProductOnBusiness({
      businessId,
      product: trialProduct,
    });
    if (enabled.outcome === 'checkout_required') {
      throw new Error('MODULE_CHECKOUT_REQUIRED');
    }
    updated = enabled.business;
  }

  await bindContactClaimToBusiness('email', registration.email, businessId);
  await bindContactClaimToBusiness('phone', registration.phone, businessId);
  await updateTrialRegistration(registrationId, {
    status: 'completed',
    completedBusinessId: businessId,
    existingBusinessId: businessId,
  });

  const token = signCompanySession(user.id, businessId, user.rol);
  return {
    business: updated,
    businessId,
    user: toPublicUser(user),
    token,
    outcome: already ? 'already_active' : 'module_added',
    registeredPhone: registration.phone,
  };
}

export async function completeTrialRegistration(registrationId: string): Promise<TrialCompleteResult> {
  const registration = await getTrialRegistration(registrationId);
  if (!registration) throw new Error('REGISTRATION_NOT_FOUND');
  if (registration.status === 'completed' && registration.completedBusinessId) {
    throw new Error('REGISTRATION_ALREADY_COMPLETED');
  }
  if (!registration.emailVerified) {
    throw new Error('EMAIL_NOT_VERIFIED');
  }

  const trialProduct =
    (registration.trialProduct as TrialProductId) ?? 'completo';

  const existingBusinessId = await resolveExistingBusinessId({
    email: registration.email,
    phone: registration.phone,
    existingBusinessId: registration.existingBusinessId,
  });
  if (existingBusinessId) {
    return attachProductToExistingBusiness(
      registrationId,
      registration,
      existingBusinessId,
      trialProduct
    );
  }

  const catalogProduct = getBillingProduct(trialProduct);
  const planId = catalogProduct?.erpPlanId ?? FALLBACK_TRIAL_PLAN_ID;
  const plan = await getPlan(planId);
  if (!plan || !plan.activo) {
    throw new Error('TRIAL_PLAN_UNAVAILABLE');
  }

  const businessId = await allocateUniqueBusinessId(registration.businessName);
  const now = new Date().toISOString();
  const commercial = await getCommercialCatalog();
  const trialDays = commercial.trialDays || trialDaysForProduct(trialProduct);

  const contactVerification: TrialContactVerification = {
    email: registration.email,
    emailVerified: registration.emailVerified,
    emailVerifiedAt: registration.emailVerifiedAt ?? null,
    emailStatus: registration.emailVerified ? 'verified' : 'pending',
    phone: registration.phone,
    phoneVerified: false,
    phoneVerifiedAt: null,
    phoneStatus: 'pending',
    whatsappOptIn: registration.whatsappOptIn,
    whatsappOptInAt: registration.whatsappOptIn ? now : null,
    termsAcceptedAt: registration.termsAcceptedAt,
    termsVersion: registration.termsVersion,
    privacyAcceptedAt: registration.privacyAcceptedAt,
    marketingEmailOptIn: registration.marketingEmailOptIn,
    lastOtpSentAt: registration.lastOtpSentAt ?? null,
    otpAttempts: registration.phoneOtpAttempts,
  };

  const lifecycle: TrialLifecycle = {
    source: 'self_service_trial',
    campaignSource: registration.campaignSource ?? null,
    utmSource: registration.utmSource ?? null,
    utmCampaign: registration.utmCampaign ?? null,
    rubro: registration.rubro,
    pais: registration.pais,
    ciudad: registration.ciudad,
    ownerName: registration.ownerName,
    onboardingStep: 'welcome',
    usageSummary: {
      ordersCount: 0,
      salesCount: 0,
      productsCount: 0,
      cashMovementsCount: 0,
    },
  };

  const business = await createBusiness(businessId, {
    nombre: registration.businessName,
    planId,
    estadoSuscripcion: 'activa',
    enPrueba: true,
    ...buildTrialFieldUpdates(
      {
        enPrueba: true,
        trialStatus: 'active',
      },
      undefined,
      { trialDays }
    ),
    creadoPor: 'self_signup',
    source: 'self_service_trial',
    contactVerification,
    lifecycle,
    platformAccess: platformAccessFromTrialProduct(trialProduct),
    suscripcion: {
      limiteAdministradores: INCLUDED_ADMIN_SEATS,
      limiteOperadores: 0,
      limiteUsuariosTotal: INCLUDED_ADMIN_SEATS,
    },
  });

  const loginUsername = registration.loginUsername || loginFromEmail(registration.email);
  const userRef = await db.collection(`negocios/${businessId}/usuarios`).add({
    nombre: registration.ownerName,
    email: registration.email,
    loginUsername,
    passwordHash: registration.passwordHash ?? null,
    googleId: registration.googleId ?? null,
    rol: 'supervisor',
    permisos: [],
    activo: true,
    isOwner: true,
    telefono: registration.phone,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('negocios').doc(businessId).update({
    'lifecycle.ownerUserId': userRef.id,
    updatedAt: now,
  });

  await seedBusinessConfig(businessId, registration.rubro, registration.pais);
  await seedBusinessWhatsappAccess({
    businessId,
    phone: registration.phone,
    ownerName: registration.ownerName,
    trialProduct,
    forceLine: registration.whatsappOptIn === true,
    erpUserId: userRef.id,
    status: 'trial',
  });
  await bindContactClaimToBusiness('email', registration.email, businessId);
  await bindContactClaimToBusiness('phone', registration.phone, businessId);

  try {
    await appendSubscriptionHistory(businessId, {
      changedBy: 'system',
      changeType: 'trial',
      note: `Alta autoservicio — prueba ${trialDays} días · ${trialProduct}`,
      previousPlanId: undefined,
      newPlanId: planId,
      newEnPrueba: true,
      newTrialStatus: 'active',
    });
  } catch (error) {
    console.error('[trial] history append failed (registration still completes)', businessId, error);
  }

  await updateTrialRegistration(registrationId, {
    status: 'completed',
    completedBusinessId: businessId,
  });

  const publicUser = toPublicUser({
    id: userRef.id,
    nombre: registration.ownerName,
    email: registration.email,
    loginUsername,
    passwordHash: registration.passwordHash,
    googleId: registration.googleId,
    rol: 'supervisor',
    permisos: [],
    activo: true,
    createdAt: now,
    updatedAt: now,
  });

  const token = signAuthToken({
    userId: userRef.id,
    businessId,
    rol: 'supervisor',
    scope: 'company',
  });

  return {
    business,
    businessId,
    user: publicUser,
    token,
    outcome: 'created',
    registeredPhone: registration.phone,
  };
}

export function validateRegistrationPayload(body: Record<string, unknown>): {
  businessName: string;
  rubro: string;
  pais: string;
  ciudad: string;
  ownerName: string;
  email: string;
  phone: string;
  password?: string;
  loginUsername: string;
  whatsappOptIn: boolean;
  marketingEmailOptIn: boolean;
  acceptTerms: boolean;
  website?: string;
  trialProduct: TrialProductId;
} {
  if (typeof body.website === 'string' && body.website.trim()) {
    throw new Error('SPAM_DETECTED');
  }

  const businessName = String(body.businessName ?? body.nombreNegocio ?? '').trim();
  const rubro = String(body.rubro ?? '').trim();
  const pais = String(body.pais ?? 'Uruguay').trim();
  const ciudad = String(body.ciudad ?? '').trim();
  const ownerName = String(body.ownerName ?? body.nombreResponsable ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phoneCountryCode = String(body.phoneCountryCode ?? body.phoneDial ?? DEFAULT_PHONE_DIAL).trim();
  const phone = parsePhoneInput(
    phoneCountryCode,
    String(body.phone ?? body.telefono ?? '')
  );
  const password = String(body.password ?? '').trim();
  const loginUsername = String(body.loginUsername ?? loginFromEmail(email)).trim().toLowerCase();
  const whatsappOptIn = body.whatsappOptIn === true;
  const marketingEmailOptIn = body.marketingEmailOptIn !== false;
  const acceptTerms = body.acceptTerms === true;
  const trialProduct = parseTrialProductFromBody(body);

  if (businessName.length < 2) throw new Error('BUSINESS_NAME_REQUIRED');
  if (!rubro) throw new Error('RUBRO_REQUIRED');
  if (!pais || !ciudad) throw new Error('LOCATION_REQUIRED');
  if (ownerName.length < 2) throw new Error('OWNER_NAME_REQUIRED');
  if (!isValidEmail(email)) throw new Error('EMAIL_INVALID');
  if (!phone || !isValidE164Phone(phone)) throw new Error('PHONE_INVALID');
  if (!acceptTerms) throw new Error('TERMS_REQUIRED');
  if (password && password.length < 8) throw new Error('PASSWORD_TOO_SHORT');

  return {
    businessName,
    rubro,
    pais,
    ciudad,
    ownerName,
    email,
    phone,
    password: password || undefined,
    loginUsername,
    whatsappOptIn,
    marketingEmailOptIn,
    acceptTerms,
    trialProduct,
  };
}

export async function registerTrialLead(
  body: Record<string, unknown>,
  consentIp?: string
): Promise<{ registrationId: string; existingAccount: boolean }> {
  const parsed = validateRegistrationPayload(body);
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : undefined;
  const now = new Date().toISOString();

  const existingBusinessId = await resolveExistingBusinessId({
    email: parsed.email,
    phone: parsed.phone,
  });
  if (existingBusinessId) {
    await assertPasswordForExistingBusiness(existingBusinessId, parsed.email, parsed.password);
  }

  const { createTrialRegistration } = await import('./trial-registration-store.ts');
  const registration = await createTrialRegistration({
    businessName: parsed.businessName,
    rubro: parsed.rubro,
    pais: parsed.pais,
    ciudad: parsed.ciudad,
    ownerName: parsed.ownerName,
    email: parsed.email,
    phone: parsed.phone,
    passwordHash,
    loginUsername: parsed.loginUsername,
    whatsappOptIn: parsed.whatsappOptIn,
    marketingEmailOptIn: parsed.marketingEmailOptIn,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: now,
    privacyAcceptedAt: now,
    consentIp,
    utmSource: typeof body.utmSource === 'string' ? body.utmSource : null,
    utmCampaign: typeof body.utmCampaign === 'string' ? body.utmCampaign : null,
    campaignSource: typeof body.campaignSource === 'string' ? body.campaignSource : null,
    trialProduct: parsed.trialProduct,
    existingBusinessId,
  });

  await claimContactUnique('email', parsed.email, registration.id);
  await claimContactUnique('phone', parsed.phone, registration.id);

  return { registrationId: registration.id, existingAccount: Boolean(existingBusinessId) };
}

export { isValidEmail };
