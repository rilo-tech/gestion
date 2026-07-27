/**
 * Habilita Colaboradores + Reportes en la empresa `rilo`.
 * Uso: npx tsx scripts/enable-rilo-extra-modules.ts
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const BUSINESS_ID = 'rilo';

async function main() {
  const ref = db.collection('negocios').doc(BUSINESS_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`[enable-modules] No existe la empresa "${BUSINESS_ID}".`);
    process.exit(1);
  }

  const data = snap.data() as Record<string, unknown>;
  const suscripcion = {
    ...((data.suscripcion as Record<string, unknown>) ?? {}),
  };
  const modulosOverride = {
    ...((suscripcion.modulosOverride as Record<string, string>) ?? {}),
    collaborators: 'on',
    reports: 'on',
  };
  const preciosAddonModuloOverride = {
    ...((suscripcion.preciosAddonModuloOverride as Record<string, number>) ?? {}),
    collaborators:
      typeof (suscripcion.preciosAddonModuloOverride as Record<string, number> | undefined)
        ?.collaborators === 'number'
        ? (suscripcion.preciosAddonModuloOverride as Record<string, number>).collaborators
        : 490,
    reports:
      typeof (suscripcion.preciosAddonModuloOverride as Record<string, number> | undefined)
        ?.reports === 'number'
        ? (suscripcion.preciosAddonModuloOverride as Record<string, number>).reports
        : 490,
  };

  suscripcion.modulosOverride = modulosOverride;
  suscripcion.preciosAddonModuloOverride = preciosAddonModuloOverride;

  await ref.update({
    suscripcion,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[enable-modules] OK → ${BUSINESS_ID}`);
  console.log('[enable-modules] collaborators=on, reports=on (+$490 c/u sugerido)');
}

main().catch((error) => {
  console.error('[enable-modules] Error:', error);
  process.exit(1);
});
