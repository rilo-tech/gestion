/**
 * Corrige resumen junio 2026 Lorelei Paique:
 * - Cuota 1/6 de #00001 ya recalculada con repair-purchase-payables
 * - Desvincula #00007 cuota 1/6 (crédito) del pago de resumen erróneo
 * - Ajusta egreso de caja al monto real de la cuota pagada
 *
 * Uso: npx tsx scripts/fix-compra-00001-resumen.ts
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { invalidatePayablesReconcileCache } from '../backend/utils/payables.ts';

const businessId = 'rilo';
const movimientoId = '9CjY0XKfEPpT8xZ5Bemo';
const mes = '2026-06';
const tarjetaId = 'lorelei_paique_oca_master';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  const cuotas = cuotasSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

  const cuota00007 = cuotas.find(
    (row) =>
      row.compraLabel === '00007' &&
      row.numeroCuota === 1 &&
      String(row.movimientoCajaId ?? '') === movimientoId
  );

  if (cuota00007) {
    await cuota00007.ref.update({
      estado: 'pendiente',
      fechaPago: null,
      movimientoCajaId: null,
      pagoResumenMes: null,
      pagoResumenTarjetaId: null,
    });
    console.log(`Cuota #00007 1/6 desvinculada del resumen (vuelve a pendiente).`);
  } else {
    console.log('Cuota #00007 1/6 ya no estaba vinculada al resumen.');
  }

  const linked = cuotas.filter((row) => String(row.movimientoCajaId ?? '') === movimientoId);
  const stillLinked = linked.filter((row) => row.id !== cuota00007?.id);
  const targetMonto = roundMoney(
    stillLinked.reduce((acc, row) => acc + (Number(row.monto) || 0), 0)
  );

  const movRef = db.doc(`negocios/${businessId}/movimientos_caja/${movimientoId}`);
  const movSnap = await movRef.get();
  if (!movSnap.exists) {
    throw new Error('Movimiento de caja no encontrado.');
  }

  const mov = movSnap.data() ?? {};
  await movRef.update({
    monto: targetMonto,
    concepto: `Resumen Lorelei Paique OCA Master · ${mes}`,
  });

  console.log(`Movimiento ${movimientoId}: $${mov.monto} → $${targetMonto}`);

  for (const row of stillLinked) {
    console.log(`  Cuota pagada: #${row.compraLabel} ${row.numeroCuota}/${row.cuotaTotal} · $${row.monto}`);
  }

  invalidatePayablesReconcileCache(businessId);
  console.log('Listo. Verificá caja con: npx tsx scripts/fix-resumen-caja-movimiento.ts', movimientoId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
