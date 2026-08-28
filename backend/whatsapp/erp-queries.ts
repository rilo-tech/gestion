import { db } from '../firebase.ts';
import {
  getOrderEstadoLabel,
  normalizeOrderPedidosConfig,
} from '../utils/order-config.ts';
import { formatOrderNumber, resolveOrderLabel } from '../utils/order-number.ts';
import {
  formatDateOnlyEs,
  extractOrderNumberFromText,
  extractQueryClientFromText,
} from './lookups.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import type { LastWhatsappOperation } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { formatFindOrderGuide, listOpenOrdersForWhatsapp } from './order-status.ts';

type StoreDoc = { id: string; data: () => Record<string, unknown> };

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

async function pedidosEstadoLabel(businessId: string, estado?: string): Promise<string> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const raw = snap.data()?.pedidos;
  const config = normalizeOrderPedidosConfig(
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  );
  return getOrderEstadoLabel(estado, config.estados);
}

function itemNames(items: unknown): string {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .slice(0, 6)
    .map((row) => {
      const data = row as { nombre?: string; cantidad?: number };
      const name = String(data.nombre ?? '').trim();
      const qty = Number(data.cantidad) || 0;
      if (!name) return '';
      return qty > 1 ? `${qty} × ${name}` : name;
    })
    .filter(Boolean)
    .join(', ');
}

async function formatOrderDoc(
  businessId: string,
  id: string,
  data: Record<string, unknown>
): Promise<string> {
  const label = resolveOrderLabel({
    numeroPedido: Number(data.numeroPedido) || undefined,
    numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
  });
  const estado = await pedidosEstadoLabel(businessId, String(data.estado ?? ''));
  const lines = [
    `*Pedido #${label || id.slice(0, 6)}*`,
    '',
    `• Cliente: ${String(data.clienteNombre ?? '').trim() || '(sin nombre)'}`,
    `• Estado: ${estado || String(data.estado ?? 'pendiente')}`,
  ];
  const products = itemNames(data.items);
  if (products) lines.push(`• Producto: ${products}`);
  const notes = String(data.descripcion ?? '').trim();
  if (notes && !/^origen:\s*whatsapp/i.test(notes)) {
    lines.push(`• Descripción: ${notes.slice(0, 160)}`);
  }
  const total = Number(data.total) || 0;
  const saldo = Number(data.saldo);
  lines.push(`• Total: $${money(total)}`);
  if (Number.isFinite(saldo)) lines.push(`• Saldo: $${money(saldo)}`);
  const entrega = formatDateOnlyEs(String(data.fechaEntrega ?? '').slice(0, 10));
  if (entrega) lines.push(`• Entrega: ${entrega}`);
  return lines.join('\n');
}

async function formatSaleDoc(id: string, data: Record<string, unknown>): Promise<string> {
  const label = String(data.ventaLabel ?? data.numeroVenta ?? id.slice(0, 6));
  const estado = String(data.estado ?? 'confirmada').replace(/_/g, ' ');
  const lines = [
    `*Venta #${label}*`,
    '',
    `• Estado: ${estado}`,
  ];
  const products = itemNames(data.items);
  if (products) lines.push(`• Producto: ${products}`);
  lines.push(`• Total: $${money(Number(data.total) || 0)}`);
  if (data.saldoPendiente != null) {
    lines.push(`• Saldo: $${money(Number(data.saldoPendiente) || 0)}`);
  }
  return lines.join('\n');
}

async function loadOrderById(
  businessId: string,
  id: string
): Promise<{ reply: string } | null> {
  const snap = await db.doc(`negocios/${businessId}/pedidos/${id}`).get();
  if (!snap.exists) return null;
  return { reply: await formatOrderDoc(businessId, snap.id, (snap.data() ?? {}) as Record<string, unknown>) };
}

async function loadSaleById(businessId: string, id: string): Promise<{ reply: string } | null> {
  const snap = await db.doc(`negocios/${businessId}/ventas/${id}`).get();
  if (!snap.exists) return null;
  return { reply: await formatSaleDoc(snap.id, (snap.data() ?? {}) as Record<string, unknown>) };
}

async function findOrdersByNumber(businessId: string, rawNumber: string): Promise<StoreDoc[]> {
  const numero = Number(rawNumber);
  if (!Number.isFinite(numero) || numero <= 0) return [];
  const label = formatOrderNumber(numero);
  const col = db.collection(`negocios/${businessId}/pedidos`);
  const byNumero = await col.where('numeroPedido', '==', numero).limit(5).get();
  if (!byNumero.empty) return byNumero.docs;
  const byLabel = await col.where('numeroPedidoLabel', '==', label).limit(5).get();
  return byLabel.docs;
}

async function findLatestWhatsappOrder(
  businessId: string,
  phone: string
): Promise<StoreDoc | null> {
  const snap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('whatsappPhone', '==', phone)
    .limit(15)
    .get();
  if (snap.empty) return null;
  const sorted = [...snap.docs].sort((a, b) =>
    String(b.data().createdAt ?? '').localeCompare(String(a.data().createdAt ?? ''))
  );
  return sorted[0] ?? null;
}

async function findSalesByClientId(businessId: string, clientId: string): Promise<StoreDoc[]> {
  const snap = await db
    .collection(`negocios/${businessId}/ventas`)
    .where('clienteId', '==', clientId)
    .limit(12)
    .get();
  return [...snap.docs].sort((a, b) => {
    const ta = String(a.data().createdAt ?? a.data().fecha ?? '');
    const tb = String(b.data().createdAt ?? b.data().fecha ?? '');
    return tb.localeCompare(ta);
  });
}

async function formatClientHistory(
  businessId: string,
  clientName: string,
  orders: StoreDoc[],
  sales: StoreDoc[]
): Promise<string> {
  if (orders.length === 1 && !sales.length) {
    const body = await formatOrderDoc(businessId, orders[0]!.id, orders[0]!.data() as Record<string, unknown>);
    const data = orders[0]!.data() as Record<string, unknown>;
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    return `${clientName} tiene el pedido #${label}.\n${body}`;
  }
  if (sales.length === 1 && !orders.length) {
    const body = await formatSaleDoc(sales[0]!.id, sales[0]!.data() as Record<string, unknown>);
    return `${clientName} tiene esta venta:\n${body}`;
  }

  const lines: string[] = [];
  for (const doc of orders.slice(0, 6)) {
    const data = doc.data() as Record<string, unknown>;
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    const estado = await pedidosEstadoLabel(businessId, String(data.estado ?? ''));
    const products = itemNames(data.items) || String(data.descripcion ?? '').trim().slice(0, 80);
    lines.push(
      `• Pedido #${label} · ${estado}${products ? ` · ${products}` : ''} · $${money(Number(data.total) || 0)}`
    );
  }
  for (const doc of sales.slice(0, 4)) {
    const data = doc.data() as Record<string, unknown>;
    const label = String(data.ventaLabel ?? data.numeroVenta ?? '').trim() || 'venta';
    const products = itemNames(data.items);
    lines.push(
      `• Venta #${label}${products ? ` · ${products}` : ''} · $${money(Number(data.total) || 0)}`
    );
  }
  if (!lines.length) return `${clientName} no tiene pedidos ni ventas registradas.`;
  return `${clientName} — ${orders.length ? `${orders.length} pedido(s)` : ''}${
    orders.length && sales.length ? ', ' : ''
  }${sales.length ? `${sales.length} venta(s)` : ''}:\n${lines.join('\n')}`;
}

async function findOrdersByClientId(businessId: string, clientId: string): Promise<StoreDoc[]> {
  const snap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('clienteId', '==', clientId)
    .limit(12)
    .get();
  return [...snap.docs].sort((a, b) => {
    const ta = String(a.data().createdAt ?? '');
    const tb = String(b.data().createdAt ?? '');
    return tb.localeCompare(ta);
  });
}

async function replyFromLastOperation(
  tenant: WhatsappTenantContext,
  last: LastWhatsappOperation
): Promise<{ reply: string } | null> {
  if (last.kind === 'order') {
    const loaded = await loadOrderById(tenant.businessId, last.id);
    if (!loaded) return null;
    const who = last.clientName ? ` de ${last.clientName}` : '';
    const num = last.label ? ` #${last.label}` : '';
    return { reply: `El último pedido${who}${num}:\n${loaded.reply}` };
  }
  if (last.kind === 'sale') return loadSaleById(tenant.businessId, last.id);
  if (last.kind === 'purchase') {
    const snap = await db.doc(`negocios/${tenant.businessId}/compras/${last.id}`).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const estado = String(data.estado ?? (data.borrador ? 'borrador' : 'registrada'));
    return {
      reply:
        `Compra ${last.label ? `#${last.label}` : ''}\n` +
        `• Proveedor: ${String(data.proveedorNombre ?? last.clientName ?? '').trim() || '(sin nombre)'}\n` +
        `• Estado: ${estado}\n` +
        `• Total: $${money(Number(data.total ?? last.amount) || 0)}`,
    };
  }
  if (last.kind === 'client') {
    return { reply: `El último alta fue el cliente ${last.clientName || 'sin nombre'}.` };
  }
  if (last.kind === 'payment') {
    return {
      reply: `El último cobro fue ${last.clientName ? `de ${last.clientName} ` : ''}por $${money(last.amount || 0)}.`,
    };
  }
  if (last.kind === 'cash') {
    return { reply: `El último movimiento de caja fue por $${money(last.amount || 0)}.` };
  }
  return null;
}

export async function queryStatusFromWhatsapp(
  tenant: WhatsappTenantContext,
  entities: WhatsappCommandEntities,
  lastOperation?: LastWhatsappOperation | null
): Promise<{ reply: string }> {
  const source = String(entities.sourceText ?? '');
  const orderNumber =
    String(entities.orderNumber ?? '').trim() || extractOrderNumberFromText(source);
  let clientName =
    String(entities.clientName ?? '').trim() || extractQueryClientFromText(source) || '';
  const asksItems = /\b(pidi[oó]|compr[oó]|n[uú]mero|nro\.?)/i.test(source);
  if (
    !clientName &&
    asksItems &&
    lastOperation?.clientName &&
    lastOperation.kind !== 'order' &&
    lastOperation.kind !== 'sale'
  ) {
    clientName = lastOperation.clientName;
  }

  if (orderNumber) {
    const docs = await findOrdersByNumber(tenant.businessId, orderNumber);
    if (!docs.length) {
      return { reply: `No encontré el pedido #${formatOrderNumber(Number(orderNumber)) || orderNumber}.` };
    }
    if (docs.length === 1) {
      return {
        reply: await formatOrderDoc(
          tenant.businessId,
          docs[0]!.id,
          docs[0]!.data() as Record<string, unknown>
        ),
      };
    }
    const lines = await Promise.all(
      docs.slice(0, 5).map(async (doc) => {
        const data = doc.data() as Record<string, unknown>;
        const label = resolveOrderLabel({
          numeroPedido: Number(data.numeroPedido) || undefined,
          numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
        });
        const estado = await pedidosEstadoLabel(tenant.businessId, String(data.estado ?? ''));
        return `• #${label} · ${data.clienteNombre || 'cliente'} · ${estado} · $${money(Number(data.total) || 0)}`;
      })
    );
    return { reply: `Encontré varios:\n${lines.join('\n')}` };
  }

  if (clientName) {
    const listed = await listOpenOrdersForWhatsapp(tenant.businessId, {
      clientHint: clientName,
      includeClosed: true,
      limit: 8,
    });
    if (listed.length === 1) {
      const hit = listed[0]!;
      const loaded = await loadOrderById(tenant.businessId, hit.id);
      if (loaded) return loaded;
    }
    if (listed.length > 1) {
      const lines = listed.map(
        (item, index) =>
          `${index + 1}) #${item.label} · ${item.clientName}${item.productSummary ? ` · ${item.productSummary}` : ''}`
      );
      return {
        reply: `Pedidos de ${clientName}:\n${lines.join('\n')}\n¿Cuál? Número de la lista.`,
      };
    }
    return {
      reply: formatFindOrderGuide({
        missed: true,
        triedHint: clientName,
        forQuery: true,
      }),
    };
  }

  if (lastOperation?.id) {
    const fromLast = await replyFromLastOperation(tenant, lastOperation);
    if (fromLast) return fromLast;
  }

  const recent = await findLatestWhatsappOrder(tenant.businessId, tenant.phone);
  if (recent) {
    return {
      reply: await formatOrderDoc(tenant.businessId, recent.id, recent.data() as Record<string, unknown>),
    };
  }

  return {
    reply:
      '¿De qué pedido hablás? Decime el número (ej. #00223), el cliente, o «el último».',
  };
}
