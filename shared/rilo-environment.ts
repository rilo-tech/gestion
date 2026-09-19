/**
 * Identidad de entorno RILO (local / staging / production).
 * Usado por scripts de QA, WhatsApp outbound, analytics y OTP.
 */
export const RILO_PRODUCTION_PROJECT_ID = 'rilo-7eff4';
export const RILO_STAGING_PROJECT_ID = 'rilo-staging';

export type RiloEnvironment = 'local' | 'staging' | 'production' | 'unknown';

export function resolveFirebaseProjectId(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.FIREBASE_PROJECT_ID?.trim() ||
    env.GCLOUD_PROJECT?.trim() ||
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    ''
  );
}

export function resolveRiloEnvironment(
  env: NodeJS.ProcessEnv = process.env
): RiloEnvironment {
  const explicit = (env.RILO_ENV || env.VITE_RILO_ENV || '').trim().toLowerCase();
  if (explicit === 'staging' || explicit === 'production' || explicit === 'local') {
    return explicit;
  }
  if (env.USE_FIRESTORE_EMULATOR === 'true') return 'local';
  const project = resolveFirebaseProjectId(env);
  if (project === RILO_STAGING_PROJECT_ID) return 'staging';
  if (project === RILO_PRODUCTION_PROJECT_ID) return 'production';
  return 'unknown';
}

export function isStagingEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRiloEnvironment(env) === 'staging';
}

export function isProductionProjectId(projectId: string): boolean {
  return projectId.trim() === RILO_PRODUCTION_PROJECT_ID;
}

/**
 * Abort si el proyecto es producción o no es exactamente rilo-staging.
 * Para seed / reset / deploy staging / smoke mutante.
 */
export function assertStagingProjectOrThrow(
  context: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const projectId = resolveFirebaseProjectId(env);
  if (!projectId) {
    throw new Error(`[${context}] ABORT: falta FIREBASE_PROJECT_ID / GCLOUD_PROJECT`);
  }
  if (isProductionProjectId(projectId)) {
    throw new Error(
      `[${context}] ABORT: proyecto de producción (${RILO_PRODUCTION_PROJECT_ID}) está prohibido`
    );
  }
  if (projectId !== RILO_STAGING_PROJECT_ID) {
    throw new Error(
      `[${context}] ABORT: esperado ${RILO_STAGING_PROJECT_ID}, recibido «${projectId}»`
    );
  }
  if (env.USE_FIRESTORE_EMULATOR === 'true') {
    throw new Error(`[${context}] ABORT: no usar Firestore emulator para scripts staging`);
  }
  return projectId;
}

/** OTP / email en pantalla: local o staging (nunca producción). */
export function allowDevOtpExposure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TRIAL_OTP_DEV_MODE === 'false') return false;
  if (isProductionProjectId(resolveFirebaseProjectId(env))) return false;
  if (resolveRiloEnvironment(env) === 'production') return false;
  if (isStagingEnvironment(env)) return true;
  if (env.NODE_ENV === 'production' && !isStagingEnvironment(env)) return false;
  return env.TRIAL_OTP_DEV_MODE !== 'false';
}

/** Allowlist E164 (o dígitos) para WhatsApp en staging. */
export function parseStagingWhatsappAllowlist(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const raw = env.WHATSAPP_STAGING_ALLOWLIST?.trim() || '';
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(/\D/g, ''))
    .filter((p) => p.length >= 8);
}

export function isStagingWhatsappRecipientAllowed(
  toE164OrDigits: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isStagingEnvironment(env)) return true;
  const allow = parseStagingWhatsappAllowlist(env);
  if (allow.length === 0) return false;
  const digits = toE164OrDigits.replace(/\D/g, '');
  return allow.some((a) => a === digits || digits.endsWith(a) || a.endsWith(digits));
}

/** En staging, forzar sandbox MP aunque falte la flag (defensa). */
export function shouldUseMercadoPagoSandbox(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (isStagingEnvironment(env)) return true;
  return env.MERCADOPAGO_USE_SANDBOX === 'true';
}

/** External analytics (Meta/GA4) off por default en staging. */
export function allowExternalAnalytics(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): boolean {
  const rilEnv = (env.RILO_ENV || env.VITE_RILO_ENV || '').toLowerCase();
  if (rilEnv === 'staging') {
    return env.VITE_ANALYTICS_EXTERNAL === 'true' || env.ANALYTICS_EXTERNAL === 'true';
  }
  if (rilEnv === 'local') return false;
  return true;
}
