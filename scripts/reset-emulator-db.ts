/**
 * Borra todos los datos del Firestore emulator y deja solo:
 * - superadmin de plataforma
 * - planes por defecto
 *
 * Uso (con emuladores encendidos): npm run emulators:reset
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { ensureDefaultPlatformAdmin } from '../backend/auth/platform.ts';
import { ensureDefaultPlans } from '../backend/auth/plans.ts';

const ROOT_COLLECTIONS = ['negocios', 'planes', 'platform_admins'] as const;

async function deleteRootCollection(name: string): Promise<void> {
  const ref = db.collection(name);
  await db.recursiveDelete(ref);
  console.log(`[reset] Colección eliminada: ${name}`);
}

async function main(): Promise<void> {
  if (process.env.USE_FIRESTORE_EMULATOR !== 'true') {
    console.error(
      '[reset] Abortado: USE_FIRESTORE_EMULATOR debe ser true (solo emulador local).'
    );
    process.exit(1);
  }

  console.log('[reset] Limpiando Firestore emulator...');

  for (const name of ROOT_COLLECTIONS) {
    await deleteRootCollection(name);
  }

  await ensureDefaultPlatformAdmin();
  await ensureDefaultPlans();

  const user = process.env.PLATFORM_ADMIN_USER ?? 'rilo';
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'superadmin';
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? '';

  console.log('');
  console.log('[reset] Listo. Base en cero con datos mínimos de plataforma.');
  console.log('[reset] Superadmin → http://localhost:3000/acceso-plataforma');
  console.log(`[reset] Usuario: ${user} · Contraseña: ${password}`);
  if (email) {
    console.log(`[reset] Email Google: ${email}`);
  } else {
    console.log('[reset] Google: cargá PLATFORM_ADMIN_EMAIL en .env o el email en Mi cuenta');
  }
  console.log('[reset] Panel → http://localhost:3000/platform');
}

main().catch((error) => {
  console.error('[reset] Error:', error);
  process.exit(1);
});
