import { db } from '../firebase.ts';
import { hashPassword } from './password.ts';
import { createBusiness, type BusinessRecord } from './business.ts';
import { getPlan } from './plans.ts';
import { buildTrialFieldUpdates } from './trial-business.ts';
import { allocateUniqueBusinessId } from '../utils/business-slug.ts';
import {
  bindContactClaimToBusiness,
  claimContactUnique,
  getTrialRegistration,
  updateTrialRegistration,
} from './trial-registration-store.ts';
import { appendSubscriptionHistory } from './subscription-history.ts';
import { toPublicUser } from './users.ts';
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
import type { TrialProductId } from '../../shared/platform-access.ts';

const DEFAULT_TRIAL_PLAN_ID = process.env.TRIAL_DEFAULT_PLAN_ID ?? 'plan_intermedio';

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

export async function completeTrialRegistration(registrationId: string): Promise<{
  business: BusinessRecord;
  businessId: string;
  user: ReturnType<typeof toPublicUser>;
  token: string;
}> {
  const registration = await getTrialRegistration(registrationId);
  if (!registration) throw new Error('REGISTRATION_NOT_FOUND');
  if (registration.status === 'completed' && registration.completedBusinessId) {
    throw new Error('REGISTRATION_ALREADY_COMPLETED');
  }
  if (!registration.emailVerified) {
    throw new Error('EMAIL_NOT_VERIFIED');
  }

  const plan = await getPlan(DEFAULT_TRIAL_PLAN_ID);
  if (!plan || !plan.activo) {
    throw new Error('TRIAL_PLAN_UNAVAILABLE');
  }

  const businessId = await allocateUniqueBusinessId(registration.businessName);
  const now = new Date().toISOString();

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
    planId: DEFAULT_TRIAL_PLAN_ID,
    estadoSuscripcion: 'activa',
    enPrueba: true,
    ...buildTrialFieldUpdates(
      {
        enPrueba: true,
        trialStatus: 'active',
      },
      undefined
    ),
    creadoPor: 'self_signup',
    source: 'self_service_trial',
    contactVerification,
    lifecycle,
    platformAccess: platformAccessFromTrialProduct(
      (registration.trialProduct as TrialProductId) ?? 'completo'
    ),
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
  await seedWhatsappAccessIfNeeded(businessId, registration);
  await bindContactClaimToBusiness('email', registration.email, businessId);
  await bindContactClaimToBusiness('phone', registration.phone, businessId);

  await updateTrialRegistration(registrationId, {
    status: 'completed',
    completedBusinessId: businessId,
  });

  await appendSubscriptionHistory(businessId, {
    changedBy: 'system',
    changeType: 'trial',
    note: 'Alta autoservicio — prueba gratuita iniciada',
    previousPlanId: undefined,
    newPlanId: DEFAULT_TRIAL_PLAN_ID,
    newEnPrueba: true,
    newTrialStatus: 'active',
  });

  const userSnap = await userRef.get();
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

  return { business, businessId, user: publicUser, token };
}

async function seedWhatsappAccessIfNeeded(
  businessId: string,
  registration: { phone: string; ownerName: string; trialProduct?: string | null; whatsappOptIn: boolean }
): Promise<void> {
  const product = registration.trialProduct;
  if (product !== 'whatsapp' && product !== 'completo' && !registration.whatsappOptIn) return;

  const now = new Date().toISOString();
  await db.collection(`negocios/${businessId}/whatsapp_users`).doc('owner').set({
    phone: registration.phone,
    name: registration.ownerName,
    role: 'supervisor',
    enabled: true,
    erpUserId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection(`negocios/${businessId}/whatsapp_config`).doc('default').set({
    enabled: product === 'whatsapp' || product === 'completo',
    mode: 'central',
    status: 'trial',
    requireConfirmation: true,
    updatedAt: now,
  });
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
): Promise<{ registrationId: string }> {
  const parsed = validateRegistrationPayload(body);
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : undefined;
  const now = new Date().toISOString();

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
  });

  await claimContactUnique('email', parsed.email, registration.id);
  await claimContactUnique('phone', parsed.phone, registration.id);

  return { registrationId: registration.id };
}

export { isValidEmail };
