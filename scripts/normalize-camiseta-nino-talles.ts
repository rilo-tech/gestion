/**
 * Normaliza talles 00/01/04/06/08 → 0/1/4/6/8 en camisetas de algodón niño.
 * Si quedan duplicados (misma base + color + talle), elimina el sobrante.
 *
 * Uso:
 *   npx tsx scripts/normalize-camiseta-nino-talles.ts --dry-run
 *   npx tsx scripts/normalize-camiseta-nino-talles.ts rilo
 *   npx tsx scripts/normalize-camiseta-nino-talles.ts rilo --dry-run
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
const inspectOnly = process.argv.includes('--inspect');
const listCamisetas = process.argv.includes('--list-camiseta');
const businessArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

const PADDED_TALLES = new Map([
  ['00', '0'],
  ['01', '1'],
  ['04', '4'],
  ['06', '6'],
  ['08', '8'],
]);

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function isCamisetaAlgodonNino(data: Record<string, unknown>): boolean {
  const color = String(data.color ?? '').trim();
  const talle = String(data.talle ?? '').trim();
  let nombreBase = String(data.nombreBase ?? '').trim();
  if (!nombreBase) {
    nombreBase = inferNombreBase(String(data.nombre ?? ''), color, talle);
  }
  const base = normalizeText(nombreBase);
  return (
    base.includes('camiseta') &&
    base.includes('algodon') &&
    base.includes('nino')
  );
}

function variantKey(
  nombreBase: string,
  color: string,
  talle: string
): string {
  return [
    normalizeText(nombreBase),
    normalizeText(color),
    normalizeText(talle),
  ].join('|');
}

type StockDoc = {
  id: string;
  ref: DocumentReference;
  data: Record<string, unknown>;
  nombreBase: string;
  color: string;
  talle: string;
  nombre: string;
  stockActual: number;
  stockReservado: number;
};

function toStockDoc(id: string, ref: DocumentReference, data: Record<string, unknown>): StockDoc {
  const color = String(data.color ?? '').trim();
  const talle = String(data.talle ?? '').trim();
  let nombreBase = String(data.nombreBase ?? '').trim();
  if (!nombreBase) {
    nombreBase = inferNombreBase(String(data.nombre ?? ''), color, talle);
  }
  return {
    id,
    ref,
    data,
    nombreBase,
    color,
    talle,
    nombre: String(data.nombre ?? '').trim(),
    stockActual: Number(data.stockActual) || 0,
    stockReservado: Number(data.stockReservado) || 0,
  };
}

function pickKeeper(group: StockDoc[]): StockDoc {
  return [...group].sort((a, b) => {
    const stockDiff = b.stockActual - a.stockActual;
    if (stockDiff !== 0) return stockDiff;
    const updatedA = String(a.data.updatedAt ?? a.data.createdAt ?? '');
    const updatedB = String(b.data.updatedAt ?? b.data.createdAt ?? '');
    return updatedA.localeCompare(updatedB);
  })[0];
}

async function listCamisetaBusiness(businessId: string): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  console.log(`\n=== ${businessId} (camisetas algodón niño) ===`);
  const rows: Array<{ talle: string; color: string; nombre: string; id: string }> = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!isCamisetaAlgodonNino(data)) continue;
    rows.push({
      talle: String(data.talle ?? '').trim(),
      color: String(data.color ?? '').trim(),
      nombre: String(data.nombre ?? '').trim(),
      id: doc.id,
    });
  }
  rows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  for (const row of rows) {
    console.log(`${row.talle.padEnd(3)} | ${row.color.padEnd(10)} | ${row.nombre} | ${row.id}`);
  }
  console.log(`Total: ${rows.length}`);
}

async function inspectBusiness(businessId: string): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const padded = new Set([...PADDED_TALLES.keys()]);
  console.log(`\n=== ${businessId} (inspect) ===`);
  for (const doc of snap.docs) {
    const data = doc.data();
    const talle = String(data.talle ?? '').trim();
    if (!padded.has(talle)) continue;
    const color = String(data.color ?? '').trim();
    let nombreBase = String(data.nombreBase ?? '').trim();
    if (!nombreBase) {
      nombreBase = inferNombreBase(String(data.nombre ?? ''), color, talle);
    }
    const match = isCamisetaAlgodonNino(data) ? 'SÍ' : 'no';
    console.log(
      `${match} | talle ${talle} | ${nombreBase} | ${String(data.nombre ?? '')} | ${doc.id}`
    );
  }
}

async function migrateBusiness(businessId: string): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const all = snap.docs.map((doc) => toStockDoc(doc.id, doc.ref, doc.data()));

  const targets = all.filter((item) => {
    if (!isCamisetaAlgodonNino(item.data)) return false;
    return PADDED_TALLES.has(item.talle);
  });

  console.log(`\n=== ${businessId} ===`);
  console.log(`Productos camiseta algodón niño con talle 00/01/04/06/08: ${targets.length}`);

  const updates: Array<{ ref: DocumentReference; patch: Record<string, unknown>; label: string }> = [];

  for (const item of targets) {
    const newTalle = PADDED_TALLES.get(item.talle)!;
    const newNombre = buildProductDisplayName(item.nombreBase, item.color, newTalle);
    updates.push({
      ref: item.ref,
      patch: {
        talle: newTalle,
        nombre: newNombre,
        nombreBase: item.nombreBase,
        updatedAt: new Date().toISOString(),
      },
      label: `${item.nombre} → ${newNombre}`,
    });
    console.log(`  [talle] ${item.id}: ${item.talle} → ${newTalle} (${item.nombre} → ${newNombre})`);
  }

  // Duplicates after normalization (including pre-existing single-digit + padded twin)
  const byVariant = new Map<string, StockDoc[]>();
  for (const item of all) {
    if (!isCamisetaAlgodonNino(item.data)) continue;
    let talle = item.talle;
    if (PADDED_TALLES.has(talle)) talle = PADDED_TALLES.get(talle)!;
    const key = variantKey(item.nombreBase, item.color, talle);
    const list = byVariant.get(key) ?? [];
    list.push({ ...item, talle, nombre: buildProductDisplayName(item.nombreBase, item.color, talle) });
    byVariant.set(key, list);
  }

  const deletions: Array<{ ref: DocumentReference; label: string; mergeStockTo?: DocumentReference }> = [];
  const stockMerges: Array<{ ref: DocumentReference; patch: Record<string, unknown>; label: string }> = [];

  for (const [key, group] of byVariant) {
    if (group.length <= 1) continue;
    const keeper = pickKeeper(group);
    const duplicates = group.filter((item) => item.id !== keeper.id);
    const extraStock = duplicates.reduce((sum, item) => sum + item.stockActual, 0);
    const extraReservado = duplicates.reduce((sum, item) => sum + item.stockReservado, 0);

    console.log(`  [dup] ${key}: conservar ${keeper.id}, borrar ${duplicates.map((d) => d.id).join(', ')}`);

    if (extraStock !== 0 || extraReservado !== 0) {
      stockMerges.push({
        ref: keeper.ref,
        patch: {
          stockActual: keeper.stockActual + extraStock,
          stockReservado: keeper.stockReservado + extraReservado,
          updatedAt: new Date().toISOString(),
        },
        label: `${keeper.id}: stock ${keeper.stockActual}→${keeper.stockActual + extraStock}, reservado ${keeper.stockReservado}→${keeper.stockReservado + extraReservado}`,
      });
      console.log(`    merge stock → ${keeper.id}: +${extraStock} actual, +${extraReservado} reservado`);
    }

    for (const dup of duplicates) {
      deletions.push({
        ref: dup.ref,
        label: `${dup.id} (${dup.nombre}, talle ${dup.talle})`,
      });
      console.log(`    delete ${dup.id}: ${dup.nombre}`);
    }
  }

  if (dryRun) {
    console.log(
      `[dry-run] ${updates.length} actualización(es), ${stockMerges.length} merge(s), ${deletions.length} eliminación(es).`
    );
    return;
  }

  const chunkSize = 400;
  const writeOps: Array<() => Promise<void>> = [];

  for (const entry of updates) {
    writeOps.push(async () => {
      await entry.ref.update(entry.patch);
    });
  }
  for (const entry of stockMerges) {
    writeOps.push(async () => {
      await entry.ref.update(entry.patch);
    });
  }
  for (const entry of deletions) {
    writeOps.push(async () => {
      await entry.ref.delete();
    });
  }

  for (let i = 0; i < writeOps.length; i += chunkSize) {
    await Promise.all(writeOps.slice(i, i + chunkSize).map((op) => op()));
  }

  console.log(
    `Listo: ${updates.length} actualizado(s), ${stockMerges.length} merge(s), ${deletions.length} eliminado(s).`
  );
}

async function main() {
  const targets = businessArg
    ? [businessArg]
    : (await db.collection('negocios').get()).docs.map((doc) => doc.id);

  if (targets.length === 0) {
    console.log('No hay negocios.');
    return;
  }

  if (listCamisetas || inspectOnly) {
    // solo lectura
  } else {
    console.log(dryRun ? '[dry-run] Sin escritura en Firestore.' : 'Aplicando cambios…');
  }

  for (const businessId of targets) {
    if (listCamisetas) {
      await listCamisetaBusiness(businessId);
    } else if (inspectOnly) {
      await inspectBusiness(businessId);
    } else {
      await migrateBusiness(businessId);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
