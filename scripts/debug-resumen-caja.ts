import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const businessId = 'rilo';
const mes = '2026-06';
const tarjetaId = 'lorelei_paique_oca_master';

async function main(): Promise<void> {
  const movSnap = await db
    .collection(`negocios/${businessId}/movimientos_caja`)
    .where('origenTipo', '==', 'tarjeta_resumen')
    .get();

  console.log('Movimientos tarjeta_resumen:');
  for (const doc of movSnap.docs) {
    const d = doc.data();
    if (!String(d.concepto ?? '').includes('Lorelei Paique')) continue;
    console.log(
      `  ${doc.id} · ${String(d.fecha).slice(0, 10)} · $${d.monto} · ${d.concepto} · ${d.medio}`
    );
  }

  const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
  const cuotas = cuotasSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(
      (row) =>
        row.pagoResumenMes === mes &&
        row.pagoResumenTarjetaId === tarjetaId
    )
    .sort((a, b) => String(a.compraLabel).localeCompare(String(b.compraLabel)));

  console.log(`\nCuotas con pago resumen ${mes}:`);
  let sumMonto = 0;
  for (const row of cuotas) {
    sumMonto += Number(row.monto) || 0;
    console.log(
      `  #${row.compraLabel} ${row.numeroCuota}/${row.cuotaTotal} · $${row.monto} · ${row.estado} · mov ${row.movimientoCajaId ?? '-'}`
    );
  }
  console.log(`\nSuma montos cuotas vinculadas: $${Math.round(sumMonto * 100) / 100}`);
}

main().catch(console.error);
