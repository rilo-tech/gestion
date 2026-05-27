/**
 * Limpia movimientos de stock inconsistentes manteniendo stockActual correcto.
 *
 * - Elimina movimiento con productoId inexistente (sin tocar stockActual).
 * - Fusiona ajuste manual de XL en su carga inicial (+1 + +2 → +3).
 *
 * Uso:
 *   npx tsx scripts/repair-stock-movements-consistency.ts
 *   npx tsx scripts/repair-stock-movements-consistency.ts --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID =
  process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';

const ORPHAN_MOVEMENT_ID = 'b4bmTZP4M5xnF6xW5oxl';
const XL_CARGA_INICIAL_ID = '1xoRgf6hJUZyvza6Ifmu';
const XL_AJUSTE_ID = 'VACQgO0i0x6uLddW7A2d';
const XL_PRODUCT_ID = 'gx8j8Nz4t6BlWXgIOs1e';

async function resolveBusinessId(): Promise<string> {
  const explicit = BUSINESS_ID.trim();
  if (explicit) {
    const snap = await db.doc(`negocios/${explicit}`).get();
    if (snap.exists) return explicit;
  }

  const snap = await db.collection('negocios').limit(2).get();
  if (snap.empty) throw new Error('No hay negocios.');
  return snap.docs[0].id;
}

function movementDelta(tipo: string, cantidad: unknown): number {
  const qty = Number(cantidad) || 0;
  return tipo === 'salida' ? -qty : qty;
}

async function sumMovementsForProduct(
  businessId: string,
  productId: string
): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();
  let total = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (String(data.productoId ?? '') !== productId) continue;
    total += movementDelta(String(data.tipo ?? ''), data.cantidad);
  }
  return total;
}

async function main(): Promise<void> {
  const businessId = await resolveBusinessId();
  console.log(`[stock-repair] Negocio: ${businessId}`);
  console.log(`[stock-repair] Modo: ${APPLY ? 'APLICAR' : 'SIMULACIÓN (usá --apply)'}`);

  const orphanRef = db.doc(`negocios/${businessId}/movimientos_stock/${ORPHAN_MOVEMENT_ID}`);
  const orphanSnap = await orphanRef.get();
  if (!orphanSnap.exists) {
    console.log('[stock-repair] Movimiento huérfano ya no existe (omitido).');
  } else {
    const orphan = orphanSnap.data() ?? {};
    const orphanProductId = String(orphan.productoId ?? '');
    const productSnap = orphanProductId
      ? await db.doc(`negocios/${businessId}/stock/${orphanProductId}`).get()
      : null;

    console.log('[stock-repair] Movimiento huérfano:');
    console.log(
      `  - id ${ORPHAN_MOVEMENT_ID} · productoId ${orphanProductId || '(vacío)'} · +${orphan.cantidad} ${orphan.motivo}`
    );

    if (productSnap?.exists) {
      throw new Error(
        `El producto ${orphanProductId} existe; revisá manualmente antes de borrar el movimiento.`
      );
    }

    console.log('  - Producto inexistente → se elimina el movimiento (stockActual no cambia).');
    if (APPLY) await orphanRef.delete();
  }

  const cargaRef = db.doc(`negocios/${businessId}/movimientos_stock/${XL_CARGA_INICIAL_ID}`);
  const ajusteRef = db.doc(`negocios/${businessId}/movimientos_stock/${XL_AJUSTE_ID}`);
  const [cargaSnap, ajusteSnap, xlSnap] = await Promise.all([
    cargaRef.get(),
    ajusteRef.get(),
    db.doc(`negocios/${businessId}/stock/${XL_PRODUCT_ID}`).get(),
  ]);

  if (!cargaSnap.exists || !ajusteSnap.exists) {
    throw new Error('No se encontraron los movimientos de XL para fusionar.');
  }

  const carga = cargaSnap.data() ?? {};
  const ajuste = ajusteSnap.data() ?? {};
  if (String(carga.productoId) !== XL_PRODUCT_ID || String(ajuste.productoId) !== XL_PRODUCT_ID) {
    throw new Error('Los movimientos de XL no apuntan al producto esperado.');
  }

  const cargaQty = Number(carga.cantidad) || 0;
  const ajusteQty = Number(ajuste.cantidad) || 0;
  const mergedQty = cargaQty + ajusteQty;
  const stockActual = Number(xlSnap.data()?.stockActual) || 0;

  console.log('[stock-repair] Fusión XL:');
  console.log(`  - Carga inicial ${cargaQty} + ajuste ${ajusteQty} → carga inicial ${mergedQty}`);
  console.log(`  - stockActual XL: ${stockActual} (sin cambios)`);

  if (stockActual !== mergedQty) {
    throw new Error(
      `Inconsistencia: stockActual XL (${stockActual}) ≠ suma fusionada (${mergedQty}). Abortado.`
    );
  }

  if (APPLY) {
    await cargaRef.update({ cantidad: mergedQty });
    await ajusteRef.delete();
    console.log('[stock-repair] Fusión aplicada.');
  }

  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  console.log('\n[stock-repair] Verificación stock vs movimientos:');
  let mismatches = 0;

  for (const doc of stockSnap.docs) {
    const data = doc.data();
    const expected = await sumMovementsForProduct(businessId, doc.id);
    const actual = Number(data.stockActual) || 0;
    const ok = expected === actual;
    if (!ok) mismatches++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${data.nombre}: movimientos=${expected} · stockActual=${actual}`
    );
  }

  if (mismatches > 0) {
    throw new Error(`Quedaron ${mismatches} producto(s) inconsistentes.`);
  }

  if (!APPLY) {
    console.log('\n[stock-repair] Simulación OK. Ejecutá con --apply para persistir.');
    return;
  }

  console.log('\n[stock-repair] Listo. Movimientos consistentes con stock actual.');
}

main().catch((error) => {
  console.error('[stock-repair] Error:', error);
  process.exit(1);
});
