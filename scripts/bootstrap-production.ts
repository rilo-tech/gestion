/**
 * Inicializa Firestore productivo con datos mínimos de plataforma.
 * Requiere GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de service account.
 *
 * Uso: npm run bootstrap:production
 */
import dotenv from 'dotenv';

dotenv.config();

import { ensureDefaultPlatformAdmin } from '../backend/auth/platform.ts';
import { ensureDefaultPlans } from '../backend/auth/plans.ts';

async function main(): Promise<void> {
  if (process.env.USE_FIRESTORE_EMULATOR === 'true') {
    console.error('[bootstrap] Abortado: desactivá USE_FIRESTORE_EMULATOR para productivo.');
    process.exit(1);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('[bootstrap] Falta FIREBASE_PROJECT_ID en .env');
    process.exit(1);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      '[bootstrap] Falta GOOGLE_APPLICATION_CREDENTIALS en .env (JSON de Cuentas de servicio).'
    );
    process.exit(1);
  }

  console.log(`[bootstrap] Proyecto: ${projectId}`);
  console.log('[bootstrap] Creando superadmin de plataforma...');
  console.log('[bootstrap] (Los planes son plantillas vacías para asignar a empresas nuevas.)');

  await ensureDefaultPlans();
  await ensureDefaultPlatformAdmin();

  const user = process.env.PLATFORM_ADMIN_USER ?? 'superadmin';
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? '(sin email)';

  console.log('');
  console.log('[bootstrap] Listo.');
  console.log('[bootstrap] Colecciones creadas al escribir: platform_admins, planes');
  console.log('[bootstrap] Login plataforma → /acceso-plataforma');
  console.log(`[bootstrap] Usuario: ${user}`);
  console.log(`[bootstrap] Email Google: ${email}`);
  console.log('[bootstrap] La contraseña se cambia desde /platform/mi-cuenta');
}

main().catch((error) => {
  console.error('[bootstrap] Error:', error);
  process.exit(1);
});
