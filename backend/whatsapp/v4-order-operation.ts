import { resolveOrderBalance } from '../../shared/order-balance.ts';
import {
  isDeliveredEstado,
  resolveOrderEstado,
  type ResolvedOrderEstado,
} from '../routes/orders.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import {
  DEFAULT_ORDER_ESTADOS,
  getOrderEstadoLabel,
  normalizeOrderEstadoValue,
  normalizeOrderPedidosConfig,
  slugifyOrderEstadoValue,
  validateOrderEstadoTransition,
  type OrderEstadoConfig,
  type OrderPedidosConfig,
} from '../utils/order-config.ts';
import type { OrderLookupRecord } from './resolve-order-reference.ts';
import { V4_CONFIRMATION_PROMPT } from './v4-ui-copy.ts';
import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';

export type PendingWriteCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

export type OrderOperationContext = {
  pendingWrites: PendingWriteCall[];
};

const ORDER_CLIENT_LOOKUP_TOOLS = new Set([
  'update_order_status',
  'collect_order_full_balance',
  'register_order_payment',
  'register_order_deposit',
]);

export function operationContextRequiresOrderClientResolution(
  context?: OrderOperationContext
): boolean {
  const writes = context?.pendingWrites ?? [];
  return writes.some((row) => ORDER_CLIENT_LOOKUP_TOOLS.has(row.tool));
}

export function readToolsAcceptingOperationContext(): Set<string> {
  return new Set(['find_order', 'find_client', 'list_orders']);
}

export type AnalyzedOrderOperations = {
  wantsStatusUpdate: boolean;
  targetStatus?: string;
  wantsCollectFull: boolean;
  wantsPartialPayment: boolean;
};

export type OrderActionEvaluation = {
  applicableActions: string[];
  alreadySatisfiedActions: string[];
  blockedActions: Array<{ tool: string; reason?: string }>;
};

export type OrderOperationResolution =
  | { kind: 'resolved'; order: OrderLookupRecord }
  | { kind: 'ambiguous'; candidates: OrderLookupRecord[] }
  | { kind: 'already_complete'; order: OrderLookupRecord; evaluation: OrderActionEvaluation }
  | { kind: 'partial_satisfied'; order: OrderLookupRecord; evaluation: OrderActionEvaluation }
  | { kind: 'none' };

const DEFAULT_PEDIDOS_CONFIG = normalizeOrderPedidosConfig({});

export function analyzePendingWrites(writes: PendingWriteCall[]): AnalyzedOrderOperations {
  let wantsStatusUpdate = false;
  let targetStatus: string | undefined;
  let wantsCollectFull = false;
  let wantsPartialPayment = false;
  for (const row of writes) {
    if (row.tool === 'update_order_status') {
      wantsStatusUpdate = true;
      targetStatus = resolveAgentOrderStatus(String(row.arguments.status ?? ''));
    }
    if (row.tool === 'collect_order_full_balance') {
      wantsCollectFull = true;
    }
    if (row.tool === 'register_order_payment' || row.tool === 'register_order_deposit') {
      wantsPartialPayment = true;
    }
  }
  return { wantsStatusUpdate, targetStatus, wantsCollectFull, wantsPartialPayment };
}

/** Maps structured Agent status args to a canonical ERP estado value. */
export function resolveAgentOrderStatus(
  raw: string,
  estados: OrderEstadoConfig[] = DEFAULT_ORDER_ESTADOS
): string | undefined {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return undefined;

  const folded = normalizeOrderEstadoValue(trimmed);
  for (const row of estados) {
    if (normalizeOrderEstadoValue(row.value) === folded) return row.value;
    if (slugifyOrderEstadoValue(row.label) === folded) return row.value;
  }

  const resolved = resolveOrderEstado(trimmed);
  if (resolved === 'otro') return folded || undefined;
  if (resolved === 'entregado_con_saldo') return 'entregado';
  return resolved;
}

export function orderRecordSaldo(data: Record<string, unknown>): number {
  if (data.saldo != null && Number.isFinite(Number(data.saldo))) {
    return Number(data.saldo);
  }
  return resolveOrderBalance(data as Parameters<typeof resolveOrderBalance>[0]).saldo;
}

export function orderRecordEstado(data: Record<string, unknown>): string {
  return resolveOrderEstado(String(data.estado ?? ''));
}

export function orderRecordLabel(data: Record<string, unknown>): string {
  return resolveOrderLabel({
    numeroPedido: Number(data.numeroPedido) || undefined,
    numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
  });
}

function statusTransitionOutcome(
  data: Record<string, unknown>,
  targetStatus: string,
  config: OrderPedidosConfig
): 'applicable' | 'satisfied' | 'blocked' {
  const currentRaw = String(data.estado ?? '');
  const current = resolveOrderEstado(currentRaw);
  const target = resolveOrderEstado(targetStatus);
  const targetCanonical = resolveAgentOrderStatus(targetStatus, config.estados) ?? targetStatus;

  if (target === 'entregado' && isDeliveredEstado(current)) return 'satisfied';
  if (
    normalizeOrderEstadoValue(currentRaw) === normalizeOrderEstadoValue(targetCanonical) ||
    current === target
  ) {
    return 'satisfied';
  }

  const transition = validateOrderEstadoTransition({
    previousEstado: currentRaw,
    nextEstado: targetCanonical,
    triggerEstado: config.estadoDescuentaStock,
    stockDescontado: Boolean(data.stockDescontado),
    estados: config.estados,
  });
  if (!transition.allowed) return 'blocked';
  return 'applicable';
}

export function evaluateOrderForActions(
  data: Record<string, unknown>,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): OrderActionEvaluation {
  const saldo = orderRecordSaldo(data);
  const applicableActions: string[] = [];
  const alreadySatisfiedActions: string[] = [];
  const blockedActions: Array<{ tool: string; reason?: string }> = [];

  if (ops.wantsStatusUpdate && ops.targetStatus) {
    const outcome = statusTransitionOutcome(data, ops.targetStatus, config);
    if (outcome === 'applicable') applicableActions.push('update_order_status');
    else if (outcome === 'satisfied') alreadySatisfiedActions.push('update_order_status');
    else blockedActions.push({ tool: 'update_order_status', reason: 'Transición no permitida.' });
  }

  if (ops.wantsCollectFull) {
    if (saldo > 0.009) applicableActions.push('collect_order_full_balance');
    else alreadySatisfiedActions.push('collect_order_full_balance');
  }

  if (ops.wantsPartialPayment) {
    if (saldo > 0.009) applicableActions.push('register_order_payment');
    else alreadySatisfiedActions.push('register_order_payment');
  }

  console.info(
    '[v4:order-action:evaluate]',
    JSON.stringify({
      orderId: String(data.id ?? ''),
      applicableActions,
      alreadySatisfiedActions,
      blockedActions: blockedActions.map((row) => row.tool),
    })
  );

  return { applicableActions, alreadySatisfiedActions, blockedActions };
}

export function isOrderEligibleForOperations(
  data: Record<string, unknown>,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): boolean {
  if (!ops.wantsStatusUpdate && !ops.wantsCollectFull && !ops.wantsPartialPayment) {
    const estado = orderRecordEstado(data);
    const saldo = orderRecordSaldo(data);
    return !isDeliveredEstado(estado as ResolvedOrderEstado) || saldo > 0.009;
  }
  return evaluateOrderForActions(data, ops, config).applicableActions.length > 0;
}

export function filterEligibleOrderRecords(
  rows: OrderLookupRecord[],
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): OrderLookupRecord[] {
  return rows.filter((row) => isOrderEligibleForOperations(row.data, ops, config));
}

export function resolveOrdersForOperation(
  rows: OrderLookupRecord[],
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): OrderOperationResolution {
  const eligible = filterEligibleOrderRecords(rows, ops, config);
  if (eligible.length === 1) return { kind: 'resolved', order: eligible[0]! };
  if (eligible.length > 1) return { kind: 'ambiguous', candidates: eligible };

  if (rows.length === 1) {
    const evaluation = evaluateOrderForActions(rows[0]!.data, ops, config);
    if (evaluation.applicableActions.length > 0) {
      return { kind: 'resolved', order: rows[0]! };
    }
    if (evaluation.alreadySatisfiedActions.length > 0 && evaluation.applicableActions.length === 0) {
      if (evaluation.alreadySatisfiedActions.length >= countRequestedActions(ops)) {
        return { kind: 'already_complete', order: rows[0]!, evaluation };
      }
      return { kind: 'partial_satisfied', order: rows[0]!, evaluation };
    }
  }

  const explainable = rows.filter((row) => {
    const evaluation = evaluateOrderForActions(row.data, ops, config);
    return evaluation.alreadySatisfiedActions.length > 0;
  });
  if (explainable.length === 1) {
    const evaluation = evaluateOrderForActions(explainable[0]!.data, ops, config);
    if (evaluation.applicableActions.length > 0) {
      return { kind: 'resolved', order: explainable[0]! };
    }
    if (evaluation.alreadySatisfiedActions.length >= countRequestedActions(ops)) {
      return { kind: 'already_complete', order: explainable[0]!, evaluation };
    }
    return { kind: 'partial_satisfied', order: explainable[0]!, evaluation };
  }

  return { kind: 'none' };
}

function countRequestedActions(ops: AnalyzedOrderOperations): number {
  let count = 0;
  if (ops.wantsStatusUpdate) count += 1;
  if (ops.wantsCollectFull) count += 1;
  if (ops.wantsPartialPayment) count += 1;
  return count;
}

const STATUS_ACTION_LABEL: Partial<Record<string, string>> = {
  entregado: 'entregar',
  pendiente: 'dejar pendiente',
  en_produccion: 'pasar a producción',
  listo: 'marcar como listo',
};

export function clientCandidateTitleForOperations(
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string {
  if (ops.wantsStatusUpdate && ops.targetStatus) {
    const canonical = resolveAgentOrderStatus(ops.targetStatus, config.estados) ?? ops.targetStatus;
    const action = STATUS_ACTION_LABEL[canonical] ?? getOrderEstadoLabel(canonical, config.estados).toLowerCase();
    return `👥 Clientes con pedidos para ${action}`;
  }
  if (ops.wantsCollectFull || ops.wantsPartialPayment) {
    return '👥 Clientes con pedidos con saldo pendiente';
  }
  return '👥 Clientes encontrados';
}

export function noEligibleOrdersMessage(
  clientName: string,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string {
  if (ops.wantsStatusUpdate && ops.targetStatus) {
    const canonical = resolveAgentOrderStatus(ops.targetStatus, config.estados) ?? ops.targetStatus;
    const action = STATUS_ACTION_LABEL[canonical] ?? getOrderEstadoLabel(canonical, config.estados).toLowerCase();
    return `Los pedidos que encontré para *${clientName}* ya están ${action === 'entregar' ? 'entregados' : `en el estado solicitado`}.\n\nSi querés operar sobre otro pedido, pasame el número o algún otro dato.`;
  }
  return `No hay pedidos aplicables para *${clientName}* con esta solicitud.`;
}

export function noEligibleClientsMessage(
  clientQuery: string,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string {
  if (ops.wantsStatusUpdate && ops.targetStatus) {
    const canonical = resolveAgentOrderStatus(ops.targetStatus, config.estados) ?? ops.targetStatus;
    const action = STATUS_ACTION_LABEL[canonical] ?? getOrderEstadoLabel(canonical, config.estados).toLowerCase();
    return `*📋 No encontré un pedido para ${action}*\n\nLos pedidos que encontré para clientes parecidos a *${clientQuery}* ya están ${action === 'entregar' ? 'entregados' : 'en el estado solicitado'}.\n\nSi querés operar sobre otro pedido, pasame el número o algún otro dato.`;
  }
  return `*👤 No encontré pedidos aplicables*\n\nLos clientes parecidos a *${clientQuery}* no tienen pedidos para esta solicitud.\n\nPodés pasarme el número de pedido u otro dato del cliente.`;
}

export function clientNotFoundMessage(): string {
  return '*👤 No encontré ese cliente.*\n\nPodés pasarme:\n• número de pedido\n• otro nombre o dato del cliente';
}

export function adjustPendingWritesForOrder(
  writes: PendingWriteCall[],
  order: OrderLookupRecord,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): PendingWriteCall[] {
  const ops = analyzePendingWrites(writes);
  const evaluation = evaluateOrderForActions(order.data, ops, config);
  const adjusted: PendingWriteCall[] = [];
  for (const row of writes) {
    if (row.tool === 'update_order_status' && !evaluation.applicableActions.includes('update_order_status')) {
      continue;
    }
    if (row.tool === 'collect_order_full_balance' && !evaluation.applicableActions.includes('collect_order_full_balance')) {
      continue;
    }
    if (row.tool === 'register_order_payment' && !evaluation.applicableActions.includes('register_order_payment')) {
      continue;
    }
    adjusted.push({
      tool: row.tool,
      arguments: {
        ...row.arguments,
        orderId: order.id,
        clientName: String(order.data.clienteNombre ?? order.data.clientName ?? row.arguments.clientName ?? ''),
      },
    });
  }
  return adjusted;
}

export function orderCandidateFromRecord(row: OrderLookupRecord): Record<string, unknown> {
  const saldo = orderRecordSaldo(row.data);
  const estado = orderRecordEstado(row.data);
  return {
    id: row.id,
    number: orderRecordLabel(row.data),
    status: estado,
    statusLabel: estado,
    balance: saldo,
    total: Number(row.data.total) || undefined,
    deliveryDate: String(row.data.fechaEntrega ?? row.data.deliveryDate ?? '').slice(0, 10) || undefined,
    clientName: String(row.data.clienteNombre ?? row.data.clientName ?? ''),
  };
}

export function orderSelectionLabel(row: OrderLookupRecord): string {
  const number = orderRecordLabel(row.data);
  const estado = orderRecordEstado(row.data);
  const saldo = orderRecordSaldo(row.data);
  const saldoLabel = saldo > 0.009 ? ` · Saldo $${money(saldo)}` : '';
  return `#${number} · ${estado}${saldoLabel}`;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function statusLineForPlan(
  order: OrderLookupRecord,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig
): string | null {
  if (!ops.wantsStatusUpdate || !ops.targetStatus) return null;
  const estado = orderRecordEstado(order.data);
  const targetLabel = getOrderEstadoLabel(ops.targetStatus, config.estados);
  const evaluation = evaluateOrderForActions(order.data, ops, config);
  if (evaluation.alreadySatisfiedActions.includes('update_order_status')) {
    if (ops.targetStatus === 'entregado' || isDeliveredEstado(resolveOrderEstado(ops.targetStatus))) {
      return '• Estado: Ya está entregado';
    }
    return `• Estado: Ya está ${targetLabel.toLowerCase()}`;
  }
  const currentLabel = getOrderEstadoLabel(String(order.data.estado ?? estado), config.estados);
  return `• Estado: ${currentLabel} → ${targetLabel}`;
}

export function buildCompoundOrderPlanLines(
  order: OrderLookupRecord,
  writes: PendingWriteCall[],
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string[] {
  const ops = analyzePendingWrites(writes);
  const saldo = orderRecordSaldo(order.data);
  const lines: string[] = [];
  const statusLine = statusLineForPlan(order, ops, config);
  if (statusLine) lines.push(statusLine);

  if (ops.wantsCollectFull) {
    if (saldo <= 0.009) lines.push('• Saldo: Ya saldado');
    else lines.push(`• Saldo pendiente: $${money(saldo)}`, '• Cobro: Saldo total');
  }
  if (ops.wantsPartialPayment && !ops.wantsCollectFull) {
    const amount = writes.find((row) => row.tool === 'register_order_payment')?.arguments.amount;
    if (amount != null) lines.push(`• Cobro: $${money(Number(amount) || 0)}`);
  }
  return lines;
}

export function compoundOrderPlanSummary(
  order: OrderLookupRecord,
  writes: PendingWriteCall[],
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): { title: string; lines: string[] } {
  const number = orderRecordLabel(order.data);
  const clientName = String(order.data.clienteNombre ?? order.data.clientName ?? '').trim();
  const lines = buildCompoundOrderPlanLines(order, writes, config);
  return {
    title: `📋 Pedido #${number}${clientName ? ` · ${clientName}` : ''}`,
    lines,
  };
}

export function buildOrderAlreadyCompleteReply(
  order: OrderLookupRecord,
  ops: AnalyzedOrderOperations,
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string {
  const number = orderRecordLabel(order.data);
  const clientName = String(order.data.clienteNombre ?? order.data.clientName ?? '').trim();
  const estado = getOrderEstadoLabel(String(order.data.estado ?? ''), config.estados);
  const saldo = orderRecordSaldo(order.data);
  const title = `✅ Pedido #${number}${clientName ? ` · ${clientName}` : ''}`;
  const lines = [`• Estado: ${estado}`, `• Saldo: $${money(saldo)}`];
  if (ops.wantsStatusUpdate && ops.wantsCollectFull) {
    lines.push('Ese pedido ya está entregado y saldado.');
  } else if (ops.wantsCollectFull) {
    lines.push('Ese pedido ya está saldado.');
  } else {
    lines.push('Ese pedido ya cumple lo que pediste.');
  }
  lines.push('Si te referís a otro, pasame el número o algún otro dato.');
  return [title, '', ...lines].join('\n');
}

export function buildOrderPartialSatisfiedReply(
  order: OrderLookupRecord,
  writes: PendingWriteCall[],
  config: OrderPedidosConfig = DEFAULT_PEDIDOS_CONFIG
): string {
  const summary = compoundOrderPlanSummary(order, writes, config);
  return formatWhatsappMessage({
    title: summary.title,
    lines: summary.lines,
    ask: V4_CONFIRMATION_PROMPT,
  });
}
