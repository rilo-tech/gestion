/**
 * Corrige el monto de un egreso de resumen de tarjeta según las cuotas vinculadas.
 *
 * Uso:
 *   npx tsx scripts/fix-resumen-caja-movimiento.ts 9CjY0XKfEPpT8xZ5Bemo
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { invalidatePayablesReconcileCache } from '../backend/utils/payables.ts';

const businessId = 'rilo';
const movimientoId = process.argv[2]?.trim();

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  if (!movimientoId) {
    console.error('Indicá el id del movimiento de caja.');
    process.exit(1);
  }

  const movRef = db.doc(`negocios/${businessId}/movimientos_caja/${movimientoId}`);
  const movSnap = await movRef.get();
  if (!movSnap.exists) {
    console.error('Movimiento no encontrado.');
    process.exit(1);
  }

  const mov = movSnap.data() ?? {};
  if (String(mov.origenTipo ?? '') !== 'tarjeta_resumen') {
    console.error('El movimiento no es un resumen de tarjeta.');
    process.exit(1);
  }

  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  const linked = cuotasSnap.docs
    .map((doc) => doc.data())
    .filter((row) => String(row.movimientoCajaId ?? '').trim() === movimientoId);

  if (linked.length === 0) {
    console.error('No hay cuotas vinculadas a ese movimiento.');
    process.exit(1);
  }

  const netTotal = roundMoney(linked.reduce((acc, row) => acc + (Number(row.monto) || 0), 0));
  const positiveTotal = roundMoney(
    linked.filter((row) => (Number(row.monto) || 0) > 0).reduce((acc, row) => acc + (Number(row.monto) || 0), 0)
  );
  const targetMonto = netTotal > 0 ? netTotal : positiveTotal;

  const concepto = String(mov.concepto ?? '');
  const nextConcepto = concepto.startsWith('Pago parcial resumen')
    ? concepto.replace('Pago parcial resumen', 'Resumen')
    : concepto;

  await movRef.update({
    monto: targetMonto,
    concepto: nextConcepto,
  });

  invalidatePayablesReconcileCache(businessId);

  console.log(`Movimiento ${movimientoId}`);
  console.log(`  Antes: $${mov.monto} · ${concepto}`);
  console.log(`  Ahora: $${targetMonto} · ${nextConcepto}`);
  console.log(`  Cuotas vinculadas: ${linked.length} · neto cuotas $${netTotal}`);
  for (const row of linked.sort((a, b) => String(a.compraLabel).localeCompare(String(b.compraLabel)))) {
    console.log(`    #${row.compraLabel} · $${row.monto}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
