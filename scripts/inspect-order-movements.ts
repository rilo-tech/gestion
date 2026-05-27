import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';

const businessId = process.argv[2] ?? 'rilo';
const targetLabel = (process.argv[3] ?? '00002').padStart(5, '0');

const orderSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
let orderId = '';
for (const doc of orderSnap.docs) {
  if (resolveOrderLabel(doc.data()) === targetLabel) {
    orderId = doc.id;
    break;
  }
}

const movSnap = await db.collection(`negocios/${businessId}/movimientos_stock`).get();
const rows = movSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((row) => row.pedidoId === orderId || row.origenId === orderId)
  .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

console.log('movements for', targetLabel, orderId, rows.length);
for (const row of rows) {
  console.log(row.id, row.fecha, row.tipo, row.cantidad, row.motivo, row.origenTipo);
}
