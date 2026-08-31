import { assertCanUseAi, formatThrownUsage } from '../auth/usage-gates.ts';
import {
  appendConversationTurns,
  clearConversationState,
  getConversationState,
  rememberLastOperation,
  saveConversationState,
  type ConversationState,
  type LastWhatsappOperation,
} from './conversation-state.ts';
import { logWhatsappTurn } from './conversation-log.ts';
import type { WhatsappHandlerResult, WhatsappInboundMessage } from './message-handler.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { AgentError, agentErrorReply } from './agent/agent-errors.ts';
import { createConversationAgent } from './agent/conversation-agent.ts';
import type { ConversationAgent } from './agent/tool-types.ts';
import { presentConfirmationPlan } from './agent/agent-presenter.ts';
import { executeAgentOperationPlan } from './agent/tool-executor.ts';
import { parseAgentOperationPlan } from './agent/tools/write-tools.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import {
  V4_CONFIRM_INTENT,
  mapFrozenWriteError,
  shouldCancelFrozenPlan,
  shouldExecuteFrozenPlan,
  shouldReinterpretPendingConfirm,
} from './v4-confirm.ts';

const AI_QUOTA_REPLY = 'Llegaste al límite de acciones de tu plan.';

export type HandleV4Deps = {
  executePlan?: typeof executeAgentOperationPlan;
  createAgent?: () => ConversationAgent;
  rememberOp?: typeof rememberLastOperation;
  clearState?: typeof clearConversationState;
  saveState?: typeof saveConversationState;
  appendTurns?: typeof appendConversationTurns;
  assertAi?: typeof assertCanUseAi;
};

function planFromState(state: ConversationState | null): AgentOperationPlan | null {
  if (!state) return null;
  const direct = parseAgentOperationPlan(state.operationPlan);
  if (direct) return direct;
  const pending = state.pendingPayload as { plan?: AgentOperationPlan } | null | undefined;
  return pending?.plan ? parseAgentOperationPlan(pending.plan) : null;
}

async function executeFrozenV4Plan(
  tenant: WhatsappTenantContext,
  phone: string,
  plan: AgentOperationPlan,
  deps: HandleV4Deps
): Promise<WhatsappHandlerResult> {
  const executePlan = deps.executePlan ?? executeAgentOperationPlan;
  const rememberOp = deps.rememberOp ?? rememberLastOperation;
  const saveState = deps.saveState ?? saveConversationState;
  const appendTurns = deps.appendTurns ?? appendConversationTurns;

  console.info(
    '[v4:plan:execute:start]',
    JSON.stringify({
      businessId: tenant.businessId,
      idempotencyKey: plan.idempotencyKey ?? null,
      writes: plan.writes.map((row) => ({
        tool: row.tool,
        orderId: row.args.orderId ?? null,
        orderNumber: row.args.orderNumber ?? null,
        status: row.args.status ?? row.args.requestedStatus ?? null,
      })),
    })
  );

  const result = await executePlan(tenant, plan);
  const data = result.data ?? {};
  const operation: LastWhatsappOperation = {
    kind:
      data.kind === 'cash'
        ? 'cash'
        : data.kind === 'payment'
          ? 'payment'
          : data.kind === 'client'
            ? 'client'
            : data.kind === 'sale'
              ? 'sale'
              : data.kind === 'purchase'
                ? 'purchase'
                : 'order',
    id: String(data.orderId ?? data.clientId ?? data.productId ?? data.ventaId ?? data.compraId ?? ''),
    label: data.label ? String(data.label) : undefined,
    clientName: data.clientName ? String(data.clientName) : undefined,
    clientId: data.clientId ? String(data.clientId) : undefined,
    status: data.status ? String(data.status) : undefined,
    amount: data.amount != null ? Number(data.amount) : undefined,
    productId: data.productId ? String(data.productId) : undefined,
    productName: data.productName ? String(data.productName) : undefined,
    at: new Date().toISOString(),
  };
  try {
    if (operation.id) {
      await rememberOp(tenant.businessId, phone, operation);
    } else {
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        operationPlan: null,
      });
    }
    await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: result.reply }]);
  } catch (error) {
    console.error('[v4:plan:execute] WRITE_EXECUTED_BUT_RESPONSE_FAILED', error);
    return {
      reply: result.reply,
      intent: 'v4_execute_persist_failed',
      executed: true,
      businessId: tenant.businessId,
    };
  }
  return {
    reply: result.reply,
    intent: 'v4_execute',
    executed: true,
    businessId: tenant.businessId,
  };
}

export async function handleV4WhatsappTurn(
  input: {
    tenant: WhatsappTenantContext;
    phone: string;
    message: WhatsappInboundMessage;
    text: string;
    state: ConversationState | null;
  },
  deps: HandleV4Deps = {}
): Promise<WhatsappHandlerResult> {
  const { tenant, phone, message, text } = input;
  const clearState = deps.clearState ?? clearConversationState;
  const appendTurns = deps.appendTurns ?? appendConversationTurns;
  const saveState = deps.saveState ?? saveConversationState;
  let state = input.state ?? (await getConversationState(tenant.businessId, phone));

  if (shouldCancelFrozenPlan(state?.pendingIntent, text)) {
    await clearState(tenant.businessId, phone);
    const reply = 'Listo, cancelado.';
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: reply },
    ]);
    return { reply, intent: 'v4_cancel', executed: false, businessId: tenant.businessId };
  }

  if (shouldExecuteFrozenPlan(state?.pendingIntent, text)) {
    const plan = planFromState(state);
    console.info(
      '[v4:confirmation] accepted',
      JSON.stringify({
        businessId: tenant.businessId,
        pendingIntent: state?.pendingIntent ?? null,
        hasPlan: Boolean(plan),
        writes: plan?.writes.map((row) => row.tool) ?? [],
      })
    );
    if (!plan) {
      await clearState(tenant.businessId, phone);
      return {
        reply: 'No tenía una confirmación pendiente.',
        intent: 'v4_confirm_missing',
        executed: false,
        businessId: tenant.businessId,
      };
    }
    try {
      return await executeFrozenV4Plan(tenant, phone, plan, deps);
    } catch (error) {
      const mapped = mapFrozenWriteError(error);
      if (error instanceof AgentError) {
        mapped.code = error.code;
        mapped.reply = agentErrorReply(error);
      }
      console.error('[v4:plan:execute:error]', mapped.code, error);
      const reply = mapped.reply;
      await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: reply }]);
      logWhatsappTurn({
        rawMessage: text,
        engine: 'v4',
        intent: 'v4_execute_error',
        executed: false,
        whyFallbackWasUsed: mapped.code,
      });
      return {
        reply,
        intent: 'v4_execute_error',
        executed: false,
        businessId: tenant.businessId,
      };
    }
  }

  if (shouldReinterpretPendingConfirm(state?.pendingIntent, text)) {
    console.info('[v4:confirmation] correction → agent', { text: text.slice(0, 80) });
  }

  try {
    await (deps.assertAi ?? assertCanUseAi)(tenant.businessId, 2);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const reply =
      code === 'AI_QUOTA_EXCEEDED'
        ? AI_QUOTA_REPLY
        : await formatThrownUsage(error, tenant.businessId);
    return {
      reply,
      intent: code === 'AI_QUOTA_EXCEEDED' ? 'ai_quota' : 'usage_blocked',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (text) {
    await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
  }

  try {
    const agent = (deps.createAgent ?? createConversationAgent)();
    const result = await agent.runTurn({
      tenant,
      state,
      text,
      messageId: message.messageId,
      transcript: text,
    });

    const patch = {
      ...(result.statePatch ?? {}),
      operationPlan: result.operationPlan
        ? (result.operationPlan as unknown as Record<string, unknown>)
        : result.statePatch?.operationPlan,
    };
    if (Object.keys(patch).length) {
      state = await saveState(tenant.businessId, phone, patch);
    }

    await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: result.reply }]);

    logWhatsappTurn({
      rawMessage: text,
      engine: 'v4',
      intent: result.intent,
      executed: result.executed,
      finalOperationPlan: result.operationPlan ? presentConfirmationPlan(result.operationPlan).slice(0, 180) : null,
      resolvedEntities: result.toolResults
        ?.flatMap((row) => Object.keys(row.output ?? {}))
        .slice(0, 8),
      llmOutput: result.reply.slice(0, 400),
    });

    console.info(
      '[whatsapp:v4:turn]',
      JSON.stringify({
        businessId: tenant.businessId,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        toolCalls: result.toolCalls?.map((row) => row.name),
        executed: result.executed,
      })
    );

    return {
      reply: result.reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  } catch (error) {
    const reply = agentErrorReply(error);
    await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: reply }]);
    logWhatsappTurn({
      rawMessage: text,
      engine: 'v4',
      intent: 'v4_error',
      executed: false,
      whyFallbackWasUsed: error instanceof Error ? error.message : 'unknown',
    });
    return {
      reply,
      intent: 'v4_error',
      executed: false,
      businessId: tenant.businessId,
    };
  }
}
