/**
 * Restaura cantidadFaltanteCompra en pedidos donde producción borró los faltantes.
 *
 * Uso:
 *   npx tsx scripts/repair-order-purchase-gaps.ts --order=00002
 *   npx tsx scripts/repair-order-purchase-gaps.ts --order=00002 --apply --restore-stock
 *
 * Faltantes por línea (índice:cantidad):
 *   --gaps=0:1,1:1,2:0
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';
import { repairOrderPurchaseGaps } from '../backend/utils/order-stock-reservations.ts';

const APPLY = process.argv.includes('--apply');
const RESTORE_STOCK = process.argv.includes('--restore-stock');
const BUSINESS_ID = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';
const ORDER_LABEL = (
  process.argv.find((arg) => arg.startsWith('--order='))?.split('=')[1] ?? '00002'
).padStart(5, '0');

const DEFAULT_GAPS: Record<string, string> = {
  '00002': '0:1,1:1,2:0',
};

function parseGaps(raw: string): Array<{ lineIndex: number; cantidadFaltanteCompra: number }> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [indexRaw, qtyRaw] = part.split(':');
      return {
        lineIndex: Number(indexRaw),
        cantidadFaltanteCompra: Math.max(0, Number(qtyRaw) || 0),
      };
    })
    .filter((entry) => !Number.isNaN(entry.lineIndex));
}

async function main(): Promise<void> {
  const gapsArg = process.argv.find((arg) => arg.startsWith('--gaps='))?.split('=')[1];
  const gapsRaw = gapsArg ?? DEFAULT_GAPS[ORDER_LABEL];
  if (!gapsRaw) {
    throw new Error(`Definí --gaps= para el pedido #${ORDER_LABEL}.`);
  }

  const repairs = parseGaps(gapsRaw);
  const snap = await db.collection(`negocios/${BUSINESS_ID}/pedidos`).get();
  const orderDoc = snap.docs.find((doc) => resolveOrderLabel(doc.data()) === ORDER_LABEL);
  if (!orderDoc) {
    throw new Error(`Pedido #${ORDER_LABEL} no encontrado.`);
  }

  console.log(`[repair] Pedido #${ORDER_LABEL} (${orderDoc.id})`);
  console.log(`[repair] Reparaciones:`, repairs);
  console.log(`[repair] Modo: ${APPLY ? 'APLICAR' : 'SIMULACIÓN'} · restore-stock=${RESTORE_STOCK}`);

  if (!APPLY) {
    console.log('[repair] Ejecutá con --apply para persistir.');
    return;
  }

  const result = await repairOrderPurchaseGaps(BUSINESS_ID, orderDoc.id, repairs, {
    restoreExcessStock: RESTORE_STOCK,
    orderLabel: ORDER_LABEL,
  });

  console.log(`[repair] estadoStock → ${result.estadoStock}`);
  for (const [index, line] of result.items.entries()) {
    console.log(
      `  ${index} ${line.nombre}: usada=${line.cantidadUsada} faltante=${line.cantidadFaltante} compra=${line.cantidadFaltanteCompra}`
    );
  }
  if (result.stockRestored.length > 0) {
    console.log('[repair] Stock restaurado:');
    for (const row of result.stockRestored) {
      console.log(`  - ${row.nombre}: +${row.cantidad} u.`);
    }
  }
}

main().catch((error) => {
  console.error('[repair] Error:', error);
  process.exit(1);
});
