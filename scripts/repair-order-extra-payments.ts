/**
 * Consolida pagos «extra» en la última cuota y recalcula saldo del pedido.
 *
 * Uso:
 *   npx tsx scripts/repair-order-extra-payments.ts --business=rilo --order=00080
 *   npx tsx scripts/repair-order-extra-payments.ts --business=rilo --order=00080 --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';
import { reconcileOrderPayments } from '../backend/utils/order-payment-reconcile.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] ?? 'rilo';
const ORDER_LABEL = (
  process.argv.find((arg) => arg.startsWith('--order='))?.split('=')[1] ?? '00080'
).padStart(5, '0');

async function findOrder(businessId: string, label: string) {
  const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
  for (const doc of snap.docs) {
    if (resolveOrderLabel(doc.data()) === label) return doc;
  }
  return null;
}

const businessId = BUSINESS_ID.trim();
const orderDoc = await findOrder(businessId, ORDER_LABEL);
if (!orderDoc) {
  console.error(`Pedido #${ORDER_LABEL} no encontrado en negocio ${businessId}.`);
  process.exit(1);
}

const data = orderDoc.data();
const reconciled = reconcileOrderPayments({
  total: data.total,
  senia: data.senia,
  totalPagado: data.totalPagado,
  pagos: Array.isArray(data.pagos) ? data.pagos : [],
  seniaBloqueada: data.seniaBloqueada,
  movimientoSeniaId: data.movimientoSeniaId,
  items: data.items,
  saldo: data.saldo,
});

console.log(`Pedido #${ORDER_LABEL} (${orderDoc.id})`);
console.log('Pagos antes:', JSON.stringify(data.pagos ?? [], null, 2));
console.log('Pagos después:', JSON.stringify(reconciled.pagos, null, 2));
console.log(`Total: ${reconciled.total} · Pagado: ${reconciled.totalPagado} · Saldo: ${reconciled.saldo}`);

if (!reconciled.changed) {
  console.log('Sin cambios necesarios.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nEjecutá con --apply para guardar.');
  process.exit(0);
}

await orderDoc.ref.update({
  pagos: reconciled.pagos,
  total: reconciled.total,
  totalPagado: reconciled.totalPagado,
  saldo: reconciled.saldo,
  updatedAt: new Date().toISOString(),
});

console.log('Pedido actualizado.');
