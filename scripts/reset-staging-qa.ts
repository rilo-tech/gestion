/**
 * Borra SOLO tenants cuyo id empieza con `qa-` en rilo-staging.
 * Uso: npm run reset:staging:qa
 * ABORT en producción.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RILO_STAGING_PROJECT_ID,
  assertStagingProjectOrThrow,
} from '../shared/rilo-environment.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(rel: string): void {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
}

loadEnvFile('.env.staging');
loadEnvFile(`functions/.env.${RILO_STAGING_PROJECT_ID}`);
process.env.RILO_ENV = 'staging';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || RILO_STAGING_PROJECT_ID;
process.env.GCLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
process.env.USE_FIRESTORE_EMULATOR = 'false';

assertStagingProjectOrThrow('reset:staging:qa');

const { db } = await import('../backend/firebase.ts');

async function deleteCollection(colPath: string, batchSize = 200): Promise<number> {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(colPath).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function deleteBusinessTree(businessId: string): Promise<void> {
  const subcols = [
    'usuarios',
    'clientes',
    'stock',
    'ventas',
    'pedidos',
    'movimientos_caja',
    'movimientos_stock',
    'obligaciones_pago',
    'cuotas_pago',
    'erp_notices',
    'automations',
    'whatsapp_users',
    'compras',
    'activity',
    'analytics_events',
    'config',
    'private',
  ];
  let total = 0;
  for (const sub of subcols) {
    total += await deleteCollection(`negocios/${businessId}/${sub}`);
  }
  await db.doc(`negocios/${businessId}`).delete();
  console.log(`[reset] deleted ${businessId} (+${total} subdocs approx)`);
}

async function main(): Promise<void> {
  console.log(`[reset:staging:qa] project=${assertStagingProjectOrThrow('reset:staging:qa')}`);
  const snap = await db.collection('negocios').get();
  const targets = snap.docs.filter(
    (d) => d.id.startsWith('qa-') || d.data()?.qaTenant === true
  );
  if (!targets.length) {
    console.log('[reset:staging:qa] nada para borrar');
    return;
  }
  for (const doc of targets) {
    if (!doc.id.startsWith('qa-')) {
      console.warn(`[reset] skip ${doc.id} (qaTenant sin prefijo qa-)`);
      continue;
    }
    await deleteBusinessTree(doc.id);
  }
  console.log('[reset:staging:qa] OK');
}

main().catch((err) => {
  console.error('[reset:staging:qa]', err);
  process.exit(1);
});
