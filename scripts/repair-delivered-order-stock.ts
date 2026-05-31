/**
 * Repara pedidos ya entregados que quedaron con stock reservado sin descontar del depósito.
 *
 * Uso: npx tsx scripts/repair-delivered-order-stock.ts [businessId] [numeroPedidoLabel]
 * Ejemplo: npx tsx scripts/repair-delivered-order-stock.ts rilo 00002
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { resolveOrderLabel } from '../backend/utils/order-number.ts';
import { normalizeOrderEstadoValue } from '../backend/utils/order-config.ts';
import {
  consumeOrderStockOnDelivery,
  orderHasPendingPhysicalStock,
} from '../backend/utils/order-stock-reservations.ts';

const businessId = process.argv[2] ?? 'rilo';
const targetLabel = process.argv[3] ? String(process.argv[3]).padStart(5, '0') : null;

function isDeliveredEstado(estado?: string): boolean {
  const normalized = normalizeOrderEstadoValue(estado);
  return normalized === 'entregado' || normalized === 'entregado_con_saldo';
}

const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
let repaired = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  const label = resolveOrderLabel(data);
  if (targetLabel && label !== targetLabel) continue;
  if (!isDeliveredEstado(data.estado)) continue;
  if (!orderHasPendingPhysicalStock(data.items ?? [])) continue;

  console.log(`Reparando pedido #${label} (${doc.id})…`);
  const result = await consumeOrderStockOnDelivery(businessId, doc.id, {
    items: data.items,
    stockDescontado: data.stockDescontado,
    stockPreparado: data.stockPreparado,
    numeroPedidoLabel: data.numeroPedidoLabel,
    numeroPedido: data.numeroPedido,
  });

  await doc.ref.update({
    items: result.items,
    stockDescontado: result.stockDescontado,
    estadoStock: result.estadoStock,
    stockPreparado: result.stockPreparado ?? data.stockPreparado,
    updatedAt: new Date().toISOString(),
  });

  console.log(`  OK · estadoStock=${result.estadoStock}`);
  repaired += 1;
}

console.log(repaired ? `Listo: ${repaired} pedido(s) reparado(s).` : 'No había pedidos entregados pendientes de reparar.');
