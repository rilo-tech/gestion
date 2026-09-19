import { db } from '../firebase.ts';
import { ventaSaldoClienteImpact } from '../../shared/comprobantes-config.ts';
import { resolveOrderLabel } from './order-number.ts';
import { resolveSaleLabel } from './sale-number.ts';

export type ClientPendingReceivableLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type ClientPendingReceivable = {
  kind: 'pedido' | 'venta';
  id: string;
  label: string;
  detail: string;
  date: string;
  balance: number;
  items: ClientPendingReceivableLine[];
};

function isCancelledStatus(estado?: string) {
  const value = String(estado ?? '').toLowerCase().trim();
  return value === 'cancelado' || value.includes('cancelad');
}

function coerceOrderItems(raw: unknown): ClientPendingReceivableLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const row = line as Record<string, unknown>;
      const quantity = Number(row.cantidad) || 0;
      const unitPrice = Number(row.precioVenta) || 0;
      const subtotal = Math.round(quantity * unitPrice * 100) / 100;
      const name = String(row.nombre ?? '').trim() || 'Ítem';
      if (subtotal <= 0 && quantity <= 0) return null;
      return { name, quantity, unitPrice, subtotal };
    })
    .filter((line): line is ClientPendingReceivableLine => line !== null);
}

function coerceSaleItems(raw: unknown): ClientPendingReceivableLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const row = line as Record<string, unknown>;
      const quantity = Number(row.cantidad) || 0;
      const unitPrice = Number(row.precioUnitario) || 0;
      const subtotal =
        Number(row.subtotal) || Math.round(quantity * unitPrice * 100) / 100;
      const name = String(row.nombre ?? row.descripcion ?? '').trim() || 'Ítem';
      if (subtotal <= 0 && quantity <= 0) return null;
      return { name, quantity, unitPrice, subtotal };
    })
    .filter((line): line is ClientPendingReceivableLine => line !== null);
}

/** Comprobantes con saldo pendiente (pedidos + ventas mostrador) e ítems. */
export async function listClientPendingReceivables(
  businessId: string,
  clientId: string
): Promise<ClientPendingReceivable[]> {
  const id = String(clientId ?? '').trim();
  if (!id) return [];

  const [ordersSnap, salesSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/pedidos`).where('clienteId', '==', id).get(),
    db.collection(`negocios/${businessId}/ventas`).where('clienteId', '==', id).get(),
  ]);

  const pending: ClientPendingReceivable[] = [];

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    if (isCancelledStatus(String(data.estado ?? ''))) continue;
    const balance = Math.max(0, Number(data.saldo) || 0);
    if (balance <= 0) continue;
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    pending.push({
      kind: 'pedido',
      id: doc.id,
      label: `Pedido #${label}`,
      detail: String(data.descripcion ?? data.estado ?? 'Pedido').trim() || 'Pedido',
      date: String(data.fechaEntrega ?? data.fecha ?? data.createdAt ?? '').trim(),
      balance,
      items: coerceOrderItems(data.items),
    });
  }

  for (const doc of salesSnap.docs) {
    const data = doc.data();
    if (data.origen === 'pedido') continue;
    const balance = ventaSaldoClienteImpact(data);
    if (balance <= 0) continue;
    const label = resolveSaleLabel({
      numeroVenta: Number(data.numeroVenta) || undefined,
      ventaLabel: String(data.ventaLabel ?? ''),
      estado: String(data.estado ?? ''),
    });
    pending.push({
      kind: 'venta',
      id: doc.id,
      label: `Venta #${label}`,
      detail: 'Venta mostrador',
      date: String(data.fecha ?? data.createdAt ?? '').trim(),
      balance,
      items: coerceSaleItems(data.items),
    });
  }

  pending.sort((a, b) => a.date.localeCompare(b.date));
  return pending;
}
