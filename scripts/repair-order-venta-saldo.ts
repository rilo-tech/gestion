import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';
import { syncOrderLinkedVentaSaldo } from '../backend/utils/sync-order-linked-venta.ts';

const businessId = process.argv[2] ?? 'rilo';
const targetLabel = (process.argv[3] ?? '').padStart(5, '0');

const orderSnap = await db.collection(`negocios/${businessId}/pedidos`).get();
let orderId = '';
let orderData: Record<string, unknown> | null = null;
for (const doc of orderSnap.docs) {
  if (resolveOrderLabel(doc.data()) === targetLabel) {
    orderId = doc.id;
    orderData = doc.data();
    break;
  }
}

if (!orderId || !orderData) {
  console.log('Pedido no encontrado:', targetLabel);
  process.exit(1);
}

const saldo = Math.max(0, Number(orderData.saldo) || 0);
const total = Number(orderData.total) || 0;
await syncOrderLinkedVentaSaldo(businessId, orderData, saldo, total);
console.log(`Sincronizado pedido #${targetLabel} · saldo venta = ${saldo}`);
