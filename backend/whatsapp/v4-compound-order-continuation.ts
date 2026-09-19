import { loadOrderPedidosConfig } from '../routes/orders.ts';
import { presentConfirmationPlan } from './agent/agent-presenter.ts';
import { prepareWriteToolCalls } from './agent/tool-executor.ts';
import type { ToolCallRequest, ToolExecutionContext, ToolRegistryEntry } from './agent/tool-types.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { firestoreGetOrderById } from './resolve-order-reference.ts';
import {
  adjustPendingWritesForOrder,
  analyzePendingWrites,
  buildOrderAlreadyCompleteReply,
  buildOrderPartialSatisfiedReply,
  compoundOrderPlanSummary,
  type PendingWriteCall,
} from './v4-order-operation.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import { freezeOperationPlanPatch } from './v4-order-settle.ts';

export type CompoundOrderContinuationResult = {
  reply: string;
  plan?: AgentOperationPlan;
  statePatch: Partial<ConversationState>;
};

export async function buildCompoundContinuationFromFindOrder(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  findOutput: Record<string, unknown>;
  pendingWrites: PendingWriteCall[];
  rawUserMessage: string;
  registry: ToolRegistryEntry[];
}): Promise<CompoundOrderContinuationResult | null> {
  if (input.findOutput.status !== 'resolved' || !input.findOutput.entity) return null;
  if (!input.pendingWrites.length) return null;

  const entity = input.findOutput.entity as Record<string, unknown>;
  const orderId = String(entity.id ?? '').trim();
  if (!orderId) return null;

  const order = await firestoreGetOrderById(input.tenant.businessId, orderId);
  if (!order) return null;

  const config = await loadOrderPedidosConfig(input.tenant.businessId);
  const outcome = String(input.findOutput.operationOutcome ?? 'eligible');
  const adjusted = adjustPendingWritesForOrder(input.pendingWrites, order, config);

  if (outcome === 'already_complete' || (!adjusted.length && outcome !== 'partial_satisfied')) {
    return {
      reply: buildOrderAlreadyCompleteReply(
        order,
        analyzePendingWrites(input.pendingWrites),
        config
      ),
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        lastPresentedConfirmation: null,
      },
    };
  }

  if (!adjusted.length) {
    return {
      reply: 'Ese pedido ya no tiene acciones pendientes para esta solicitud.',
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        lastPresentedConfirmation: null,
      },
    };
  }

  const ctx: ToolExecutionContext = {
    tenant: input.tenant,
    state: input.state,
    messageId: undefined,
    rawUserMessage: input.rawUserMessage,
  };

  const plan = await prepareWriteToolCalls(
    adjusted.map((row, idx) => ({
      id: `compound:${row.tool}:${idx}`,
      name: row.tool,
      arguments: row.arguments,
    })),
    ctx,
    input.registry
  );
  const summary = compoundOrderPlanSummary(order, adjusted, config);
  plan.summary = summary;

  if (outcome === 'partial_satisfied') {
    const displayReply = buildOrderPartialSatisfiedReply(order, input.pendingWrites, config);
    return {
      reply: displayReply,
      plan,
      statePatch: freezeOperationPlanPatch(plan, input.state, { reply: displayReply }),
    };
  }

  const reply = presentConfirmationPlan(plan);
  return {
    reply,
    plan,
    statePatch: freezeOperationPlanPatch(plan, input.state, { reply }),
  };
}

export function pendingWritesFromToolCalls(calls: ToolCallRequest[]): PendingWriteCall[] {
  return calls.map((row) => ({
    tool: row.name,
    arguments: row.arguments ?? {},
  }));
}
