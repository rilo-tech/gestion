/**
 * Backfill idempotente de `codigoBarrasKey` en productos de un negocio.
 *
 * Uso:
 *   npx tsx scripts/backfill-product-barcodes.ts --businessId=<id> --dry-run
 *   npx tsx scripts/backfill-product-barcodes.ts --businessId=<id>
 *
 * NO ejecutar en producción sin dry-run previo y backup.
 * Detecta duplicados de key normalizada sin pisar datos ajenos.
 */
import { db } from '../backend/firebase.ts';
import { normalizeBarcodeKey } from '../shared/barcode.ts';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const businessId = arg('businessId')?.trim();
  const dryRun = hasFlag('dry-run') || !hasFlag('apply');
  if (!businessId) {
    console.error('Falta --businessId=<id>');
    console.error('Ejemplo dry-run: npx tsx scripts/backfill-product-barcodes.ts --businessId=rilo --dry-run');
    console.error('Ejemplo apply:   npx tsx scripts/backfill-product-barcodes.ts --businessId=rilo --apply');
    process.exit(1);
  }

  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  let found = 0;
  let updated = 0;
  let skipped = 0;
  const keyOwners = new Map<string, string[]>();

  for (const doc of snap.docs) {
    const data = doc.data();
    const raw = data.codigoBarras;
    const key = normalizeBarcodeKey(raw);
    if (!key) {
      skipped += 1;
      continue;
    }
    found += 1;
    const owners = keyOwners.get(key) ?? [];
    owners.push(doc.id);
    keyOwners.set(key, owners);

    const currentKey = normalizeBarcodeKey(data.codigoBarrasKey);
    if (currentKey === key && String(data.codigoBarras ?? '') === key) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await doc.ref.update({
        codigoBarras: key,
        codigoBarrasKey: key,
        barcodeBackfillAt: new Date().toISOString(),
      });
    }
    updated += 1;
  }

  const duplicates: Array<{ key: string; productIds: string[] }> = [];
  for (const [key, ids] of keyOwners) {
    if (ids.length > 1) duplicates.push({ key, productIds: ids });
  }

  console.log(
    JSON.stringify(
      {
        businessId,
        dryRun,
        totalDocs: snap.size,
        withBarcode: found,
        updated,
        skippedOrAlreadyOk: skipped,
        duplicatesDetected: duplicates.length,
        duplicates: duplicates.slice(0, 50),
      },
      null,
      2
    )
  );

  if (duplicates.length) {
    console.warn(
      `⚠ ${duplicates.length} keys duplicadas. Revisar antes de confiar en unicidad.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
