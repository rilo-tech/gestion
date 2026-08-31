import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { ConversationState } from './conversation-state.ts';
import {
  type CandidateSelectionAwaiting,
  type CandidateSelectionOption,
  type CandidateSelectionResume,
  buildCandidateSelectionState,
  focusPatchFromCandidate,
  normalizeCandidateRows,
  type CandidateSelectionEntityType,
} from './v4-candidate-selection.ts';
import { executeReadToolCall } from './agent/tool-executor.ts';
import { buildToolRegistry } from './agent/tool-registry.ts';
import {
  presentNumberedCandidateSelection,
  presentOrderListFromToolOutput,
} from './agent/agent-presenter.ts';
import type { ToolExecutionResult } from './agent/tool-types.ts';

function presenterForToolResult(name: string, output: Record<string, unknown>): string {
  if (name === 'list_orders') return presentOrderListFromToolOutput(output);
  if (output.status === 'not_found') {
    return String(output.message ?? 'No encontré resultados.');
  }
  if (output.status === 'filter_blocked') {
    return String(output.message ?? 'No pude aplicar ese filtro.');
  }
  return 'Listo.';
}

function buildStatePatchFromResume(
  toolName: string,
  output: Record<string, unknown>,
  option: CandidateSelectionOption,
  awaiting: CandidateSelectionAwaiting,
  previous: ConversationState | null
): Partial<ConversationState> {
  const patch: Partial<ConversationState> = {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    focusEntities: focusPatchFromCandidate(awaiting.entityType, option, previous?.focusEntities),
  };

  if (toolName === 'list_orders' && Array.isArray(output.items)) {
    const filter = (output.filter ?? {}) as Record<string, unknown>;
    patch.lastQuery = {
      intent: 'query_orders',
      slots: {
        clientName: String(filter.clientName ?? option.label.split(' · ')[0] ?? ''),
        entity: 'orders',
        metric: 'list',
        status: filter.status ? String(filter.status) : undefined,
        limit: output.items.length,
        offset: Number(output.nextOffset) || 0,
      },
    };
    patch.listContext = {
      type: 'orders',
      items: output.items.map((row) => String((row as { number?: string }).number ?? '')),
      currentPage: 1,
      pageSize: output.items.length,
      totalResults: Number(output.total) || output.items.length,
      hasMore: output.hasMore === true,
      offset: Number(output.nextOffset) || 0,
      clientId: option.entityId,
      filters: patch.lastQuery.slots,
      title: filter.clientName ? `Pedidos de ${filter.clientName}` : 'Pedidos',
    };
  }

  return patch;
}

function buildNestedCandidatePatch(
  entityType: CandidateSelectionEntityType,
  candidates: unknown[],
  resume: CandidateSelectionResume
): Partial<ConversationState> {
  const options = normalizeCandidateRows(entityType, candidates);
  return buildCandidateSelectionState({ entityType, options, resume });
}

/** Continúa una operación bloqueada por ambigüedad, sin LLM. */
export async function resumeBlockedToolAfterSelection(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  awaiting: CandidateSelectionAwaiting;
  option: CandidateSelectionOption;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; toolResult?: ToolExecutionResult }> {
  const { tenant, state, awaiting, option } = input;
  const registry = buildToolRegistry();
  const blockedTool = String(awaiting.resume.blockedTool ?? 'list_orders');
  const blockedArgs = { ...(awaiting.resume.blockedArgs ?? {}) };

  if (awaiting.entityType === 'client') {
    blockedArgs.clientId = option.entityId;
    delete blockedArgs.clientQuery;
  } else if (awaiting.entityType === 'product') {
    blockedArgs.productId = option.entityId;
    delete blockedArgs.productQuery;
  } else if (awaiting.entityType === 'supplier') {
    blockedArgs.supplierId = option.entityId;
    delete blockedArgs.supplierQuery;
  } else if (awaiting.entityType === 'order') {
    blockedArgs.orderId = option.entityId;
    delete blockedArgs.orderNumber;
    delete blockedArgs.query;
  }

  const result = await executeReadToolCall(
    {
      id: `resume:${blockedTool}`,
      name: blockedTool,
      arguments: blockedArgs,
    },
    {
      tenant,
      state,
      messageId: undefined,
      rawUserMessage: awaiting.resume.originalUserText,
    },
    registry
  );

  const output = result.output ?? {};
  if (
    (output.status === 'ambiguous' || output.errorCode === 'ENTITY_AMBIGUOUS') &&
    Array.isArray(output.candidates)
  ) {
    const reply = presentNumberedCandidateSelection(awaiting.entityType, output.candidates as unknown[]);
    return {
      reply,
      statePatch: buildNestedCandidatePatch(awaiting.entityType, output.candidates as unknown[], {
        originalUserText: awaiting.resume.originalUserText,
        blockedTool,
        blockedArgs,
        sourceTool: blockedTool,
      }),
    };
  }

  return {
    reply: presenterForToolResult(blockedTool, output),
    statePatch: buildStatePatchFromResume(blockedTool, output, option, awaiting, state),
    toolResult: result,
  };
}
