import { db } from '../firebase.ts';
import { getBusiness, updateBusiness } from './business.ts';
import {
  generateOtpCode,
  hashOtp,
  isExpired,
  logDevOtp,
  otpExpiresAt,
  verifyOtpHash,
} from '../utils/trial-verification.ts';
import { isValidE164Phone, normalizePhone } from '../../shared/phone.ts';
import { isWhatsappOutboundConfigured, sendWhatsappText } from '../whatsapp/meta-api.ts';
import { findWhatsappPhoneOwner, upsertWhatsappUser } from '../whatsapp/whatsapp-users.ts';

const MAX_OTP_ATTEMPTS = 5;

function otpRef(businessId: string, lineId: string) {
  return db.doc(`negocios/${businessId}/private/whatsapp_line_otp_${lineId}`);
}

function resolvePhone(raw: string): string {
  const phone = normalizePhone(String(raw ?? '').trim());
  if (!isValidE164Phone(phone)) throw new Error('PHONE_INVALID');
  return phone;
}

export async function sendExtraWhatsappLineCode(params: {
  businessId: string;
  lineId: string;
  phone: string;
}): Promise<{ phone: string; whatsappSent: boolean; devCode?: string }> {
  const phone = resolvePhone(params.phone);
  const owner = await findWhatsappPhoneOwner(phone, params.businessId);
  if (owner) throw new Error('PHONE_IN_USE');

  const previous = await otpRef(params.businessId, params.lineId).get();
  if (previous.exists) {
    const pending = previous.data() as { phone?: string; sentAt?: string };
    const elapsed = Date.now() - new Date(String(pending.sentAt ?? 0)).getTime();
    if (pending.phone === phone && Number.isFinite(elapsed) && elapsed < 45_000) {
      throw new Error('OTP_COOLDOWN');
    }
  }

  const code = generateOtpCode();
  const now = new Date().toISOString();
  await otpRef(params.businessId, params.lineId).set({
    phone,
    hash: hashOtp(code),
    expiresAt: otpExpiresAt(),
    attempts: 0,
    sentAt: now,
  });
  logDevOtp('extra-whatsapp-line', phone, code);

  let whatsappSent = false;
  if (isWhatsappOutboundConfigured()) {
    const sent = await sendWhatsappText(
      phone,
      `Tu código RiloTech para conectar este número a RILO Bot es ${code}. Vence en 10 minutos.`
    );
    whatsappSent = sent.ok;
  }

  const exposeDev =
    process.env.NODE_ENV !== 'production' && process.env.TRIAL_OTP_DEV_MODE !== 'false';
  return { phone, whatsappSent, ...(exposeDev ? { devCode: code } : {}) };
}

export async function verifyExtraWhatsappLineCode(params: {
  businessId: string;
  lineId: string;
  phone: string;
  code: string;
  name?: string;
}): Promise<{ phone: string }> {
  const phone = resolvePhone(params.phone);
  const code = String(params.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error('OTP_INVALID');

  const snap = await otpRef(params.businessId, params.lineId).get();
  if (!snap.exists) throw new Error('OTP_EXPIRED');
  const pending = snap.data() as {
    phone?: string;
    hash?: string;
    expiresAt?: string;
    attempts?: number;
  };
  if (pending.phone !== phone) throw new Error('OTP_INVALID');
  if ((pending.attempts ?? 0) >= MAX_OTP_ATTEMPTS) throw new Error('OTP_BLOCKED');
  if (isExpired(pending.expiresAt)) throw new Error('OTP_EXPIRED');
  if (!verifyOtpHash(code, pending.hash)) {
    await otpRef(params.businessId, params.lineId).set(
      { attempts: (pending.attempts ?? 0) + 1 },
      { merge: true }
    );
    throw new Error('OTP_INVALID');
  }

  const owner = await findWhatsappPhoneOwner(phone, params.businessId);
  if (owner) throw new Error('PHONE_IN_USE');

  await upsertWhatsappUser(params.businessId, {
    id: params.lineId,
    phone,
    name: params.name?.trim() || phone,
    enabled: true,
    role: 'operador',
  });
  await db.collection(`negocios/${params.businessId}/whatsapp_users`).doc(params.lineId).set(
    {
      kind: 'extra',
      status: 'active',
      enabled: true,
      phone,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  await otpRef(params.businessId, params.lineId).delete();
  return { phone };
}
