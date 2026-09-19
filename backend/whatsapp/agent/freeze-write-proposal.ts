import type { AgentOperationPlan, ToolCallRequest, ToolExecutionResult } from './tool-types.ts';
import type { ConversationState } from '../conversation-state.ts';
import { presentConfirmationPlan } from './agent-presenter.ts';
import { recordPresentedConfirmation, syncActiveWorkflow } from '../v4-workflow-manager.ts';

/**
 * Señal genérica de tools READ: el backend puede congelar un write
 * sin depender de que el LLM vuelva a pedir confirmación en texto libre.
 *
 * output.freezeWrite = { tool, args }
 */
export function freezeWriteCallsFromToolResults(results: ToolExecutionResult[]): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const seen = new Set<string>();
  for (const row of results) {
    if (!row.ok) continue;
    const proposal = row.output?.freezeWrite;
    if (!proposal || typeof proposal !== 'object') continue;
    const tool = String((proposal as { tool?: unknown }).tool ?? '').trim();
    if (!tool) continue;
    const argsRaw = (proposal as { args?: unknown }).args;
    const args =
      argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
        ? (argsRaw as Record<string, unknown>)
        : {};
    const key = `${tool}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `freeze:${row.toolCallId}:${tool}`,
      name: tool,
      arguments: args,
    });
  }
  return out;
}

export function confirmationStatePatchFromPlan(
  plan: AgentOperationPlan,
  state: ConversationState | null | undefined,
  confirmationReply: string
): Partial<ConversationState> {
  return {
    pendingIntent: 'confirm:v4_write',
    pendingPayload: { plan },
    pendingPrompt: confirmationReply,
    operationPlan: plan as unknown as Record<string, unknown>,
    activeTask: {
      intent: 'confirm_v4',
      awaiting: { field: 'confirmation', type: 'confirm' },
    },
    visualDraft: state?.visualDraft ?? null,
    ...syncActiveWorkflow({
      ...(state ?? {
        businessId: '',
        phone: '',
        updatedAt: new Date().toISOString(),
      }),
      pendingIntent: 'confirm:v4_write',
      pendingPayload: { plan },
      operationPlan: plan as unknown as Record<string, unknown>,
    }),
    ...recordPresentedConfirmation(plan, state?.activeWorkflowId),
  };
}

export function presentFrozenConfirmation(plan: AgentOperationPlan): string {
  return presentConfirmationPlan(plan);
}
