import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';
import { resolveSaleLabel } from '../backend/utils/sale-number.ts';
import {
  isSaleProfitRecognizedInMonth,
  resolveSaleFullyPaidAt,
  resolveSaleGananciaEstimada,
  resolveSaleProfitRecognizedAt,
  resolveSaleSaldoPendiente,
} from '../backend/utils/sale-profit-recognition.ts';

const businessId = process.argv[2] ?? 'rilo';
const targetLabel = (process.argv[3] ?? '00043').padStart(5, '0');
const mes = Number(process.argv[4] ?? new Date().getMonth() + 1);
const anio = Number(process.argv[5] ?? new Date().getFullYear());

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

console.log('=== PEDIDO', targetLabel, orderId, '===');
console.log('estado:', orderData.estado);
console.log('total:', orderData.total);
console.log('costoReal:', orderData.costoReal);
console.log('gananciaEstimada:', orderData.gananciaEstimada);
console.log('saldo:', orderData.saldo);
console.log('totalPagado:', orderData.totalPagado);
console.log('ventaId:', orderData.ventaId);
console.log('ventaLabel:', orderData.ventaLabel);
console.log('entregadoAt:', orderData.entregadoAt);
console.log('stockDescontado:', orderData.stockDescontado);
console.log('pagos:', JSON.stringify(orderData.pagos ?? [], null, 2));

const ventaId = String(orderData.ventaId ?? '').trim();
if (ventaId) {
  const ventaSnap = await db.doc(`negocios/${businessId}/ventas/${ventaId}`).get();
  const v = (ventaSnap.data() ?? {}) as Record<string, unknown>;
  console.log('\n=== VENTA', resolveSaleLabel(v), ventaId, '===');
  console.log('fecha:', v.fecha);
  console.log('origen:', v.origen);
  console.log('total:', v.total);
  console.log('costoReal:', v.costoReal);
  console.log('gananciaEstimada:', v.gananciaEstimada);
  console.log('montoCobrado:', v.montoCobrado);
  console.log('totalPagadoAnterior:', v.totalPagadoAnterior);
  console.log('saldoPendiente:', v.saldoPendiente);
  console.log('esDonacion:', v.esDonacion);
  const fullyPaidAt = resolveSaleFullyPaidAt(v, orderData);
  const recognizedAt = resolveSaleProfitRecognizedAt(v, orderData);
  const saldo = resolveSaleSaldoPendiente(v);
  const gan = resolveSaleGananciaEstimada(v);
  const recognized = isSaleProfitRecognizedInMonth(v, mes, anio, orderData);
  console.log('resolveSaleSaldoPendiente:', saldo);
  console.log('resolveSaleFullyPaidAt:', fullyPaidAt);
  console.log('resolveSaleProfitRecognizedAt:', recognizedAt);
  console.log('resolveSaleGananciaEstimada:', gan);
  console.log(`isSaleProfitRecognizedInMonth ${mes}/${anio}:`, recognized);
} else {
  console.log('\n=== NO HAY VENTA VINCULADA ===');
}

const allSales = await db.collection(`negocios/${businessId}/ventas`).get();
const ordersById = new Map<string, Record<string, unknown>>();
for (const doc of orderSnap.docs) ordersById.set(doc.id, doc.data());

let totalGan = 0;
for (const doc of allSales.docs) {
  const data = doc.data();
  if (String(data.estado ?? '') === 'borrador') continue;
  const pedidoId = String(data.pedidoId ?? '').trim();
  const order = pedidoId ? ordersById.get(pedidoId) ?? null : null;
  if (isSaleProfitRecognizedInMonth(data, mes, anio, order)) {
    totalGan += resolveSaleGananciaEstimada(data);
  }
}

console.log(`\n=== KPI Gan. cobrada ${mes}/${anio} (simulado):`, Math.round(totalGan), '===');
