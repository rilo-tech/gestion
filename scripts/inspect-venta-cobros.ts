import dotenv from 'dotenv';
dotenv.config();
import { db } from '../backend/firebase.ts';
import { resolveSaleLabel } from '../backend/utils/sale-number.ts';

const businessId = process.argv[2] ?? 'rilo';
const ventaId = process.argv[3] ?? '1FnwTkziPpjlvaNzCHZ4';

const ventaSnap = await db.doc(`negocios/${businessId}/ventas/${ventaId}`).get();
console.log('venta exists', ventaSnap.exists);
if (ventaSnap.exists) {
  const d = ventaSnap.data() ?? {};
  console.log('label', resolveSaleLabel(d));
  console.log('montoCobrado', d.montoCobrado);
  console.log('saldoPendiente', d.saldoPendiente);
  console.log('total', d.total);
  console.log('cobros', JSON.stringify(d.cobros ?? [], null, 2));
}

const movSnap = await db
  .collection(`negocios/${businessId}/movimientos_caja`)
  .where('ventaId', '==', ventaId)
  .get();
console.log('movements', movSnap.size);
for (const doc of movSnap.docs) {
  const m = doc.data();
  console.log(doc.id, m.fecha, m.monto, m.concepto, m.origenTipo);
}
