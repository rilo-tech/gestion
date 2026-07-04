import dotenv from 'dotenv';
dotenv.config();

import { db } from '../backend/firebase.ts';
import { loadFinanzasConfig } from '../backend/utils/finance-config.ts';
import { listPayableInstallments } from '../backend/utils/payables.ts';
import { listCardStatementSummaries } from '../backend/utils/card-statements.ts';

const businessId = 'rilo';
const compraId = 'U4Ux2DJUnnxAScWe97zO';

const compraSnap = await db.doc(`negocios/${businessId}/compras/${compraId}`).get();
const compra = compraSnap.data() ?? {};
console.log('COMPRA pago:', JSON.stringify(compra.pago, null, 2));
console.log('COMPRA items ambito:', (compra.items as Array<{ ambito?: string; importe?: number }>)?.map((l) => ({
  ambito: l.ambito,
  importe: l.importe,
})));

const finanzas = await loadFinanzasConfig(businessId);
console.log(
  'TARJETAS config:',
  finanzas.tarjetas.map((t) => ({ id: t.id, label: t.label, medioPagoId: t.medioPagoId, activa: t.activa }))
);

const cuotasSnap = await db
  .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
  .where('compraId', '==', compraId)
  .limit(5)
  .get();
console.log('CUOTAS count (sample query):', cuotasSnap.size);
for (const doc of cuotasSnap.docs) {
  const d = doc.data();
  console.log('  cuota:', {
    id: doc.id,
    tarjetaId: d.tarjetaId,
    tarjetaLabel: d.tarjetaLabel,
    ambito: d.ambito,
    monto: d.monto,
    estado: d.estado,
    fechaVencimiento: d.fechaVencimiento,
    numeroCuota: d.numeroCuota,
  });
}

const allCuotas = await db
  .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
  .where('compraId', '==', compraId)
  .get();
console.log('CUOTAS total:', allCuotas.size);

const santander = finanzas.tarjetas.find((t) => t.label?.toLowerCase().includes('santander'));
if (santander) {
  const byTarjeta = await db
    .collection(`negocios/${businessId}/cuentas_pagar_cuotas`)
    .where('tarjetaId', '==', santander.id)
    .where('estado', '==', 'pendiente')
    .limit(3)
    .get();
  console.log(`Pendientes tarjetaId=${santander.id} (${santander.label}):`, byTarjeta.size, 'sample');
}

const all = await listPayableInstallments(businessId, { scope: 'all', reconcile: true });
const fromCompra = all.items.filter((i) => i.compraId === compraId);
console.log('listPayableInstallments scope=all for compra:', fromCompra.length);
if (fromCompra[0]) console.log('  sample:', fromCompra[0]);

const casa = all.items.filter((i) => i.compraId === compraId && i.ambito === 'casa');
console.log('  ambito casa:', casa.length);

const summaries = await listCardStatementSummaries(businessId, '2026-06');
console.log('Card summaries 2026-06:', summaries.map((s) => ({
  tarjetaLabel: s.tarjetaLabel,
  tarjetaId: s.tarjetaId,
  ambito: s.ambito,
  cuotasCount: s.cuotasCount,
  total: s.total,
})));
