import crypto from 'crypto';

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function hashOtp(code: string): string {
  return hashValue(code.trim());
}

export function otpExpiresAt(now = Date.now()): string {
  return new Date(now + OTP_TTL_MS).toISOString();
}

export function verifyOtpHash(code: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  return hashOtp(code) === hash;
}

export function isExpired(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return true;
  return new Date(iso).getTime() <= now;
}

export function generateEmailVerifyToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function hashEmailToken(token: string): string {
  return hashValue(token);
}

export function emailTokenExpiresAt(now = Date.now()): string {
  return new Date(now + EMAIL_TOKEN_TTL_MS).toISOString();
}

export function buildEmailVerificationUrl(token: string): string {
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/verificar-email?token=${encodeURIComponent(token)}`;
}

export function logDevOtp(context: string, phone: string, code: string): void {
  if (process.env.TRIAL_OTP_DEV_MODE === 'false') return;
  console.log(`[trial-otp] ${context} phone=${phone} code=${code}`);
}

export function logDevEmailVerification(email: string, url: string): void {
  if (process.env.TRIAL_EMAIL_DEV_MODE === 'false') return;
  console.log(`[trial-email] verify email=${email} url=${url}`);
}
