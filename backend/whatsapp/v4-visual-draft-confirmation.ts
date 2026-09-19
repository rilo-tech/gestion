import { presentConfirmationPlan } from './agent/agent-presenter.ts';
import { buildToolRegistryForTenant } from './agent/tool-registry.ts';
import { prepareWriteToolCalls } from './agent/tool-executor.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { recordPresentedConfirmation } from './v4-workflow-manager.ts';
import {
  isVisualDraftReadyToWrite,
  visualDraftConfirmationPatch,
  visualDraftPlanSummary,
  type VisualDocumentDraft,
} from './v4-visual-draft.ts';

export async function freezeVisualDraftConfirmation(input: {
  draft: VisualDocumentDraft;
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  rawUserMessage?: string;
  messageId?: string;
}): Promise<{
  reply: string;
  statePatch: Partial<ConversationState>;
  operationPlan: AgentOperationPlan;
} | null> {
  if (!isVisualDraftReadyToWrite(input.draft)) return null;

  const registry = await buildToolRegistryForTenant(input.tenant);
  const ctx = {
    tenant: input.tenant,
    state: {
      ...(input.state ?? {
        businessId: input.tenant.businessId,
        phone: input.tenant.phone,
        updatedAt: new Date().toISOString(),
      }),
      visualDraft: input.draft,
    },
    messageId: input.messageId,
    rawUserMessage: input.rawUserMessage ?? '',
  };
  const plan = await prepareWriteToolCalls(
    [{ id: 'visual:prepare', name: 'prepare_visual_draft_write', arguments: { kind: input.draft.kind } }],
    ctx,
    registry
  );
  plan.summary = visualDraftPlanSummary(input.draft);
  if (input.messageId) {
    plan.idempotencyKey = `wa:${input.messageId}:${input.draft.id}:${plan.writes.map((row) => row.tool).join('+')}`;
  }
  return {
    reply: presentConfirmationPlan(plan),
    operationPlan: plan,
    statePatch: {
      ...visualDraftConfirmationPatch(plan, input.draft),
      ...recordPresentedConfirmation(plan, input.state?.activeWorkflowId),
    },
  };
}
