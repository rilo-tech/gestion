import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';
import { V4_CANDIDATE_SELECTION_PROMPT } from './v4-ui-copy.ts';
import type { ConversationState } from './conversation-state.ts';
import { V4_CONFIRM_INTENT } from './v4-confirm.ts';
import { recordPresentedConfirmation } from './v4-workflow-manager.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import { presentConfirmationPlan } from './agent/agent-presenter.ts';

export const V4_ORDER_SETTLE_INTENT = 'awaiting:order_settle_choice';
export const V4_ORDER_SETTLE_AMOUNT_INTENT = 'awaiting:order_settle_amount';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export type OrderSettleTarget = {
  orderId: string;
  label: string;
  clientName?: string;
  clientId?: string;
  saldo: number;
};

export function formatOrderSettleAsk(target: OrderSettleTarget): string {
  return formatWhatsappMessage({
    title: `📋 Pedido #${target.label}${target.clientName ? ` · ${target.clientName}` : ''}`,
    lines: [
      `• Saldo pendiente: $${money(target.saldo)}`,
      '1. Saldar todo',
      '2. Cobrar un monto',
      '3. Dejar con saldo',
    ],
    ask: V4_CANDIDATE_SELECTION_PROMPT,
  });
}

export function formatOrderSettleAmountAsk(target: OrderSettleTarget): string {
  return formatWhatsappMessage({
    title: `📋 Pedido #${target.label}`,
    lines: [`• Saldo pendiente: $${money(target.saldo)}`, 'Decime el monto a cobrar.'],
  });
}

/** Patch estándar al congelar un OperationPlan (incluye lastPresentedConfirmation). */
export function freezeOperationPlanPatch(
  plan: AgentOperationPlan,
  state: ConversationState | null | undefined,
  opts?: { reply?: string; workflowId?: string | null }
): Partial<ConversationState> {
  const reply = opts?.reply ?? presentConfirmationPlan(plan);
  return {
    pendingIntent: V4_CONFIRM_INTENT,
    pendingPayload: { plan },
    pendingPrompt: reply,
    operationPlan: plan as unknown as Record<string, unknown>,
    activeTask: {
      intent: 'confirm_v4',
      awaiting: { field: 'confirmation', type: 'confirm' },
    },
    ...recordPresentedConfirmation(plan, opts?.workflowId ?? state?.activeWorkflowId),
  };
}

export function orderSettleChoicePatch(target: OrderSettleTarget): Partial<ConversationState> {
  const reply = formatOrderSettleAsk(target);
  return {
    pendingIntent: V4_ORDER_SETTLE_INTENT,
    pendingPayload: { settle: target },
    pendingPrompt: reply,
    operationPlan: null,
    activeTask: {
      intent: 'order_settle_choice',
      awaiting: { field: 'settle_choice', type: 'choice' },
    },
    lastPresentedConfirmation: null,
  };
}

export function orderSettleAmountPatch(target: OrderSettleTarget): Partial<ConversationState> {
  const reply = formatOrderSettleAmountAsk(target);
  return {
    pendingIntent: V4_ORDER_SETTLE_AMOUNT_INTENT,
    pendingPayload: { settle: target },
    pendingPrompt: reply,
    operationPlan: null,
    activeTask: {
      intent: 'order_settle_amount',
      awaiting: { field: 'amount', type: 'field' },
    },
    lastPresentedConfirmation: null,
  };
}

export function parseOrderSettleTarget(
  state: ConversationState | null | undefined
): OrderSettleTarget | null {
  const raw = (state?.pendingPayload as { settle?: OrderSettleTarget } | null)?.settle;
  if (!raw?.orderId) return null;
  const saldo = Number(raw.saldo) || 0;
  if (saldo <= 0) return null;
  return {
    orderId: String(raw.orderId),
    label: String(raw.label ?? ''),
    clientName: raw.clientName ? String(raw.clientName) : undefined,
    clientId: raw.clientId ? String(raw.clientId) : undefined,
    saldo,
  };
}

export function planIsStatusOnly(plan: AgentOperationPlan | null | undefined): boolean {
  if (!plan?.writes?.length) return false;
  return plan.writes.every((row) => row.tool === 'update_order_status');
}

export function planHasCollect(plan: AgentOperationPlan | null | undefined): boolean {
  return Boolean(
    plan?.writes?.some(
      (row) =>
        row.tool === 'collect_order_full_balance' || row.tool === 'register_order_payment'
    )
  );
}
