import { db } from '../firebase.ts';
import { getCashBalance, getCashDayTotals } from '../domain/cash/index.ts';
import { getProduct, getProductStock } from '../domain/stock/index.ts';
import {
  getCollaboratorBalance,
  getCollaboratorHoursSummary,
  listCollaboratorEntities,
} from '../domain/collaborator/index.ts';
import { computeClientBalanceMap } from '../utils/client-balance.ts';
import { listPayableInstallments } from '../utils/payables.ts';
import { buildBusinessReport } from '../utils/reports.ts';
import { findOrdersPage } from '../whatsapp/erp-queries.ts';
import { isCancelledStatus, isDeliveredEstado, resolveOrderEstado, loadOrderPedidosConfig } from '../routes/orders.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import type {
  AutomationActionId,
  AutomationComparator,
  AutomationExecuteContext,
  AutomationExecuteResult,
} from '../../shared/automation-types.ts';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function localDayKey(date: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenDayKeys(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00`).getTime();
  const to = new Date(`${toKey}T12:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

function compareValues(current: number, threshold: number, comparator: AutomationComparator): boolean {
  switch (comparator) {
    case 'lt':
      return current < threshold;
    case 'lte':
      return current <= threshold;
    case 'gt':
      return current > threshold;
    case 'gte':
      return current >= threshold;
    case 'eq':
      return current === threshold;
    default:
      return false;
  }
}

function conditionWatchResult(
  title: string,
  lines: string[],
  conditionValue: number,
  threshold: number,
  comparator: AutomationComparator
): AutomationExecuteResult {
  const conditionMet = compareValues(conditionValue, threshold, comparator);
  return {
    title,
    lines,
    conditionValue,
    conditionMet,
    shouldDeliver: conditionMet,
  };
}

function isOpenOrderData(data: Record<string, unknown>): boolean {
  const estado = String(data.estado ?? '');
  if (isCancelledStatus(estado)) return false;
  if (isDeliveredEstado(resolveOrderEstado(estado))) return false;
  return true;
}

function orderDeliveryDay(data: Record<string, unknown>): string {
  return String(data.fechaEntrega ?? '').slice(0, 10);
}

async function loadOpenOrders(businessId: string): Promise<
  Array<{ id: string; data: Record<string, unknown> }>
> {
  const snap = await db.collection(`negocios/${businessId}/pedidos`).get();
  return snap.docs
    .filter((doc) => isOpenOrderData(doc.data() as Record<string, unknown>))
    .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
}

async function formatOrderLine(businessId: string, id: string, data: Record<string, unknown>): Promise<string> {
  const config = await loadOrderPedidosConfig(businessId);
  const label = resolveOrderLabel({
    numeroPedido: Number(data.numeroPedido) || undefined,
    numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
  });
  const client = String(data.clienteNombre ?? 'Sin cliente');
  const estado = config.estados.find((e) => e.value === String(data.estado ?? ''))?.label ?? String(data.estado ?? '');
  return `• #${label} · ${client} · ${estado}`;
}

type PendingPromiseDue = {
  clienteId: string;
  clienteNombre: string;
  monto: number;
  fechaVencimiento: string;
};

async function loadPaymentPromisesDueOn(
  businessId: string,
  day: string
): Promise<PendingPromiseDue[]> {
  const snapshot = await db.collection(`negocios/${businessId}/compromisos_pago`).get();
  if (snapshot.empty) return [];

  const clientIds = new Set<string>();
  const pending: Array<{ clienteId: string; monto: number; fechaVencimiento: string }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const clienteId = String(data.clienteId ?? '').trim();
    const cuotas = Array.isArray(data.cuotas) ? data.cuotas : [];
    for (const raw of cuotas) {
      if (!raw || typeof raw !== 'object') continue;
      const cuota = raw as Record<string, unknown>;
      if (String(cuota.estado ?? '') !== 'pendiente') continue;
      const fecha = String(cuota.fechaVencimiento ?? '').slice(0, 10);
      if (fecha !== day) continue;
      const monto = Number(cuota.monto) || 0;
      if (monto <= 0) continue;
      if (clienteId) clientIds.add(clienteId);
      pending.push({ clienteId, monto, fechaVencimiento: fecha });
    }
  }

  if (!pending.length) return [];

  const names = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (clientId) => {
      const snap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
      if (!snap.exists) return;
      names.set(clientId, String(snap.data()?.nombre ?? '').trim() || 'Cliente');
    })
  );

  return pending.map((row) => ({
    ...row,
    clienteNombre: names.get(row.clienteId) || (row.clienteId ? 'Cliente' : 'Cliente'),
  }));
}

export async function executeDailyBusinessSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const params = ctx.automation.parameters;
  const includeRevenue = params.includeRevenue !== false;
  const includeProfit = params.includeProfit !== false;
  const includeSalesCount = params.includeSalesCount !== false;

  const [report, cash, openOrders, createdPage, balances] = await Promise.all([
    buildBusinessReport(ctx.businessId, { from: day, to: day }, { includeEconomics: includeProfit }),
    getCashDayTotals(ctx.businessId, { day }),
    loadOpenOrders(ctx.businessId),
    findOrdersPage({
      businessId: ctx.businessId,
      dateFrom: day,
      dateTo: day,
      dateField: 'createdAt',
      sortDir: 'desc',
      limit: 50,
      offset: 0,
    }),
    computeClientBalanceMap(ctx.businessId),
  ]);

  const deliveredToday = (
    await db.collection(`negocios/${ctx.businessId}/pedidos`).get()
  ).docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>;
    if (!isDeliveredEstado(resolveOrderEstado(String(data.estado ?? '')))) return false;
    const deliveredDay = String(data.entregadoAt ?? '').slice(0, 10);
    return deliveredDay === day;
  }).length;

  const createdToday = createdPage.items.filter((row) => {
    const estado = String(row.data.estado ?? '');
    return !isCancelledStatus(estado);
  }).length;

  let porCobrar = 0;
  for (const amount of balances.values()) {
    if (amount > 0) porCobrar += amount;
  }

  const lines: string[] = [];
  if (includeSalesCount) lines.push(`• Ventas: *${report.summary.ventasCount}*`);
  if (includeRevenue) lines.push(`• Facturado: *$${money(report.summary.facturado)}*`);
  lines.push(`• Cobrado: *$${money(report.summary.cobrado)}*`);
  if (includeProfit && report.summary.ganancia != null) {
    lines.push(`• Ganancia: *$${money(report.summary.ganancia)}*`);
  }
  if (cash.count > 0) {
    lines.push(`• Ingresos caja: *$${money(cash.ingresos)}*`);
    lines.push(`• Egresos caja: *$${money(cash.egresos)}*`);
  }
  lines.push(`• Pedidos creados: *${createdToday}*`);
  lines.push(`• Pedidos entregados: *${deliveredToday}*`);
  if (porCobrar > 0) lines.push(`• Por cobrar: *$${money(porCobrar)}*`);
  if (openOrders.length) lines.push(`• Pedidos abiertos: *${openOrders.length}*`);

  return {
    title: '📊 Así cerró tu día',
    lines,
    shouldDeliver: lines.length > 0,
    empty: lines.length === 0,
  };
}

export async function executeDailyAttentionDigest(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const windowEnd = addDaysToDayKey(day, 3);

  const [openOrders, promisesDue, payables] = await Promise.all([
    loadOpenOrders(ctx.businessId),
    loadPaymentPromisesDueOn(ctx.businessId, day),
    listPayableInstallments(ctx.businessId, { scope: 'all' }).catch(() => ({ items: [] })),
  ]);

  const dueToday = openOrders.filter((row) => orderDeliveryDay(row.data) === day);
  const overdue = openOrders.filter((row) => {
    const delivery = orderDeliveryDay(row.data);
    return !!delivery && delivery < day;
  });
  const payablesSoon = payables.items.filter((item) => {
    if (item.estado === 'pagada' || item.displayEstado === 'pagada') return false;
    const fecha = String(item.fechaVencimiento ?? '').slice(0, 10);
    return fecha >= day && fecha <= windowEnd;
  });

  const lines: string[] = [];
  if (dueToday.length) {
    lines.push(`📦 ${dueToday.length} pedido${dueToday.length === 1 ? '' : 's'} para entregar`);
  }
  if (overdue.length) {
    lines.push(`⚠️ ${overdue.length} pedido${overdue.length === 1 ? '' : 's'} atrasado${overdue.length === 1 ? '' : 's'}`);
  }
  for (const row of promisesDue.slice(0, 10)) {
    lines.push(`💰 ${row.clienteNombre} prometió pagar $${money(row.monto)}`);
  }
  for (const item of payablesSoon.slice(0, 10)) {
    const fecha = String(item.fechaVencimiento ?? '').slice(0, 10);
    const days = daysBetweenDayKeys(day, fecha);
    const name = String(item.beneficiario ?? item.descripcion ?? 'Cuenta').trim() || 'Cuenta';
    if (days <= 0) lines.push(`🧾 ${name} vence hoy`);
    else lines.push(`🧾 ${name} vence en ${days} día${days === 1 ? '' : 's'}`);
  }

  return {
    title: '☀️ Buen día. Esto es lo importante para hoy',
    lines,
    shouldDeliver: lines.length > 0,
    empty: lines.length === 0,
  };
}

export async function executePayablesDueReminder(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const daysBefore = Math.max(0, Number(ctx.automation.parameters.daysBefore) || 3);
  const targetDay = addDaysToDayKey(day, daysBefore);
  const windowEnd = targetDay;

  const payables = await listPayableInstallments(ctx.businessId, { scope: 'all' }).catch(() => ({
    items: [] as Awaited<ReturnType<typeof listPayableInstallments>>['items'],
  }));

  const matches = payables.items.filter((item) => {
    if (item.estado === 'pagada' || item.displayEstado === 'pagada') return false;
    const fecha = String(item.fechaVencimiento ?? '').slice(0, 10);
    if (!fecha) return false;
    // Prefer exact day-before match; also accept within the window [today, target].
    return fecha === targetDay || (fecha >= day && fecha <= windowEnd);
  });

  // Deduplicate: if exact matches exist, prefer those; otherwise keep window hits.
  const exact = matches.filter((item) => String(item.fechaVencimiento ?? '').slice(0, 10) === targetDay);
  const rows = exact.length ? exact : matches;

  const lines = rows.slice(0, 15).map((item) => {
    const fecha = String(item.fechaVencimiento ?? '').slice(0, 10);
    const days = daysBetweenDayKeys(day, fecha);
    const name = String(item.beneficiario ?? item.descripcion ?? 'Cuenta').trim() || 'Cuenta';
    const when =
      days <= 0 ? 'vence hoy' : `vence en ${days} día${days === 1 ? '' : 's'}`;
    return `• ${name} · $${money(Number(item.monto) || 0)} · ${when}`;
  });

  return {
    title: '🧾 Cuentas a pagar',
    lines,
    shouldDeliver: lines.length > 0,
    empty: lines.length === 0,
  };
}

export async function executeOrdersStatusReview(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const tomorrow = addDaysToDayKey(day, 1);
  const openOrders = await loadOpenOrders(ctx.businessId);

  const review = openOrders.filter((row) => {
    const estado = resolveOrderEstado(String(row.data.estado ?? ''));
    if (estado !== 'en_produccion' && estado !== 'listo') return false;
    const delivery = orderDeliveryDay(row.data);
    return delivery === day || delivery === tomorrow;
  });

  if (!review.length) {
    return {
      title: '👀 Revisá estos pedidos',
      lines: [],
      shouldDeliver: false,
      empty: true,
    };
  }

  const lines = await Promise.all(
    review.slice(0, 15).map(async (row) => {
      const base = await formatOrderLine(ctx.businessId, row.id, row.data);
      const delivery = orderDeliveryDay(row.data);
      const when = delivery === day ? 'entrega hoy' : 'entrega mañana';
      return `${base} · ${when}`;
    })
  );
  const exampleLabel =
    resolveOrderLabel({
      numeroPedido: Number(review[0].data.numeroPedido) || undefined,
      numeroPedidoLabel: String(review[0].data.numeroPedidoLabel ?? ''),
    }) || '124';
  lines.push(`Respondé "${exampleLabel} listo" cuando estén listos.`);

  return {
    title: '👀 Revisá estos pedidos',
    lines,
    shouldDeliver: true,
    empty: false,
  };
}

export async function executeCustomerPaymentPromisesDue(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const due = await loadPaymentPromisesDueOn(ctx.businessId, day);

  if (!due.length) {
    return {
      title: '💰 Compromisos de cobro',
      lines: [],
      shouldDeliver: false,
      empty: true,
    };
  }

  const lines = due.slice(0, 15).map((row) => `• ${row.clienteNombre}: *$${money(row.monto)}*`);
  return {
    title: '💰 Compromisos de cobro',
    lines,
    shouldDeliver: true,
    empty: false,
  };
}

export async function executeCashDailySummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const ambitoId = ctx.automation.parameters.ambitoId
    ? String(ctx.automation.parameters.ambitoId)
    : undefined;
  const totals = await getCashDayTotals(ctx.businessId, { day, ambitoId });

  if (totals.count <= 0) {
    return {
      title: '💰 Resumen de caja',
      lines: [
        'Hoy todavía no registraste movimientos. Si tuviste alguno, podés anotarlo por acá.',
      ],
      shouldDeliver: true,
      empty: true,
    };
  }

  const { getCashWalletSummaryForPeriod } = await import('../domain/cash/cash-wallet-period.ts');
  const wallet = await getCashWalletSummaryForPeriod(ctx.businessId, 'today', { ambitoId, timeZone: tz });
  return {
    title: '💰 Resumen de caja',
    lines: wallet.message.split('\n').filter(Boolean).map((line) => (line.startsWith('*') ? line : `• ${line}`)),
    shouldDeliver: true,
  };
}

export async function executeCashWalletPeriodSummary(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const raw = String(ctx.automation.parameters.period ?? 'month').trim().toLowerCase();
  const period = (
    ['today', 'week', 'month', 'previous_month'].includes(raw) ? raw : 'month'
  ) as 'today' | 'week' | 'month' | 'previous_month';
  const ambitoId = ctx.automation.parameters.ambitoId
    ? String(ctx.automation.parameters.ambitoId)
    : undefined;
  const { getCashWalletSummaryForPeriod } = await import('../domain/cash/cash-wallet-period.ts');
  const wallet = await getCashWalletSummaryForPeriod(ctx.businessId, period, { ambitoId, timeZone: tz });
  return {
    title: '💵 Resumen por categorías',
    lines: wallet.message.split('\n').filter(Boolean),
    shouldDeliver: wallet.movementCount > 0,
    empty: wallet.movementCount <= 0,
  };
}

export async function executeCashNoMovementsSoft(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const ambitoId = ctx.automation.parameters.ambitoId
    ? String(ctx.automation.parameters.ambitoId)
    : undefined;
  const totals = await getCashDayTotals(ctx.businessId, { day, ambitoId });
  if (totals.count > 0) {
    return {
      title: '💵 Caja',
      lines: [],
      shouldDeliver: false,
      empty: true,
    };
  }
  return {
    title: '💵 Caja',
    lines: [
      'Hoy todavía no registraste movimientos. Si tuviste alguno, podés anotarlo por acá.',
    ],
    shouldDeliver: true,
    empty: true,
  };
}

export async function executeCashExpensesSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const ambitoId = ctx.automation.parameters.ambitoId
    ? String(ctx.automation.parameters.ambitoId)
    : undefined;
  const totals = await getCashDayTotals(ctx.businessId, { day, ambitoId });

  return {
    title: '💸 Egresos del día',
    lines: [`• Total egresos: *$${money(totals.egresos)}*`, `• Movimientos: *${totals.count}*`],
    shouldDeliver: true,
  };
}

export async function executeCashBalanceWatch(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const threshold = Number(ctx.automation.parameters.threshold) || 0;
  const comparator = (String(ctx.automation.parameters.comparator ?? 'lt') as AutomationComparator) || 'lt';
  const ambitoId = ctx.automation.parameters.ambitoId
    ? String(ctx.automation.parameters.ambitoId)
    : undefined;
  const balance = await getCashBalance(ctx.businessId, { ambitoId });
  const current = Number(balance.saldo) || 0;

  return conditionWatchResult(
    '💰 Alerta de caja',
    [`• Saldo actual: *$${money(current)}*`, `• Umbral: *$${money(threshold)}*`],
    current,
    threshold,
    comparator
  );
}

export async function executePendingOrdersSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const orders = await loadOpenOrders(ctx.businessId);
  const lines = await Promise.all(
    orders.slice(0, 15).map((row) => formatOrderLine(ctx.businessId, row.id, row.data))
  );

  return {
    title: '📋 Pedidos pendientes',
    lines: lines.length ? lines : ['• No hay pedidos abiertos.'],
    shouldDeliver: true,
    empty: !lines.length,
  };
}

export async function executeOrdersDueToday(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const day = localDayKey(ctx.referenceDate ?? new Date(), tz);
  const page = await findOrdersPage({
    businessId: ctx.businessId,
    dateFrom: day,
    dateTo: day,
    dateField: 'fechaEntrega',
    sortDir: 'asc',
    limit: 20,
    offset: 0,
  });

  const openDue = page.items.filter((row) => isOpenOrderData(row.data));

  const lines = await Promise.all(
    openDue.map((row) => formatOrderLine(ctx.businessId, row.id, row.data))
  );

  return {
    title: '📋 Pedidos para hoy',
    lines: lines.length ? lines : ['• No hay entregas programadas para hoy.'],
    shouldDeliver: true,
    empty: !lines.length,
  };
}

export async function executeOverdueOrdersWatch(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const thresholdDays = Math.max(1, Number(ctx.automation.parameters.thresholdDays) || 5);
  const now = ctx.referenceDate ?? new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - thresholdDays);

  const orders = await loadOpenOrders(ctx.businessId);
  const overdue = orders.filter((row) => {
    const created = String(row.data.createdAt ?? row.data.fechaEntrega ?? '').slice(0, 10);
    if (!created) return false;
    const createdDate = new Date(created.length === 10 ? `${created}T12:00:00` : created);
    return createdDate.getTime() <= cutoff.getTime();
  });

  const lines = await Promise.all(
    overdue.slice(0, 10).map((row) => formatOrderLine(ctx.businessId, row.id, row.data))
  );

  return {
    title: '⚠️ Pedidos atrasados',
    lines: lines.length ? lines : [],
    conditionValue: overdue.length,
    conditionMet: overdue.length > 0,
    shouldDeliver: overdue.length > 0,
    empty: !overdue.length,
  };
}

export async function executeCustomerBalancesSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const balances = await computeClientBalanceMap(ctx.businessId);
  const clientSnap = await db.collection(`negocios/${ctx.businessId}/clientes`).get();
  const names = new Map(clientSnap.docs.map((doc) => [doc.id, String(doc.data().nombre ?? 'Cliente')]));

  const rows = [...balances.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([clientId, amount]) => `• ${names.get(clientId) ?? clientId}: *$${money(amount)}*`);

  return {
    title: '💵 Clientes con saldo',
    lines: rows.length ? rows : ['• No hay saldos pendientes.'],
    shouldDeliver: true,
    empty: !rows.length,
  };
}

export async function executeCustomerBalanceWatch(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const threshold = Number(ctx.automation.parameters.threshold) || 0;
  const comparator = (String(ctx.automation.parameters.comparator ?? 'gt') as AutomationComparator) || 'gt';
  const balances = await computeClientBalanceMap(ctx.businessId);
  const clientSnap = await db.collection(`negocios/${ctx.businessId}/clientes`).get();
  const names = new Map(clientSnap.docs.map((doc) => [doc.id, String(doc.data().nombre ?? 'Cliente')]));

  const matches = [...balances.entries()]
    .filter(([, amount]) => compareValues(amount, threshold, comparator))
    .sort((a, b) => b[1] - a[1]);

  const maxAmount = matches.length ? matches[0][1] : 0;
  const lines = matches.slice(0, 10).map(([clientId, amount]) => `• ${names.get(clientId) ?? clientId}: *$${money(amount)}*`);

  return {
    title: '💵 Alerta de cobros',
    lines,
    conditionValue: maxAmount,
    conditionMet: matches.length > 0,
    shouldDeliver: matches.length > 0,
    empty: !matches.length,
  };
}

export async function executeLowStockSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const snap = await db.collection(`negocios/${ctx.businessId}/stock`).get();
  const low: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.controlsStock === false) continue;
    const minStock = Number(data.stockMinimo) || 0;
    if (minStock <= 0) continue;
    const disponible = Math.max(
      0,
      (Number(data.stockActual) || 0) - (Number(data.stockReservado) || 0)
    );
    if (disponible <= minStock) {
      low.push(`• ${String(data.nombre ?? doc.id)}: *${disponible} unidades*`);
    }
  }

  return {
    title: '⚠️ Stock bajo',
    lines: low.length ? low.slice(0, 15) : ['• No hay productos bajo mínimo.'],
    shouldDeliver: true,
    empty: !low.length,
  };
}

export async function executeProductStockThresholdWatch(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const productId = String(ctx.automation.parameters.productId ?? '');
  const threshold = Number(ctx.automation.parameters.threshold) || 0;
  const comparator = (String(ctx.automation.parameters.comparator ?? 'lt') as AutomationComparator) || 'lt';
  const stock = await getProductStock(ctx.businessId, productId);
  const product = await getProduct(ctx.businessId, productId);
  const current = Number(stock) || 0;

  return conditionWatchResult(
    '🔔 Alerta de stock',
    [
      `• Producto: ${product?.name ?? productId}`,
      `• Stock actual: *${current}*`,
      `• Umbral: *${threshold}*`,
    ],
    current,
    threshold,
    comparator
  );
}

export async function executeCollaboratorBalanceSummary(
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  const list = await listCollaboratorEntities(ctx.businessId, { limit: 50, offset: 0 });
  const lines: string[] = [];

  for (const item of list.items) {
    const balance = await getCollaboratorBalance(ctx.businessId, item.id);
    if (balance.saldoAcumulado > 0) {
      lines.push(`• ${item.name}: *$${money(balance.saldoAcumulado)}*`);
    }
  }

  return {
    title: '👷 Saldos de colaboradores',
    lines: lines.length ? lines : ['• No hay saldos pendientes.'],
    shouldDeliver: true,
    empty: !lines.length,
  };
}

export async function executeCollaboratorHoursSummary(ctx: AutomationExecuteContext): Promise<AutomationExecuteResult> {
  const tz = ctx.timezone ?? DEFAULT_TZ;
  const ref = ctx.referenceDate ?? new Date();
  const to = localDayKey(ref, tz);
  const fromDate = new Date(ref);
  fromDate.setDate(fromDate.getDate() - 6);
  const from = localDayKey(fromDate, tz);

  const list = await listCollaboratorEntities(ctx.businessId, { limit: 50, offset: 0 });
  const lines: string[] = [];

  for (const item of list.items) {
    const summary = await getCollaboratorHoursSummary(ctx.businessId, item.id, from, to);
    if (summary && summary.totalHoras > 0) {
      lines.push(`• ${item.name}: *${summary.totalHoras} h*`);
    }
  }

  return {
    title: '👷 Horas de colaboradores',
    lines: lines.length ? lines : [`• Sin horas entre ${from} y ${to}.`],
    shouldDeliver: true,
    empty: !lines.length,
  };
}

export async function executeAutomationAction(
  actionId: AutomationActionId,
  ctx: AutomationExecuteContext
): Promise<AutomationExecuteResult> {
  switch (actionId) {
    case 'daily_business_summary':
      return executeDailyBusinessSummary(ctx);
    case 'daily_attention_digest':
      return executeDailyAttentionDigest(ctx);
    case 'cash_daily_summary':
      return executeCashDailySummary(ctx);
    case 'cash_expenses_summary':
      return executeCashExpensesSummary(ctx);
    case 'cash_balance_watch':
      return executeCashBalanceWatch(ctx);
    case 'cash_wallet_period_summary':
      return executeCashWalletPeriodSummary(ctx);
    case 'cash_no_movements_soft':
      return executeCashNoMovementsSoft(ctx);
    case 'pending_orders_summary':
      return executePendingOrdersSummary(ctx);
    case 'orders_due_today':
      return executeOrdersDueToday(ctx);
    case 'orders_status_review':
      return executeOrdersStatusReview(ctx);
    case 'overdue_orders_watch':
      return executeOverdueOrdersWatch(ctx);
    case 'customer_balances_summary':
      return executeCustomerBalancesSummary(ctx);
    case 'customer_balance_watch':
      return executeCustomerBalanceWatch(ctx);
    case 'customer_payment_promises_due':
      return executeCustomerPaymentPromisesDue(ctx);
    case 'payables_due_reminder':
      return executePayablesDueReminder(ctx);
    case 'low_stock_summary':
      return executeLowStockSummary(ctx);
    case 'product_stock_threshold_watch':
      return executeProductStockThresholdWatch(ctx);
    case 'collaborator_balance_summary':
      return executeCollaboratorBalanceSummary(ctx);
    case 'collaborator_hours_summary':
      return executeCollaboratorHoursSummary(ctx);
    default:
      return {
        title: 'Automatización',
        lines: ['Esta acción aún no está disponible en el ERP.'],
        shouldDeliver: false,
        empty: true,
      };
  }
}
