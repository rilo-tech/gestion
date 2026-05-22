import { db } from '../firebase.ts';

function isCancelledStatus(estado?: string) {
  const value = String(estado ?? '').toLowerCase().trim();
  return value === 'cancelado' || value.includes('cancelad');
}

export async function computeClientBalanceMap(
  businessId: string
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();

  const [ordersSnap, salesSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/pedidos`).get(),
    db.collection(`negocios/${businessId}/ventas`).get(),
  ]);

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    if (isCancelledStatus(data.estado)) continue;

    const clienteId = String(data.clienteId ?? '').trim();
    if (!clienteId) continue;

    const saldo = Math.max(0, Number(data.saldo) || 0);
    if (saldo <= 0) continue;

    balances.set(clienteId, (balances.get(clienteId) ?? 0) + saldo);
  }

  for (const doc of salesSnap.docs) {
    const data = doc.data();
    if (data.origen === 'pedido') continue;

    const clienteId = String(data.clienteId ?? '').trim();
    if (!clienteId) continue;

    const saldo = Math.max(0, Number(data.saldoPendiente) || 0);
    if (saldo <= 0) continue;

    balances.set(clienteId, (balances.get(clienteId) ?? 0) + saldo);
  }

  return balances;
}
