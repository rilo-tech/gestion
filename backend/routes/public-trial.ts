import express from 'express';
import { checkRateLimit, clientIp } from '../utils/rate-limit.ts';
import {
  registerTrialLead,
  completeTrialRegistration,
} from '../auth/trial-registration-service.ts';
import { formatPhoneDisplay } from '../../shared/phone.ts';
import {
  getTrialRegistration,
  updateTrialRegistration,
  findRegistrationByEmailTokenHash,
} from '../auth/trial-registration-store.ts';
import { hashPassword } from '../auth/password.ts';
import {
  generateOtpCode,
  hashOtp,
  otpExpiresAt,
  verifyOtpHash,
  isExpired,
  generateEmailVerifyToken,
  hashEmailToken,
  emailTokenExpiresAt,
  buildEmailVerificationUrl,
  logDevOtp,
  logDevEmailVerification,
} from '../utils/trial-verification.ts';
import {
  sendTrialSignupCodeEmail,
  sendTrialEmailVerificationLink,
} from '../utils/transactional-email.ts';
import { toPublicBusinessInfo, toSessionBusinessInfo } from '../auth/business.ts';

const router = express.Router();

const MAX_OTP_ATTEMPTS = 5;

function mapTrialError(error: unknown): { status: number; message: string; code?: string } {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  const messages: Record<string, { status: number; message: string }> = {
    SPAM_DETECTED: { status: 400, message: 'No se pudo procesar el registro.' },
    BUSINESS_NAME_REQUIRED: { status: 400, message: 'Ingresá el nombre del negocio.' },
    RUBRO_REQUIRED: { status: 400, message: 'Seleccioná un rubro.' },
    LOCATION_REQUIRED: { status: 400, message: 'Completá país y ciudad.' },
    OWNER_NAME_REQUIRED: { status: 400, message: 'Ingresá nombre y apellido del responsable.' },
    EMAIL_INVALID: { status: 400, message: 'El email no es válido.' },
    PHONE_INVALID: { status: 400, message: 'El teléfono no es válido.' },
    TERMS_REQUIRED: { status: 400, message: 'Debés aceptar términos y privacidad.' },
    PASSWORD_TOO_SHORT: { status: 400, message: 'La contraseña debe tener al menos 8 caracteres.' },
    EMAIL_ALREADY_USED: {
      status: 409,
      message: 'Ese email ya tiene una cuenta. Ingresá con esos datos; no se crea otra empresa.',
    },
    PHONE_ALREADY_USED: {
      status: 409,
      message: 'Ese teléfono ya tiene una cuenta. Ingresá con esos datos; no se crea otra empresa.',
    },
    CONTACT_MISMATCH: {
      status: 409,
      message: 'Ese email y teléfono pertenecen a empresas distintas. Usá los datos de la misma cuenta.',
    },
    EXISTING_ACCOUNT_PASSWORD_REQUIRED: {
      status: 400,
      message: 'Esa cuenta ya existe. Ingresá la contraseña actual para sumar el módulo.',
    },
    EXISTING_ACCOUNT_WRONG_PASSWORD: {
      status: 401,
      message: 'Esa cuenta ya existe. La contraseña no coincide. Usá la misma con la que ingresás al sistema.',
    },
    EXISTING_ACCOUNT_EMAIL_MISMATCH: {
      status: 409,
      message: 'Ese teléfono ya está en una cuenta. Registrá con el mismo email de esa empresa para sumar el módulo.',
    },
    REGISTRATION_NOT_FOUND: { status: 404, message: 'Registro no encontrado.' },
    PHONE_NOT_VERIFIED: { status: 400, message: 'Verificá tu teléfono antes de continuar.' },
    EMAIL_NOT_VERIFIED: { status: 400, message: 'Verificá tu email antes de continuar.' },
    EMAIL_SEND_FAILED: { status: 503, message: 'No se pudo enviar el email. Probá de nuevo en unos minutos.' },
    EMAIL_NOT_CONFIGURED: {
      status: 503,
      message:
        'El envío de email no está configurado en el servidor. Agregá RESEND_API_KEY al .env y reiniciá npm run dev.',
    },
    MODULE_CHECKOUT_REQUIRED: {
      status: 402,
      message: 'Tu prueba ya no está activa. Ingresá y activá el plan para sumar este módulo.',
    },
    WHATSAPP_PHONE_REQUIRED: {
      status: 400,
      message: 'Para activar RiloBot hace falta el WhatsApp cargado en la cuenta.',
    },
    TRIAL_PLAN_UNAVAILABLE: { status: 503, message: 'El plan de prueba no está disponible.' },
    OTP_RATE_LIMIT: { status: 429, message: 'Esperá un momento antes de pedir otro código.' },
    OTP_INVALID: { status: 400, message: 'Código incorrecto.' },
    OTP_EXPIRED: { status: 400, message: 'El código venció. Pedí uno nuevo.' },
    OTP_BLOCKED: { status: 429, message: 'Demasiados intentos. Pedí un código nuevo.' },
    EMAIL_TOKEN_INVALID: { status: 400, message: 'El enlace de verificación no es válido.' },
    EMAIL_TOKEN_EXPIRED: { status: 400, message: 'El enlace de verificación venció.' },
  };
  const mapped = messages[code];
  if (mapped) return { ...mapped, code };
  console.error('Trial registration error:', error);
  return { status: 500, message: 'No se pudo completar la operación.' };
}

router.post('/register', async (req, res) => {
  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`trial-register:${ip}`, 8, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Demasiados intentos. Probá más tarde.' });
    }

    const { registrationId, existingAccount } = await registerTrialLead(req.body, ip);
    res.status(201).json({ registrationId, nextStep: 'verify_email', existingAccount });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

router.post('/send-phone-code', async (req, res) => {
  try {
    const registrationId = String(req.body.registrationId ?? '').trim();
    const registration = await getTrialRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registro no encontrado.' });
    }

    const ip = clientIp(req);
    const limit = checkRateLimit(`trial-otp:${registrationId}:${ip}`, 5, 15 * 60 * 1000);
    if (!limit.allowed) {
      throw new Error('OTP_RATE_LIMIT');
    }

    const code = generateOtpCode();
    const now = new Date().toISOString();
    await updateTrialRegistration(registrationId, {
      phoneOtpHash: hashOtp(code),
      phoneOtpExpiresAt: otpExpiresAt(),
      phoneOtpAttempts: 0,
      lastOtpSentAt: now,
    });

    logDevOtp('send-email', registration.email, code);

    const delivery = await sendTrialSignupCodeEmail(registration.email, code);
    const devExpose =
      process.env.TRIAL_OTP_DEV_MODE !== 'false' && (delivery.devOnly || !delivery.sent);

    res.json({
      ok: true,
      email: registration.email,
      emailSent: delivery.sent,
      ...(devExpose ? { devCode: code } : {}),
    });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

router.post('/verify-phone', async (req, res) => {
  try {
    const registrationId = String(req.body.registrationId ?? '').trim();
    const code = String(req.body.code ?? '').trim();
    const registration = await getTrialRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registro no encontrado.' });
    }

    if (registration.phoneOtpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new Error('OTP_BLOCKED');
    }

    if (isExpired(registration.phoneOtpExpiresAt)) {
      throw new Error('OTP_EXPIRED');
    }

    if (!verifyOtpHash(code, registration.phoneOtpHash)) {
      await updateTrialRegistration(registrationId, {
        phoneOtpAttempts: registration.phoneOtpAttempts + 1,
      });
      throw new Error('OTP_INVALID');
    }

    const now = new Date().toISOString();
    await updateTrialRegistration(registrationId, {
      emailVerified: true,
      emailVerifiedAt: now,
      status: 'ready',
      phoneOtpHash: null,
      phoneOtpExpiresAt: null,
    });

    res.json({ ok: true, nextStep: 'complete' });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

router.post('/send-email-verification', async (req, res) => {
  try {
    const registrationId = String(req.body.registrationId ?? '').trim();
    const registration = await getTrialRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registro no encontrado.' });
    }

    const token = generateEmailVerifyToken();
    await updateTrialRegistration(registrationId, {
      emailVerifyTokenHash: hashEmailToken(token),
      emailVerifyExpiresAt: emailTokenExpiresAt(),
    });

    const url = buildEmailVerificationUrl(token);
    logDevEmailVerification(registration.email, url);

    const delivery = await sendTrialEmailVerificationLink(registration.email, url);
    const devExpose =
      process.env.TRIAL_EMAIL_DEV_MODE !== 'false' && (delivery.devOnly || !delivery.sent);

    res.json({
      ok: true,
      emailSent: delivery.sent,
      ...(devExpose ? { devVerificationUrl: url } : {}),
    });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

router.post('/verify-email', async (req, res) => {
  try {
    const token = String(req.body.token ?? '').trim();
    const registration = await findRegistrationByEmailTokenHash(hashEmailToken(token));
    if (!registration) {
      throw new Error('EMAIL_TOKEN_INVALID');
    }
    if (isExpired(registration.emailVerifyExpiresAt)) {
      throw new Error('EMAIL_TOKEN_EXPIRED');
    }

    const now = new Date().toISOString();
    await updateTrialRegistration(registration.id, {
      emailVerified: true,
      emailVerifiedAt: now,
      emailVerifyTokenHash: null,
      emailVerifyExpiresAt: null,
    });

    if (registration.completedBusinessId) {
      await dbUpdateBusinessEmailVerified(registration.completedBusinessId, now);
    }

    res.json({ ok: true, registrationId: registration.id });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

async function dbUpdateBusinessEmailVerified(businessId: string, verifiedAt: string) {
  const { db } = await import('../firebase.ts');
  await db.collection('negocios').doc(businessId).update({
    'contactVerification.emailVerified': true,
    'contactVerification.emailVerifiedAt': verifiedAt,
    'contactVerification.emailStatus': 'verified',
    updatedAt: new Date().toISOString(),
  });
}

router.post('/complete', async (req, res) => {
  try {
    const registrationId = String(req.body.registrationId ?? '').trim();
    const result = await completeTrialRegistration(registrationId);

    const businessInfo = await toPublicBusinessInfo(result.businessId, {
      business: result.business,
    });
    const sessionBusiness = await toSessionBusinessInfo(result.businessId);

    const access = result.business.platformAccess;
    res.status(201).json({
      token: result.token,
      user: result.user,
      businessId: result.businessId,
      business: sessionBusiness ?? businessInfo,
      outcome: result.outcome,
      registeredPhone: result.registeredPhone,
      erpWebEnabled: access?.erpWebEnabled === true,
      whatsappEnabled: access?.whatsappEnabled === true,
      loginHint: {
        businessCode: result.businessId,
        loginUsername: result.user.loginUsername,
      },
    });
  } catch (error) {
    const mapped = mapTrialError(error);
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

router.get('/registration/:registrationId', async (req, res) => {
  const registration = await getTrialRegistration(req.params.registrationId);
  if (!registration) {
    return res.status(404).json({ error: 'Registro no encontrado.' });
  }
  res.json({
    id: registration.id,
    businessName: registration.businessName,
    email: registration.email,
    phone: formatPhoneDisplay(registration.phone),
    phoneVerified: registration.phoneVerified,
    emailVerified: registration.emailVerified,
    status: registration.status,
    completedBusinessId: registration.completedBusinessId ?? null,
  });
});

export default router;
