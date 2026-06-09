/**
 * Cierra cuotas que quedaron pendientes tras un pago de resumen de tarjeta
 * (p. ej. compra positiva + nota de crédito negativa en el mismo mes).
 *
 * Uso:
 *   npx tsx scripts/close-resumen-cuotas.ts 00001 00007
 *   npx tsx scripts/close-resumen-cuotas.ts --mes 2026-06 --tarjeta lorelei_paique_oca_master 00001 00007
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { invalidatePayablesReconcileCache } from '../backend/utils/payables.ts';

const argv = process.argv.slice(2);
const businessId = 'rilo';

function parseArgs(raw: string[]): { mes: string; tarjetaId: string; labels: string[] } {
  let mes = '2026-06';
  let tarjetaId = 'lorelei_paique_oca_master';
  const labels: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--mes') {
      mes = String(raw[++i] ?? mes).trim();
      continue;
    }
    if (arg === '--tarjeta') {
      tarjetaId = String(raw[++i] ?? tarjetaId).trim();
      continue;
    }
    if (arg.startsWith('--')) continue;
    labels.push(arg.trim().padStart(5, '0'));
  }

  return { mes, tarjetaId, labels };
}

const { mes, tarjetaId, labels } = parseArgs(argv);

async function main(): Promise<void> {
  if (labels.length === 0) {
    console.error('Indicá al menos una compra (ej. 00001 00007).');
    process.exit(1);
  }

  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  const all = cuotasSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

  const reference = all.find(
    (row) =>
      row.estado === 'pagada' &&
      row.pagoResumenMes === mes &&
      row.pagoResumenTarjetaId === tarjetaId &&
      String(row.movimientoCajaId ?? '').trim()
  );

  if (!reference) {
    console.error(`No hay cuota pagada de referencia para resumen ${mes} / ${tarjetaId}.`);
    process.exit(1);
  }

  const movimientoCajaId = String(reference.movimientoCajaId).trim();
  const movSnap = await db.doc(`negocios/${businessId}/movimientos_caja/${movimientoCajaId}`).get();
  const mov = movSnap.data() ?? {};
  const fechaPago = String(reference.fechaPago ?? mov.fecha ?? new Date().toISOString());
  const now = new Date().toISOString();

  console.log(
    `Referencia: compra #${reference.compraLabel} · movimiento ${movimientoCajaId} · resumen ${mes}\n`
  );

  const batch = db.batch();
  let closed = 0;

  for (const label of labels) {
    const pending = all.filter((row) => {
      if (row.estado === 'pagada') return false;
      if (row.compraLabel !== label) return false;
      if (String(row.fechaVencimiento ?? '').slice(0, 7) !== mes) return false;
      const rowTarjeta = String(row.tarjetaId ?? '').trim();
      return !rowTarjeta || rowTarjeta === tarjetaId;
    });

    if (pending.length === 0) {
      console.log(`  [skip] #${label}: no hay cuota pendiente en ${mes}`);
      continue;
    }

    for (const row of pending) {
      batch.update(row.ref, {
        estado: 'pagada',
        fechaPago,
        movimientoCajaId,
        pagoResumenMes: mes,
        pagoResumenTarjetaId: tarjetaId,
        updatedAt: now,
      });
      closed += 1;
      console.log(
        `  [cerrada] #${label} cuota ${row.numeroCuota}/${row.cuotaTotal} · $${row.monto}`
      );
    }
  }

  if (closed === 0) {
    console.log('Nada que cerrar.');
    return;
  }

  await batch.commit();
  invalidatePayablesReconcileCache(businessId);
  console.log(`\n${closed} cuota(s) cerrada(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
