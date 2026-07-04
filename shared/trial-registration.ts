export const TRIAL_RUBROS = [
  { id: 'personalizados', label: 'Personalizados / sublimación' },
  { id: 'ropa', label: 'Ropa y moda' },
  { id: 'almacen', label: 'Almacén / retail' },
  { id: 'comida', label: 'Comida / gastronomía' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'otro', label: 'Otro' },
] as const;

export type TrialRubroId = (typeof TRIAL_RUBROS)[number]['id'];

export type BusinessSource = 'self_service_trial' | 'manual_platform' | 'imported';

export type VerificationChannelStatus = 'pending' | 'verified' | 'failed' | 'changed_pending';

export interface TrialContactVerification {
  email: string;
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  emailStatus?: VerificationChannelStatus;
  phone: string;
  phoneVerified: boolean;
  phoneVerifiedAt?: string | null;
  phoneStatus?: VerificationChannelStatus;
  whatsappOptIn: boolean;
  whatsappOptInAt?: string | null;
  termsAcceptedAt?: string | null;
  termsVersion?: string | null;
  privacyAcceptedAt?: string | null;
  marketingEmailOptIn?: boolean;
  lastOtpSentAt?: string | null;
  otpAttempts?: number;
}

export interface TrialLifecycle {
  source: BusinessSource;
  campaignSource?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  rubro?: TrialRubroId | string | null;
  pais?: string | null;
  ciudad?: string | null;
  ownerName?: string | null;
  ownerUserId?: string | null;
  firstLoginAt?: string | null;
  lastLoginAt?: string | null;
  onboardingStep?: string | null;
  usageSummary?: {
    ordersCount: number;
    salesCount: number;
    productsCount: number;
    cashMovementsCount: number;
  };
}

export const CURRENT_TERMS_VERSION = '2026-06-01';

export const TRIAL_REGISTRATION_STEPS = [
  'form',
  'phone',
  'complete',
] as const;

export type TrialRegistrationStep = (typeof TRIAL_REGISTRATION_STEPS)[number];
