/**
 * Normaliza talles numéricos con cero a la izquierda (00, 01, 02…) a un dígito.
 * Si quedan duplicados (misma base + color + talle), fusiona stock y elimina el sobrante.
 *
 * Uso:
 *   npx tsx scripts/normalize-padded-talles.ts rilo --dry-run
 *   npx tsx scripts/normalize-padded-talles.ts rilo
 *   npx tsx scripts/normalize-padded-talles.ts rilo --inspect
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
const businessArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

/** 00→0, 01→1, 02→2, etc. Solo talles numéricos con más de un carácter que empiezan en 0. */
export function normalizeLeadingZeroTalle(talle: string): string | null {
  const trimmed = talle.trim();
  if (!trimmed || trimmed.length <= 1) return null;
  if (!/^0\d+$/.test(trimmed)) return null;
  return String(parseInt(trimmed, 10));
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function resolvedTalle(talle: string): string {
  return normalizeLeadingZeroTalle(talle) ?? talle;
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

async function inspectBusiness(businessId: string): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  console.log(`\n=== ${businessId} (talles con cero a la izquierda) ===`);
  for (const doc of snap.docs) {
    const data = doc.data();
    const talle = String(data.talle ?? '').trim();
    const normalized = normalizeLeadingZeroTalle(talle);
    if (!normalized) continue;
    console.log(
      `  ${talle} → ${normalized} | ${String(data.nombre ?? '')} | ${doc.id}`
    );
  }
}

async function migrateBusiness(businessId: string): Promise<void> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const all = snap.docs.map((doc) => toStockDoc(doc.id, doc.ref, doc.data()));

  const targets = all.filter((item) => normalizeLeadingZeroTalle(item.talle) !== null);

  console.log(`\n=== ${businessId} ===`);
  console.log(`Productos con talle numérico 0X: ${targets.length}`);

  const updates: Array<{ ref: DocumentReference; patch: Record<string, unknown> }> = [];

  for (const item of targets) {
    const newTalle = normalizeLeadingZeroTalle(item.talle)!;
    const newNombre = buildProductDisplayName(item.nombreBase, item.color, newTalle);
    updates.push({
      ref: item.ref,
      patch: {
        talle: newTalle,
        nombre: newNombre,
        nombreBase: item.nombreBase,
        updatedAt: new Date().toISOString(),
      },
    });
    console.log(`  [talle] ${item.id}: ${item.talle} → ${newTalle} (${item.nombre} → ${newNombre})`);
  }

  const byVariant = new Map<string, StockDoc[]>();
  for (const item of all) {
    const talle = resolvedTalle(item.talle);
    const key = variantKey(item.nombreBase, item.color, talle);
    const list = byVariant.get(key) ?? [];
    list.push({
      ...item,
      talle,
      nombre: buildProductDisplayName(item.nombreBase, item.color, talle),
    });
    byVariant.set(key, list);
  }

  const deletions: Array<{ ref: DocumentReference }> = [];
  const stockMerges: Array<{ ref: DocumentReference; patch: Record<string, unknown> }> = [];

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
      });
      console.log(`    merge stock → ${keeper.id}: +${extraStock} actual, +${extraReservado} reservado`);
    }

    for (const dup of duplicates) {
      deletions.push({ ref: dup.ref });
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

  if (!inspectOnly) {
    console.log(dryRun ? '[dry-run] Sin escritura en Firestore.' : 'Aplicando cambios…');
  }

  for (const businessId of targets) {
    if (inspectOnly) {
      await inspectBusiness(businessId);
    } else {
      await migrateBusiness(businessId);
    }
  }
}

const isMain =
  process.argv[1]?.replace(/\\/g, '/').includes('normalize-padded-talles');

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
