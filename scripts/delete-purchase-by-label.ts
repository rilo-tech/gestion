/**
 * Elimina compras de prueba y datos relacionados (stock, caja, cuentas a pagar).
 * Busca por compraLabel o por sufijo del id (ej. WMDKSR).
 *
 * Uso:
 *   npx tsx scripts/delete-purchase-by-label.ts WMDKSR 2AXDD2
 *   npx tsx scripts/delete-purchase-by-label.ts WMDKSR --reset-counter
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolvePurchaseLabel } from '../backend/utils/purchase-number.ts';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const resetCounter = process.argv.includes('--reset-counter');
const targetLabels = args.map((label) => label.trim().toUpperCase()).filter(Boolean);

if (targetLabels.length === 0) {
  console.error('Uso: npx tsx scripts/delete-purchase-by-label.ts <label|idSuffix> [...] [--reset-counter]');
  process.exit(1);
}

interface PurchaseRecord {
  compraLabel?: string;
  numeroCompra?: number;
  items?: Array<{
    productoId?: string;
    cantidad?: number;
    afectaStock?: boolean;
    tipoLinea?: string;
  }>;
}

function matchesPurchase(compraId: string, data: PurchaseRecord, targets: string[]): boolean {
  const label = resolvePurchaseLabel({ ...data, id: compraId }).toUpperCase();
  const idSuffix = compraId.slice(-6).toUpperCase();
  return targets.some(
    (target) =>
      label === target ||
      String(data.compraLabel ?? '').toUpperCase() === target ||
      idSuffix === target ||
      compraId.toUpperCase() === target ||
      compraId.toUpperCase().endsWith(target)
  );
}

async function reverseStockForPurchase(
  businessId: string,
  compraId: string,
  label: string,
  purchase: PurchaseRecord
): Promise<number> {
  let adjusted = 0;

  for (const line of purchase.items ?? []) {
    const productoId = String(line.productoId ?? '').trim();
    const cantidad = Number(line.cantidad) || 0;
    const affectsStock =
      line.afectaStock !== false &&
      (line.tipoLinea === 'stock' || Boolean(productoId));
    if (!productoId || cantidad <= 0 || !affectsStock) continue;

    const itemRef = db.collection(`negocios/${businessId}/stock`).doc(productoId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) continue;

    const currentStock = Number(itemSnap.data()?.stockActual) || 0;
    const nextStock = Math.max(0, currentStock - cantidad);
    await itemRef.update({
      stockActual: nextStock,
      updatedAt: new Date().toISOString(),
    });
    adjusted++;
    console.log(
      `  [stock] ${productoId}: ${currentStock} → ${nextStock} (-${cantidad}) · compra #${label}`
    );
  }

  return adjusted;
}

async function deleteDocsByField(
  collectionPath: string,
  field: string,
  value: string
): Promise<number> {
  const snap = await db.collection(collectionPath).where(field, '==', value).get();
  for (const doc of snap.docs) {
    await doc.ref.delete();
  }
  return snap.size;
}

async function deleteStockMovementsForPurchase(businessId: string, compraId: string): Promise<number> {
  const base = `negocios/${businessId}/movimientos_stock`;
  const byCompraId = await deleteDocsByField(base, 'compraId', compraId);

  const byOrigenSnap = await db
    .collection(base)
    .where('origenId', '==', compraId)
    .get();
  let byOrigen = 0;
  for (const doc of byOrigenSnap.docs) {
    const origenTipo = String(doc.data().origenTipo ?? '');
    if (origenTipo === 'compra' || doc.data().compraId === compraId) {
      await doc.ref.delete();
      byOrigen++;
    }
  }

  return byCompraId + byOrigen;
}

async function deleteCashMovementsForPurchase(businessId: string, compraId: string): Promise<number> {
  const base = `negocios/${businessId}/movimientos_caja`;
  const byCompraId = await deleteDocsByField(base, 'compraId', compraId);

  const byOrigenSnap = await db
    .collection(base)
    .where('origenId', '==', compraId)
    .get();
  let byOrigen = 0;
  for (const doc of byOrigenSnap.docs) {
    const origenTipo = String(doc.data().origenTipo ?? '');
    if (origenTipo === 'compra' || doc.data().compraId === compraId) {
      await doc.ref.delete();
      byOrigen++;
    }
  }

  return byCompraId + byOrigen;
}

async function deletePayablesForPurchase(businessId: string, compraId: string): Promise<number> {
  const cuotas = await deleteDocsByField(
    `negocios/${businessId}/cuentas_pagar_cuotas`,
    'compraId',
    compraId
  );
  const obligaciones = await deleteDocsByField(
    `negocios/${businessId}/cuentas_pagar_obligaciones`,
    'compraId',
    compraId
  );
  return cuotas + obligaciones;
}

async function resetPurchaseCounter(businessId: string): Promise<void> {
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  const current = snap.exists ? Number(snap.data()?.ultimoCompra) || 0 : 0;

  await counterRef.set(
    { ultimoCompra: 0, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  console.log(`[delete-purchase] Contador ultimoCompra: ${current} → 0 (negocio ${businessId})`);
}

async function main(): Promise<void> {
  console.log(`[delete-purchase] Buscando compras: ${targetLabels.join(', ')}`);

  const negociosSnap = await db.collection('negocios').get();
  let deleted = 0;
  const touchedBusinesses = new Set<string>();

  for (const businessDoc of negociosSnap.docs) {
    const businessId = businessDoc.id;
    const comprasSnap = await db.collection(`negocios/${businessId}/compras`).get();

    for (const compraDoc of comprasSnap.docs) {
      const data = compraDoc.data() as PurchaseRecord;
      if (!matchesPurchase(compraDoc.id, data, targetLabels)) continue;

      const label = resolvePurchaseLabel({ ...data, id: compraDoc.id });
      console.log(`[delete-purchase] Procesando compra #${label} (${compraDoc.id}) en ${businessId}`);

      const stockAdjusted = await reverseStockForPurchase(
        businessId,
        compraDoc.id,
        label,
        data
      );
      const stockMovDeleted = await deleteStockMovementsForPurchase(businessId, compraDoc.id);
      const cashDeleted = await deleteCashMovementsForPurchase(businessId, compraDoc.id);
      const payablesDeleted = await deletePayablesForPurchase(businessId, compraDoc.id);

      await compraDoc.ref.delete();
      deleted++;
      touchedBusinesses.add(businessId);

      console.log(
        `[delete-purchase] Eliminada #${label} · stock revertido: ${stockAdjusted} producto(s) · ` +
          `${stockMovDeleted} mov. stock · ${cashDeleted} mov. caja · ${payablesDeleted} cuotas/obligaciones`
      );
    }
  }

  if (deleted === 0) {
    console.log('[delete-purchase] No se encontró ninguna compra con esos identificadores.');
  } else {
    console.log(`[delete-purchase] Compras eliminadas: ${deleted}`);
  }

  if (resetCounter || deleted > 0) {
    if (touchedBusinesses.size === 0) {
      for (const businessDoc of negociosSnap.docs) {
        touchedBusinesses.add(businessDoc.id);
      }
    }
    for (const businessId of touchedBusinesses) {
      const remainingSnap = await db.collection(`negocios/${businessId}/compras`).get();
      let maxNum = 0;
      for (const doc of remainingSnap.docs) {
        const numero = Number(doc.data().numeroCompra) || 0;
        if (numero > maxNum) maxNum = numero;
      }
      const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
      await counterRef.set(
        { ultimoCompra: maxNum, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      console.log(
        `[delete-purchase] Contador ultimoCompra → ${maxNum} (próxima compra: ${String(maxNum + 1).padStart(5, '0')})`
      );
    }
  }
}

main().catch((error) => {
  console.error('[delete-purchase] Error:', error);
  process.exit(1);
});
