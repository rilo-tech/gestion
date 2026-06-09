import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { reconcilePayablesAndCashData } from '../backend/utils/payables.ts';

const businessId = process.argv[2] ?? 'rilo';

const cuotasSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_cuotas`).get();
const obSnap = await db.collection(`negocios/${businessId}/cuentas_pagar_obligaciones`).get();

console.log(`Business: ${businessId}`);
console.log(`Obligations: ${obSnap.size}, Cuotas: ${cuotasSnap.size}\n`);

for (const doc of obSnap.docs) {
  const d = doc.data();
  console.log(
    `[obl] ${doc.id.slice(0, 10)} | ${String(d.beneficiario).slice(0, 35)} | monto=${d.monto} | ${d.origenTipo} | cuotas=${d.cantidadCuotas}`
  );
}

console.log('');
const rows = cuotasSnap.docs
  .map((doc) => {
    const d = doc.data();
    return {
      estado: String(d.estado ?? ''),
      monto: Number(d.monto) || 0,
      ben: String(d.beneficiario ?? '').slice(0, 35),
      n: Number(d.numeroCuota) || 0,
      total: Number(d.cuotaTotal) || 0,
      origen: String(d.origenTipo ?? ''),
      fecha: String(d.fechaVencimiento ?? '').slice(0, 10),
      desc: String(d.descripcion ?? '').slice(0, 55),
      id: doc.id,
      obligacionId: String(d.obligacionId ?? ''),
      movimientoCajaId: String(d.movimientoCajaId ?? ''),
    };
  })
  .sort((a, b) => a.estado.localeCompare(b.estado) || a.fecha.localeCompare(b.fecha));

for (const r of rows) {
  console.log(
    `[${r.estado.padEnd(9)}] $${r.monto} | ${r.n}/${r.total} | ${r.origen} | ${r.fecha} | ${r.ben} | ${r.desc}`
  );
}

const pending = rows.filter((r) => r.estado === 'pendiente');
console.log(`\nPending count: ${pending.length}`);
console.log(`Pending total: $${pending.reduce((s, r) => s + r.monto, 0)}`);

if (process.argv.includes('--reconcile')) {
  console.log('\nRunning forced reconcile...');
  await reconcilePayablesAndCashData(businessId, { force: true });
  console.log('Done.');
}
