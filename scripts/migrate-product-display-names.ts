/**
 * Renombra productos: «Base - Color - Talle» → «Base Color Talle» (solo espacios).
 *
 * Uso:
 *   npx tsx scripts/migrate-product-display-names.ts
 *   npx tsx scripts/migrate-product-display-names.ts --dry-run
 *   npx tsx scripts/migrate-product-display-names.ts rilo
 */
import dotenv from 'dotenv';
dotenv.config();

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import {
  buildProductDisplayName,
  inferNombreBase,
} from '../shared/product-display-name.ts';

if (!getApps().length) {
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    '';
  initializeApp(projectId ? { projectId } : undefined);
}

const db = getFirestore();
const dryRun = process.argv.includes('--dry-run');
const businessArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

function nameKey(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function migrateBusiness(businessId: string): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const seen = new Map<string, string>();
  let updated = 0;
  const pending: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const color = String(data.color ?? '').trim();
    const talle = String(data.talle ?? '').trim();
    let nombreBase = String(data.nombreBase ?? '').trim();
    if (!nombreBase) {
      nombreBase = inferNombreBase(String(data.nombre ?? ''), color, talle);
    }

    const nombre = buildProductDisplayName(nombreBase, color, talle);
    const key = nameKey(nombre);
    const previousHolder = seen.get(key);
    if (previousHolder && previousHolder !== doc.id) {
      console.warn(
        `[${businessId}] Colisión de nombre «${nombre}»: ${previousHolder} y ${doc.id}`
      );
    } else {
      seen.set(key, doc.id);
    }

    const sameNombre = String(data.nombre ?? '').trim() === nombre;
    const sameBase = String(data.nombreBase ?? '').trim() === nombreBase;
    if (sameNombre && sameBase) continue;

    pending.push({
      ref: doc.ref,
      data: {
        nombre,
        nombreBase,
        updatedAt: new Date().toISOString(),
      },
    });
    updated += 1;
    console.log(`  ${String(data.nombre ?? doc.id)} → ${nombre}`);
  }

  if (dryRun || pending.length === 0) return updated;

  const chunkSize = 400;
  for (let i = 0; i < pending.length; i += chunkSize) {
    const batch = db.batch();
    for (const entry of pending.slice(i, i + chunkSize)) {
      batch.update(entry.ref, entry.data);
    }
    await batch.commit();
  }

  return updated;
}

async function main() {
  const targets = businessArg
    ? [businessArg]
    : (await db.collection('negocios').get()).docs.map((doc) => doc.id);

  if (targets.length === 0) {
    console.log('No hay negocios.');
    return;
  }

  console.log(dryRun ? '[dry-run] Sin escritura en Firestore.' : 'Aplicando cambios…');

  let total = 0;
  for (const businessId of targets) {
    console.log(`\n=== ${businessId} ===`);
    total += await migrateBusiness(businessId);
  }

  console.log(`\nListo: ${total} producto(s) ${dryRun ? 'a actualizar' : 'actualizado(s)'}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
