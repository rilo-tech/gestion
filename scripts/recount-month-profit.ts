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
} from '../backend/utils/sale-profit-recognition.ts';

const businessId = process.argv[2] ?? 'rilo';
const mes = Number(process.argv[3] ?? new Date().getMonth() + 1);
const anio = Number(process.argv[4] ?? new Date().getFullYear());

function isDeliveredEstado(estado?: string): boolean {
  const value = String(estado ?? '').toLowerCase();
  if (value.includes('entregado_con_saldo') || value.includes('entregado con saldo')) return true;
  return value === 'entregado' || (value.includes('entregad') && !value.includes('saldo'));
}

/** Lógica anterior: ganancia por fecha del último pago (sin exigir entrega). */
function legacyRecognizedAt(
  sale: Record<string, unknown>,
  order: Record<string, unknown> | null
): string | null {
  const total = Number(sale.total) || 0;
  if (total <= 0) return String(sale.fecha ?? '') || null;
  if (Number(sale.saldoPendiente) > 0) return null;
  return resolveSaleFullyPaidAt(sale, order);
}

function legacyInMonth(
  sale: Record<string, unknown>,
  order: Record<string, unknown> | null,
  m: number,
  y: number
): boolean {
  const at = legacyRecognizedAt(sale, order);
  if (!at) return false;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() + 1 === m;
}

const [ordersSnap, salesSnap] = await Promise.all([
  db.collection(`negocios/${businessId}/pedidos`).get(),
  db.collection(`negocios/${businessId}/ventas`).get(),
]);

const ordersById = new Map<string, Record<string, unknown>>();
for (const doc of ordersSnap.docs) ordersById.set(doc.id, doc.data());

let oldTotal = 0;
let newTotal = 0;
const gained: Array<Record<string, string | number>> = [];
const lost: Array<Record<string, string | number>> = [];

for (const doc of salesSnap.docs) {
  const sale = doc.data();
  if (String(sale.estado ?? '') === 'borrador') continue;

  const pedidoId = String(sale.pedidoId ?? '').trim();
  const order = pedidoId ? ordersById.get(pedidoId) ?? null : null;
  const gan = resolveSaleGananciaEstimada(sale);

  const oldHit = legacyInMonth(sale, order, mes, anio);
  const newHit = isSaleProfitRecognizedInMonth(sale, mes, anio, order);

  if (oldHit) oldTotal += gan;
  if (newHit) newTotal += gan;

  if (!oldHit && newHit) {
    gained.push({
      venta: resolveSaleLabel(sale),
      pedido: order ? resolveOrderLabel(order) : '-',
      ganancia: gan,
      pagado: resolveSaleFullyPaidAt(sale, order) ?? '',
      reconocido: resolveSaleProfitRecognizedAt(sale, order) ?? '',
    });
  }
  if (oldHit && !newHit) {
    lost.push({
      venta: resolveSaleLabel(sale),
      pedido: order ? resolveOrderLabel(order) : '-',
      ganancia: gan,
      pagado: resolveSaleFullyPaidAt(sale, order) ?? '',
      reconocido: resolveSaleProfitRecognizedAt(sale, order) ?? '',
    });
  }
}

console.log(`=== Recuento ganancia ${mes}/${anio} (${businessId}) ===`);
console.log('Antes (último pago):', Math.round(oldTotal));
console.log('Después (entregado + saldado):', Math.round(newTotal));
console.log('Diferencia:', Math.round(newTotal - oldTotal));
console.log('\nSuman este mes (antes no):', gained.length);
for (const row of gained) console.log(row);
console.log('\nDejan de sumar este mes:', lost.length);
for (const row of lost) console.log(row);

// Pedidos entregados este mes con pagos previos (caso típico del bug)
const shiftedCandidates = ordersSnap.docs
  .map((doc) => ({ id: doc.id, ...doc.data() }))
  .filter((order) => isDeliveredEstado(String(order.estado ?? '')))
  .filter((order) => {
    const entregadoAt = String(order.entregadoAt ?? '');
    if (!entregadoAt) return false;
    const d = new Date(entregadoAt);
    return d.getUTCFullYear() === anio && d.getUTCMonth() + 1 === mes;
  })
  .filter((order) => order.ventaId);

console.log(`\nPedidos entregados en ${mes}/${anio} con venta:`, shiftedCandidates.length);
