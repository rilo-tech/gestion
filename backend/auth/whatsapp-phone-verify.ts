import { db } from '../firebase.ts';
import { getBusiness, updateBusiness } from './business.ts';
import { bindContactClaimToBusiness, getContactClaim } from './trial-registration-store.ts';
import { isValidE164Phone, normalizePhone } from '../../shared/phone.ts';
import {
  generateOtpCode,
  hashOtp,
  isExpired,
  logDevOtp,
  otpExpiresAt,
  verifyOtpHash,
} from '../utils/trial-verification.ts';
import { isWhatsappOutboundConfigured, sendWhatsappText } from '../whatsapp/meta-api.ts';

const MAX_OTP_ATTEMPTS = 5;

type PendingOtp = {
  phone: string;
  hash: string;
  expiresAt: string;
  attempts: number;
  sentAt: string;
};

function otpRef(businessId: string) {
  return db.doc(`negocios/${businessId}/private/whatsapp_phone_otp`);
}

function resolvePhone(raw: string): string {
  const phone = normalizePhone(String(raw ?? '').trim());
  if (!isValidE164Phone(phone)) throw new Error('PHONE_INVALID');
  return phone;
}

async function assertPhoneAvailable(businessId: string, phone: string): Promise<void> {
  const claim = await getContactClaim('phone', phone.toLowerCase());
  const bound = String(claim?.businessId ?? '').trim();
  if (bound && bound !== businessId) throw new Error('PHONE_ALREADY_USED');
}

export async function sendWhatsappPhoneCode(params: {
  businessId: string;
  phone: string;
}): Promise<{ phone: string; whatsappSent: boolean; devCode?: string }> {
  const business = await getBusiness(params.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');

  const phone = resolvePhone(params.phone);
  await assertPhoneAvailable(params.businessId, phone);

  const previous = await otpRef(params.businessId).get();
  if (previous.exists) {
    const pending = previous.data() as PendingOtp;
    const elapsed = Date.now() - new Date(pending.sentAt).getTime();
    if (pending.phone === phone && Number.isFinite(elapsed) && elapsed < 45_000) {
      throw new Error('OTP_COOLDOWN');
    }
  }

  const code = generateOtpCode();
  const now = new Date().toISOString();
  await otpRef(params.businessId).set({
    phone,
    hash: hashOtp(code),
    expiresAt: otpExpiresAt(),
    attempts: 0,
    sentAt: now,
  } satisfies PendingOtp);

  logDevOtp('enable-whatsapp', phone, code);

  let whatsappSent = false;
  if (isWhatsappOutboundConfigured()) {
    const sent = await sendWhatsappText(
      phone,
      `Tu código RiloTech para activar RiloBot es ${code}. Vence en 10 minutos.`
    );
    whatsappSent = sent.ok;
    if (!sent.ok) {
      console.warn('[whatsapp-phone-verify] No se pudo enviar el código por WhatsApp:', sent.error);
    }
  }

  const exposeDev =
    process.env.NODE_ENV !== 'production' && process.env.TRIAL_OTP_DEV_MODE !== 'false';

  return {
    phone,
    whatsappSent,
    ...(exposeDev ? { devCode: code } : {}),
  };
}

export async function verifyWhatsappPhoneCode(params: {
  businessId: string;
  phone: string;
  code: string;
}): Promise<{ phone: string }> {
  const business = await getBusiness(params.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');

  const phone = resolvePhone(params.phone);
  const code = String(params.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('OTP_INVALID');

  const snap = await otpRef(params.businessId).get();
  if (!snap.exists) throw new Error('OTP_EXPIRED');
  const pending = snap.data() as PendingOtp;
  if (pending.phone !== phone) throw new Error('OTP_INVALID');
  if (pending.attempts >= MAX_OTP_ATTEMPTS) throw new Error('OTP_BLOCKED');
  if (isExpired(pending.expiresAt)) throw new Error('OTP_EXPIRED');

  if (!verifyOtpHash(code, pending.hash)) {
    await otpRef(params.businessId).set({ attempts: pending.attempts + 1 }, { merge: true });
    throw new Error('OTP_INVALID');
  }

  await assertPhoneAvailable(params.businessId, phone);

  const now = new Date().toISOString();
  const prev = business.contactVerification;
  await updateBusiness(
    params.businessId,
    {
      contactVerification: {
        email: prev?.email ?? '',
        emailVerified: prev?.emailVerified === true,
        emailVerifiedAt: prev?.emailVerifiedAt ?? null,
        emailStatus: prev?.emailStatus,
        phone,
        phoneVerified: true,
        phoneVerifiedAt: now,
        phoneStatus: 'verified',
        whatsappOptIn: true,
        whatsappOptInAt: now,
        termsAcceptedAt: prev?.termsAcceptedAt ?? null,
        termsVersion: prev?.termsVersion ?? null,
        privacyAcceptedAt: prev?.privacyAcceptedAt ?? null,
        marketingEmailOptIn: prev?.marketingEmailOptIn,
        lastOtpSentAt: now,
        otpAttempts: 0,
      },
    },
    { changedBy: 'system', historyNote: 'WhatsApp verificado para activar RiloBot' }
  );

  await bindContactClaimToBusiness('phone', phone.toLowerCase(), params.businessId);
  await otpRef(params.businessId).delete();

  return { phone };
}
