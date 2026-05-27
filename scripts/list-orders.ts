import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const businessId = process.argv[2] ?? 'rilo';

const orders = await db.collection(`negocios/${businessId}/pedidos`).get();
console.log('ORDERS', orders.size);
for (const doc of orders.docs.sort(
  (a, b) => (Number(a.data().numeroPedido) || 0) - (Number(b.data().numeroPedido) || 0)
)) {
  const data = doc.data();
  console.log(
    doc.id,
    resolveOrderLabel(data),
    data.estado,
    String(data.descripcion ?? '').slice(0, 50)
  );
}

const counter = await db.doc(`negocios/${businessId}/config/contadores`).get();
console.log('counter', counter.data());

const sales = await db.collection(`negocios/${businessId}/ventas`).get();
console.log('SALES', sales.size);
for (const doc of sales.docs) {
  const data = doc.data();
  console.log(' sale', doc.id, 'pedidoId', data.pedidoId);
}
