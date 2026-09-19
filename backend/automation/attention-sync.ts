/**
 * Detector común de situaciones que requieren atención.
 * Misma fuente → panel ERP + (opcional) WhatsApp via automations.
 */
import { db } from '../firebase.ts';
import { getOrderEstadoLabel, normalizeOrderPedidosConfig } from '../utils/order-config.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import {
  isCancelledStatus,
  isDeliveredEstado,
  resolveOrderEstado,
} from '../routes/orders.ts';
import { listPayableInstallments } from '../utils/payables.ts';
import {
  upsertAttentionNotice,
} from './erp-notices.ts';
import type { AttentionItem } from '../../shared/erp-notices.ts';
import { loadAutomationUserPrefs } from './automation-prefs.ts';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

function localDayKey(date = new Date(), timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function money(n: number): string {
  return Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00`).getTime();
  const to = new Date(`${toKey}T12:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export async function detectAttentionItems(
  businessId: string,
  options?: { timezone?: string; payablesDaysBefore?: number }
): Promise<AttentionItem[]> {
  const tz = options?.timezone ?? DEFAULT_TZ;
  const today = localDayKey(new Date(), tz);
  const tomorrow = addDays(today, 1);
  const prefs = await loadAutomationUserPrefs(businessId).catch(() => null);
  const daysBefore =
    options?.payablesDaysBefore ??
    prefs?.avisos?.payablesDaysBefore ??
    3;

  const items: AttentionItem[] = [];
  const [appSnap, ordersSnap, payables, stockSnap, promisesSnap] = await Promise.all([
    db.doc(`negocios/${businessId}/config/app`).get(),
    db.collection(`negocios/${businessId}/pedidos`).get(),
    listPayableInstallments(businessId, { scope: 'all' }),
    db.collection(`negocios/${businessId}/stock`).limit(400).get(),
    db.collection(`negocios/${businessId}/compromisos_pago`).limit(200).get(),
  ]);

  const pedidosCfg = normalizeOrderPedidosConfig(
    ((appSnap.data() ?? {}) as Record<string, unknown>).pedidos as Record<string, unknown>
  );

  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const estado = String(data.estado ?? '');
    if (isCancelledStatus(estado)) continue;
    const resolved = resolveOrderEstado(estado);
    if (isDeliveredEstado(resolved)) continue;

    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    const client = String(data.clienteNombre ?? 'Cliente');
    const estadoLabel = getOrderEstadoLabel(estado, pedidosCfg.estados);
    const entrega = String(data.fechaEntrega ?? '').slice(0, 10);
    const route = `/pedidos/${doc.id}`;

    if (entrega && entrega < today) {
      const atrasado = daysBetween(entrega, today);
      items.push({
        type: 'order_overdue',
        severity: 'urgent',
        title: `Pedido #${label} atrasado`,
        body: `${client} · entrega vencida hace ${atrasado} día${atrasado === 1 ? '' : 's'} · ${estadoLabel}`,
        dedupeKey: `order_overdue:${doc.id}`,
        entityType: 'pedido',
        entityId: doc.id,
        dueAt: entrega,
        route,
        actionKind: 'view_order',
        actionLabel: 'Ver pedido',
        actionId: 'overdue_orders_watch',
        presetId: 'overdue_orders',
      });
    } else if (entrega === today) {
      items.push({
        type: 'order_due_today',
        severity: 'attention',
        title: `Pedido #${label} se entrega hoy`,
        body: `${client} · ${estadoLabel}`,
        dedupeKey: `order_due_today:${doc.id}`,
        entityType: 'pedido',
        entityId: doc.id,
        dueAt: entrega,
        route,
        actionKind: resolved === 'listo' ? 'view_order' : 'mark_order_ready',
        actionLabel: resolved === 'listo' ? 'Ver pedido' : 'Marcar listo',
        actionId: 'orders_due_today',
        presetId: 'orders_due_today',
      });
    } else if (entrega === tomorrow && (resolved === 'en_produccion' || resolved === 'pendiente')) {
      items.push({
        type: 'order_in_progress_near',
        severity: 'attention',
        title: `Pedido #${label} para mañana`,
        body: `${client} · ${estadoLabel}`,
        dedupeKey: `order_near:${doc.id}`,
        entityType: 'pedido',
        entityId: doc.id,
        dueAt: entrega,
        route,
        actionKind: 'view_order',
        actionLabel: 'Ver pedido',
        actionId: 'orders_status_review',
        presetId: 'orders_status_review',
      });
    }

    if (resolved === 'listo' && (!entrega || entrega <= today)) {
      items.push({
        type: 'order_ready_pending',
        severity: 'attention',
        title: `Pedido #${label} listo sin entregar`,
        body: `${client} · sigue en Listo${entrega ? ` · entrega ${entrega}` : ''}`,
        dedupeKey: `order_ready:${doc.id}`,
        entityType: 'pedido',
        entityId: doc.id,
        dueAt: entrega || today,
        route,
        actionKind: 'view_order',
        actionLabel: 'Ver pedido',
        actionId: 'orders_status_review',
        presetId: 'orders_status_review',
      });
    }
  }

  const dueHorizon = addDays(today, Math.max(0, daysBefore));
  for (const row of payables.items) {
    if (row.estado === 'pagada') continue;
    const due = String(row.fechaVencimiento).slice(0, 10);
    const name = String(row.beneficiario ?? 'Obligación');
    const route = '/cuentas-pagar';
    if (due < today || row.displayEstado === 'vencida') {
      items.push({
        type: 'payable_overdue',
        severity: 'urgent',
        title: `${name} vencido`,
        body: `$${money(row.monto)} · venció ${due.slice(8, 10)}/${due.slice(5, 7)}`,
        dedupeKey: `payable_overdue:${row.id}`,
        entityType: 'cuota',
        entityId: row.id,
        dueAt: due,
        route,
        actionKind: 'pay_payable',
        actionLabel: 'Marcar pagado',
        actionId: 'payables_due_reminder',
        presetId: 'payables_due',
      });
    } else if (due >= today && due <= dueHorizon) {
      const days = daysBetween(today, due);
      const when =
        days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
      items.push({
        type: 'payable_due_soon',
        severity: 'attention',
        title: `${name} vence ${when}`,
        body: `$${money(row.monto)} · ${due.slice(8, 10)}/${due.slice(5, 7)}`,
        dedupeKey: `payable_due:${row.id}`,
        entityType: 'cuota',
        entityId: row.id,
        dueAt: due,
        route,
        actionKind: 'pay_payable',
        actionLabel: 'Marcar pagado',
        actionId: 'payables_due_reminder',
        presetId: 'payables_due',
      });
    }
  }

  for (const doc of promisesSnap.docs) {
    const data = doc.data();
    const cuotas = Array.isArray(data.cuotas) ? data.cuotas : [];
    for (const raw of cuotas) {
      if (!raw || typeof raw !== 'object') continue;
      const c = raw as Record<string, unknown>;
      if (String(c.estado ?? '') === 'pagada') continue;
      const due = String(c.fechaVencimiento ?? '').slice(0, 10);
      if (due !== today) continue;
      const clienteId = String(data.clienteId ?? '');
      const monto = Number(c.monto) || 0;
      items.push({
        type: 'payment_promise_today',
        severity: 'attention',
        title: 'Cobro previsto hoy',
        body: `${String(data.referenciaLabel ?? 'Cliente')} · $${money(monto)}`,
        dedupeKey: `promise:${doc.id}:${due}`,
        entityType: 'cliente',
        entityId: clienteId || doc.id,
        dueAt: due,
        route: clienteId ? `/clientes/${clienteId}` : '/clientes',
        actionKind: 'register_collection',
        actionLabel: 'Registrar cobro',
        actionId: 'customer_payment_promises_due',
        presetId: 'payment_promises_due',
      });
    }
  }

  for (const doc of stockSnap.docs) {
    const data = doc.data();
    const min = Number(data.stockMinimo ?? data.minStock ?? 0) || 0;
    if (min <= 0) continue;
    const qty = Number(data.cantidad ?? data.stock ?? data.stockActual ?? 0) || 0;
    if (qty > min) continue;
    const name = String(data.nombre ?? data.name ?? 'Producto');
    const out = qty <= 0;
    items.push({
      type: out ? 'stock_out' : 'stock_low',
      severity: out ? 'urgent' : 'attention',
      title: out ? `Sin stock: ${name}` : `Stock bajo: ${name}`,
      body: `Actual ${qty} · mínimo ${min}`,
      dedupeKey: `stock_low:${doc.id}`,
      entityType: 'producto',
      entityId: doc.id,
      route: `/stock`,
      actionKind: 'adjust_stock',
      actionLabel: 'Ajustar stock',
      actionId: 'low_stock_summary',
      presetId: 'low_stock',
    });
  }

  return items;
}

/**
 * Sincroniza dominio → erp_notices (upsert + auto-resolve).
 * Idempotente / dedupe por dedupeKey.
 */
export async function syncAttentionNotices(businessId: string): Promise<{
  upserted: number;
  resolved: number;
  items: AttentionItem[];
}> {
  const items = await detectAttentionItems(businessId);
  let upserted = 0;
  for (const item of items) {
    const notice = await upsertAttentionNotice(businessId, item);
    if (notice) upserted += 1;
  }

  // Auto-resolve situaciones attention_sync que ya no aplican
  const active = new Set(items.map((i) => i.dedupeKey));
  const { resolveStaleAttentionNotices } = await import('./erp-notices.ts');
  const resolved = await resolveStaleAttentionNotices(businessId, active);

  return { upserted, resolved, items };
}

/** Resumen corto para bloques “Necesita tu atención”. */
export function summarizeAttentionItems(items: AttentionItem[]): {
  count: number;
  lines: string[];
} {
  const ordersToday = items.filter((i) => i.type === 'order_due_today').length;
  const overdue = items.filter((i) => i.type === 'order_overdue').length;
  const payables = items.filter(
    (i) => i.type === 'payable_due_soon' || i.type === 'payable_overdue'
  ).length;
  const promises = items.filter((i) => i.type === 'payment_promise_today').length;
  const stock = items.filter((i) => i.type === 'stock_low' || i.type === 'stock_out').length;
  const ready = items.filter((i) => i.type === 'order_ready_pending').length;

  const lines: string[] = [];
  if (ordersToday) lines.push(`📦 ${ordersToday} pedido${ordersToday === 1 ? '' : 's'} para hoy`);
  if (overdue) lines.push(`⚠️ ${overdue} pedido${overdue === 1 ? '' : 's'} atrasado${overdue === 1 ? '' : 's'}`);
  if (ready) lines.push(`✅ ${ready} listo${ready === 1 ? '' : 's'} sin entregar`);
  if (promises) lines.push(`💰 ${promises} cobro${promises === 1 ? '' : 's'} previsto${promises === 1 ? '' : 's'}`);
  if (payables) lines.push(`🧾 ${payables} vencimiento${payables === 1 ? '' : 's'}`);
  if (stock) lines.push(`📉 ${stock} producto${stock === 1 ? '' : 's'} con stock bajo`);

  return { count: items.length, lines };
}
