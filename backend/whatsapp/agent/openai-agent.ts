import { AgentError, MODEL_UNAVAILABLE_REPLY } from './agent-errors.ts';
import { buildAgentDeveloperContext, RILOBOT_V4_SYSTEM_INSTRUCTION } from './agent-context.ts';
import { loadUserLanguageMemory } from '../language-memory.ts';
import {
  presentCashBalance,
  presentCashMovements,
  presentCashIncomeSummary,
  presentClientBalanceFromToolOutput,
  presentClientList,
  presentCollaboratorList,
  presentCollaboratorDetail,
  presentCollaboratorBalance,
  presentCollaboratorHoursSummary,
  presentCollaboratorAccountSummary,
  presentConfirmationPlan,
  presentNumberedCandidateSelection,
  presentToolAmbiguity,
  presentOrderBalance,
  presentOrderListFromToolOutput,
  presentOrderLookupFromToolOutput,
  presentStock,
} from './agent-presenter.ts';
import { buildOpenAiUserMessage, openAiTimeoutMsForTurn } from './openai-image-input.ts';
import { buildToolRegistryForTenant, getToolByName, openAiToolsFromRegistry } from './tool-registry.ts';
import { buildCapabilitySnapshotFromRegistry } from '../bot-capability-service.ts';
import { presentV4WhatsappText } from '../v4-whatsapp-present.ts';
import {
  buildCompoundContinuationFromFindOrder,
  pendingWritesFromToolCalls,
} from '../v4-compound-order-continuation.ts';
import { readToolsAcceptingOperationContext } from '../v4-order-operation.ts';
import {
  buildContextPatchFromToolResults,
} from '../v4-conversation-context.ts';
import {
  executeReadToolCall,
  getMaxToolRounds,
  prepareWriteToolCalls,
  summarizeToolOutput,
} from './tool-executor.ts';
import type {
  AgentOperationPlan,
  AgentTurnInput,
  AgentTurnResult,
  ConversationAgent,
  ToolCallRequest,
  ToolExecutionResult,
} from './tool-types.ts';
import {
  ambiguousPayloadFromToolOutput,
  buildCandidateSelectionState,
  inferEntityTypeFromTool,
  normalizeCandidateRows,
} from '../v4-candidate-selection.ts';
import { isRealCandidateAmbiguity } from '../entity-candidate-result.ts';
import {
  isVisualDraftReadyToWrite,
  presentVisualNotFoundItemMenu,
  parseVisualDraft,
  visualDraftConfirmationPatch,
  visualDraftPlanSummary,
} from '../v4-visual-draft.ts';
import {
  confirmationStatePatchFromPlan,
  freezeWriteCallsFromToolResults,
} from './freeze-write-proposal.ts';
import { assistantClaimsCompletedMutation } from '../v4-write-verify.ts';
import { planAllowsAutoCommit } from '../v4-write-disposition.ts';
import {
  getFreshRecentOperation,
  lookupQueryOverlapsRecentOperation,
  recentEntityMatchesLookupTool,
  recoverRecentOperationFromState,
} from '../v4-recent-operation.ts';
import { READ_TOOL_HANDLERS } from './tools/read-tools.ts';
import type { ConversationState } from '../conversation-state.ts';

/**
 * Tras prepare: la disposición de escritura vive SOLO en v4-write-disposition
 * (`planAllowsAutoCommit` / `classifyPreparedPlan`).
 * EXECUTE_DIRECTLY → handle-v4 ejecuta; NEEDS_CONFIRMATION → ¿Confirmo?.
 */
function turnResultFromPreparedPlan(
  plan: AgentOperationPlan,
  input: AgentTurnInput,
  extras: {
    toolCalls?: ToolCallRequest[];
    toolResults?: ToolExecutionResult[];
    provider?: string;
    model?: string;
    latencyMs?: number;
    usage?: AgentTurnResult['usage'];
    contextPatch?: Partial<ConversationState>;
  } = {}
): AgentTurnResult {
  const contextPatch = extras.contextPatch ?? {};
  if (planAllowsAutoCommit(plan)) {
    return {
      reply: '',
      executed: false,
      intent: 'v4_execute_direct',
      operationPlan: plan,
      toolCalls: extras.toolCalls,
      toolResults: extras.toolResults,
      provider: extras.provider,
      model: extras.model,
      latencyMs: extras.latencyMs,
      usage: extras.usage,
      statePatch: contextPatch,
    };
  }
  const reply = v4OutboundReply(presentConfirmationPlan(plan));
  return {
    reply,
    executed: false,
    intent: 'confirm_v4',
    operationPlan: plan,
    toolCalls: extras.toolCalls,
    toolResults: extras.toolResults,
    provider: extras.provider,
    model: extras.model,
    latencyMs: extras.latencyMs,
    usage: extras.usage,
    statePatch: {
      ...contextPatch,
      ...confirmationStatePatchFromPlan(plan, input.state ?? null, reply),
    },
  };
}

type OpenAiResponsePayload = {
  id?: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; code?: string; message?: string };
};

export type OpenAiProbeResult = {
  httpStatus: number;
  durationMs: number;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
  outputText?: string;
};

let openAiV4ConfigLogged = false;

function parseOpenAiErrorPayload(payload: unknown): {
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
} {
  const root = payload as Record<string, unknown>;
  const err = (root.error ?? root) as Record<string, unknown>;
  return {
    errorType: String(err.type ?? root.type ?? '').trim() || undefined,
    errorCode: String(err.code ?? '').trim() || undefined,
    errorMessage: String(err.message ?? root.message ?? '').trim() || undefined,
  };
}

export function logOpenAiV4ConfigOnce(): void {
  if (openAiV4ConfigLogged) return;
  openAiV4ConfigLogged = true;
  console.info(
    '[openai:v4:config]',
    JSON.stringify({
      apiKeyPresent: Boolean(String(process.env.OPENAI_API_KEY ?? '').trim()),
      primaryModel: readEnvModel(true),
      fallbackModel: readEnvModel(false) || null,
    })
  );
}

function logOpenAiV4Error(input: {
  model: string;
  attempt: number;
  durationMs: number;
  httpStatus: number;
  payload?: unknown;
  networkError?: unknown;
}): void {
  const parsed = input.payload ? parseOpenAiErrorPayload(input.payload) : {};
  const network =
    input.networkError instanceof Error
      ? { errorType: 'network', errorCode: input.networkError.name, errorMessage: input.networkError.message }
      : {};
  console.error(
    '[openai:v4:error]',
    JSON.stringify({
      model: input.model,
      attempt: input.attempt,
      durationMs: input.durationMs,
      httpStatus: input.httpStatus,
      errorType: parsed.errorType ?? network.errorType,
      errorCode: parsed.errorCode ?? network.errorCode,
      errorMessage: parsed.errorMessage ?? network.errorMessage,
    })
  );
}

function readEnvModel(primary = true): string {
  if (primary) return String(process.env.OPENAI_RILOBOT_MODEL ?? 'gpt-5.6-terra').trim();
  return String(process.env.OPENAI_RILOBOT_FALLBACK_MODEL ?? '').trim();
}

function reasoningEffort(): 'low' | 'medium' {
  const raw = String(process.env.OPENAI_RILOBOT_REASONING_EFFORT ?? 'low').trim().toLowerCase();
  return raw === 'medium' ? 'medium' : 'low';
}

function extractFunctionCalls(payload: OpenAiResponsePayload): ToolCallRequest[] {
  const out = payload.output ?? [];
  const calls: ToolCallRequest[] = [];
  for (const item of out) {
    if (item.type !== 'function_call') continue;
    const name = String(item.name ?? '').trim();
    if (!name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(item.arguments ?? '{}')) as Record<string, unknown>;
    } catch {
      args = {};
    }
    calls.push({
      id: String(item.call_id ?? item.id ?? `${name}:${calls.length + 1}`),
      name,
      arguments: args,
    });
  }
  return calls;
}

function extractAssistantText(payload: OpenAiResponsePayload): string {
  if (payload.output_text) return String(payload.output_text).trim();
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        const row = part as Record<string, unknown>;
        if (row.type === 'output_text' && row.text) chunks.push(String(row.text));
      }
    }
  }
  return chunks.join('\n').trim();
}

/** Texto saliente V4: normaliza markdown/HTML del LLM sin reinterpretar datos. */
function v4OutboundReply(text: string | null | undefined): string {
  return presentV4WhatsappText(String(text ?? ''));
}

/**
 * Menús de borrador visual ya vienen presentados en `output.message`
 * (cancelar en 0, ask con texto libre). No re-numerar con presentToolAmbiguity.
 */
export function replyForCandidateSelectionToolOutput(
  output: Record<string, unknown>,
  entityType: Parameters<typeof presentToolAmbiguity>[0]
): string {
  const message = String(output.message ?? '').trim();
  const issueKind = String(output.issueKind ?? '').trim();
  const hasVisualPresenter = Boolean(output.selectionPatch) || Boolean(issueKind);
  if (hasVisualPresenter && message) return message;

  const ambiguousReply = presentToolAmbiguity(entityType, output);
  if (ambiguousReply) return ambiguousReply;

  if (issueKind === 'visual_not_found_menu' && output.itemIndex != null) {
    return presentVisualNotFoundItemMenu(Number(output.itemIndex));
  }
  return message || 'Indicame qué ítem querés usar, escribime el nombre, o qué querés hacer.';
}

function presentRecentOperationList(output: Record<string, unknown>): string | null {
  const message = String(output.message ?? '').trim();
  if (message) {
    const title =
      output.source === 'recent_operation' || output.source === 'ids'
        ? 'Así quedaron'
        : null;
    if (title && !message.startsWith('*') && !message.includes('Así quedaron')) {
      return `📦 *${title}*\n${message}`;
    }
    return message;
  }
  if (!Array.isArray(output.items) || !output.items.length) return null;
  return (output.items as Array<{ name?: string; number?: string; id?: string }>)
    .map((row, index) => `${index + 1}. ${row.name || row.number || row.id || ''}`)
    .join('\n');
}

async function resolveNotFoundViaRecentOperation(input: {
  toolName: string;
  output: Record<string, unknown>;
  state: ConversationState | null | undefined;
  tenant: AgentTurnInput['tenant'];
  rawUserMessage?: string;
}): Promise<string | null> {
  const recent = recoverRecentOperationFromState(input.state) ?? getFreshRecentOperation(input.state);
  if (!recentEntityMatchesLookupTool(input.toolName, recent)) return null;
  const query = String(input.output.query ?? '').trim();
  const fromRecent = input.output.source === 'ids' || input.output.source === 'recent_operation';
  if (fromRecent) return null;

  const overlaps =
    lookupQueryOverlapsRecentOperation(query, recent) ||
    lookupQueryOverlapsRecentOperation(String(input.rawUserMessage ?? ''), recent);
  const writeFollowUp = recent!.action !== 'list' && recent!.action !== 'select';
  /**
   * Tras un write fresco: si el find/list falló, preferir IDs de recentOperation
   * (continuidad «cómo quedaron» / «listamelos»). Si la query solapa labels, también.
   * Si fue solo un listado previo y la query no solapa, no secuestrar la búsqueda.
   */
  if (!overlaps && !writeFollowUp && query) return null;
  if (!overlaps && !writeFollowUp && !query) return null;

  const handler = READ_TOOL_HANDLERS.list_recent_operation_records;
  if (!handler) return null;
  const listed = await handler(
    {},
    {
      tenant: input.tenant,
      state: input.state ?? null,
      rawUserMessage: input.rawUserMessage,
      registry: [],
    }
  );
  if (!listed || listed.status === 'not_found') return null;
  if (!Array.isArray(listed.items) || listed.items.length === 0) return null;
  return presentRecentOperationList(listed);
}

function deterministicReplyFromTools(
  results: ToolExecutionResult[],
  opts?: { state?: ConversationState | null; tenant?: AgentTurnInput['tenant']; rawUserMessage?: string }
): string | null {
  const clientBalance = [...results].reverse().find((row) => row.ok && row.name === 'get_client_balance');
  if (clientBalance) {
    return presentClientBalanceFromToolOutput(clientBalance.output);
  }
  const listOrders = [...results].reverse().find((row) => row.ok && row.name === 'list_orders');
  if (listOrders) {
    return presentOrderListFromToolOutput({
      ...listOrders.output,
      detail: true,
      filter: {
        ...(listOrders.output.filter as Record<string, unknown> | undefined),
      },
    });
  }
  const recentList = [...results]
    .reverse()
    .find(
      (row) =>
        row.ok &&
        (row.name === 'list_recent_operation_records' ||
          (row.name === 'list_products' &&
            (row.output.source === 'ids' || row.output.source === 'recent_operation')))
    );
  if (recentList) {
    const presented = presentRecentOperationList(recentList.output);
    if (presented) return presented;
  }
  const last = [...results].reverse().find((row) => row.ok);
  if (!last) return null;
  if (last.name === 'find_order' || last.name === 'get_order') {
    return presentOrderLookupFromToolOutput(last.output);
  }
  if (last.name === 'get_cash_balance') return presentCashBalance(last.output);
  if (last.name === 'list_cash_movements') return presentCashMovements(last.output);
  if (last.name === 'get_cash_income_summary') return presentCashIncomeSummary(last.output);
  if (last.name === 'list_clients') return presentClientList(last.output);
  if (last.name === 'list_collaborators') return presentCollaboratorList(last.output);
  if (last.name === 'find_collaborator' || last.name === 'get_collaborator') {
    if (last.output.status === 'resolved') return presentCollaboratorDetail(last.output);
  }
  if (last.name === 'get_collaborator_balance') return presentCollaboratorBalance(last.output);
  if (last.name === 'get_collaborator_hours_summary') return presentCollaboratorHoursSummary(last.output);
  if (last.name === 'get_collaborator_account_summary') return presentCollaboratorAccountSummary(last.output);
  if (last.name === 'get_order_balance') return presentOrderBalance(last.output);
  if (last.name === 'get_stock') return presentStock(last.output);
  if (last.name === 'ingest_visual_document' || last.name === 'patch_visual_draft') {
    return String(last.output.message ?? '');
  }
  if (last.name === 'manage_workflow') {
    return String(last.output.message ?? '');
  }
  if (last.name === 'show_bot_guide') {
    return String(last.output.message ?? '');
  }
  if (last.output.status === 'filter_blocked') {
    const ambiguous = presentToolAmbiguity(inferEntityTypeFromTool(last.name), last.output);
    if (ambiguous) return ambiguous;
    return String(last.output.message ?? '');
  }
  if (last.output.status === 'not_found' && last.output.query) {
    return `No encontré ${String(last.output.query)}.`;
  }
  if (
    (last.output.status === 'ambiguous' || last.output.errorCode === 'ENTITY_AMBIGUOUS') &&
    isRealCandidateAmbiguity(last.output.candidates as unknown[])
  ) {
    const entityType = inferEntityTypeFromTool(last.name);
    const title =
      last.output.errorCode === 'ENTITY_AMBIGUOUS' && !last.output.title
        ? undefined
        : String(last.output.message ?? '').replace(/\.$/, '');
    return presentNumberedCandidateSelection(entityType, last.output.candidates as unknown[], title);
  }
  return null;
}

/** Versión async: ante not_found de find/list, reintenta por IDs de recentOperation si solapa. */
async function deterministicReplyFromToolsAsync(
  results: ToolExecutionResult[],
  opts: {
    state?: ConversationState | null;
    tenant: AgentTurnInput['tenant'];
    rawUserMessage?: string;
  }
): Promise<string | null> {
  const sync = deterministicReplyFromTools(results, opts);
  const last = [...results].reverse().find((row) => row.ok);
  if (!last) return sync;
  const emptyList =
    last.name.startsWith('list_') &&
    Array.isArray(last.output.items) &&
    last.output.items.length === 0;
  const notFound = last.output.status === 'not_found';
  if (!notFound && !emptyList) return sync;
  if (sync && !sync.startsWith('No encontré') && !emptyList) return sync;

  const viaRecent = await resolveNotFoundViaRecentOperation({
    toolName: last.name,
    output: last.output,
    state: opts.state,
    tenant: opts.tenant,
    rawUserMessage: opts.rawUserMessage,
  });
  return viaRecent || sync;
}

function candidateSelectionPatchFromToolResult(
  result: ToolExecutionResult,
  call: ToolCallRequest,
  input: AgentTurnInput,
  pendingWrites: ToolCallRequest[] = [],
  pendingReads: ToolCallRequest[] = []
): Partial<import('../conversation-state.ts').ConversationState> | null {
  const output = result.output ?? {};
  if (output.selectionPatch && typeof output.selectionPatch === 'object') {
    return output.selectionPatch as Partial<import('../conversation-state.ts').ConversationState>;
  }
  if (!Array.isArray(output.candidates) || !isRealCandidateAmbiguity(output.candidates)) return null;
  const isAmbiguous =
    output.status === 'ambiguous' ||
    output.errorCode === 'ENTITY_AMBIGUOUS' ||
    (output.status === 'filter_blocked' && output.errorCode === 'ENTITY_AMBIGUOUS');
  if (!isAmbiguous) return null;

  const writePayload = pendingWrites.map((row) => ({
    tool: row.name,
    arguments: row.arguments ?? {},
  }));
  const readPayload = pendingReads
    .filter((row) => row.id !== call.id && row.name !== call.name)
    .map((row) => ({
      tool: row.name,
      arguments: row.arguments ?? {},
    }));

  const payload = ambiguousPayloadFromToolOutput(result.name, output, {
    originalUserText: input.text,
    blockedArgs: call.arguments,
    continuation:
      writePayload.length || readPayload.length
        ? {
            pendingWrites: writePayload.length ? writePayload : undefined,
            pendingReads: readPayload.length ? readPayload : undefined,
          }
        : undefined,
  });
  if (!payload) return null;
  const patch = buildCandidateSelectionState({
    entityType: payload.entityType,
    options: payload.options,
    resume: payload.resume,
  });
  const draft = parseVisualDraft(output.draft);
  if (draft) patch.visualDraft = draft;
  return patch;
}

async function freezeVisualDraftFromToolOutput(
  output: Record<string, unknown>,
  input: AgentTurnInput,
  registry: Awaited<ReturnType<typeof buildToolRegistryForTenant>>
): Promise<AgentTurnResult | null> {
  if (output.status !== 'ready') return null;
  const draft = parseVisualDraft(output.draft);
  if (!draft || !isVisualDraftReadyToWrite(draft)) return null;
  const ctx = {
    tenant: input.tenant,
    state: {
      ...(input.state ?? {
        businessId: input.tenant.businessId,
        phone: input.tenant.phone,
        updatedAt: new Date().toISOString(),
      }),
      visualDraft: draft,
    },
    messageId: input.messageId,
    rawUserMessage: String(input.transcript ?? input.text ?? ''),
  };
  const plan = await prepareWriteToolCalls(
    [{ id: 'visual:prepare', name: 'prepare_visual_draft_write', arguments: { kind: draft.kind } }],
    ctx,
    registry
  );
  plan.summary = visualDraftPlanSummary(draft);
  if (input.messageId) {
    plan.idempotencyKey = `wa:${input.messageId}:${draft.id}:${plan.writes.map((row) => row.tool).join('+')}`;
  }
  const reply = v4OutboundReply(presentConfirmationPlan(plan));
  return {
    reply,
    executed: false,
    intent: 'confirm_v4',
    operationPlan: plan,
    provider: 'openai',
    statePatch: {
      ...confirmationStatePatchFromPlan(plan, ctx.state, reply),
      ...visualDraftConfirmationPatch(plan, draft),
      visualDraft: draft,
    },
  };
}

function cashSelectionPatchFromPrepareError(
  error: unknown,
  userText: string
): {
  reply: string;
  statePatch: Partial<import('../conversation-state.ts').ConversationState>;
  notFound?: boolean;
} | null {
  if (!(error instanceof AgentError)) return null;
  if (error.details?.entityType !== 'cash_account') return null;

  if (error.code === 'ENTITY_NOT_FOUND') {
    return {
      reply: error.message,
      statePatch: {},
      notFound: true,
    };
  }

  if (error.code !== 'ENTITY_AMBIGUOUS') return null;
  const candidates = Array.isArray(error.details?.candidates) ? error.details.candidates : [];
  if (!candidates.length) return null;

  const blockedArgs = (error.details?.blockedArgs ?? {}) as Record<string, unknown>;
  const options = normalizeCandidateRows('cash_account', candidates);
  const title = String(error.message ?? '¿En qué caja?').replace(/\.$/, '');
  return {
    reply: presentNumberedCandidateSelection('cash_account', candidates, title),
    statePatch: buildCandidateSelectionState({
      entityType: 'cash_account',
      options,
      resume: {
        originalUserText: userText,
        blockedTool: String(error.details?.blockedTool ?? 'register_cash_movement'),
        blockedArgs,
      },
    }),
  };
}

async function callOpenAiResponses(input: {
  model: string;
  instructions: string;
  conversationInput: unknown[];
  tools: Array<Record<string, unknown>>;
  timeoutMs?: number;
  attempt?: number;
}): Promise<OpenAiResponsePayload> {
  logOpenAiV4ConfigOnce();
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new AgentError('MODEL_UNAVAILABLE', MODEL_UNAVAILABLE_REPLY);
  }
  const started = Date.now();
  const attempt = input.attempt ?? 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 25000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions,
        input: input.conversationInput,
        tools: input.tools,
        tool_choice: 'auto',
        store: false,
        reasoning: { effort: reasoningEffort() },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponsePayload;
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const parsed = parseOpenAiErrorPayload(payload);
      logOpenAiV4Error({
        model: input.model,
        attempt,
        durationMs,
        httpStatus: response.status,
        payload,
      });
      throw new AgentError('MODEL_UNAVAILABLE', MODEL_UNAVAILABLE_REPLY, {
        httpStatus: response.status,
        errorType: parsed.errorType,
        errorCode: parsed.errorCode,
        errorMessage: parsed.errorMessage,
      });
    }
    console.info(
      '[openai:v4:response]',
      JSON.stringify({
        model: input.model,
        attempt,
        httpStatus: response.status,
        durationMs,
      })
    );
    return payload;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    logOpenAiV4Error({
      model: input.model,
      attempt,
      durationMs: Date.now() - started,
      httpStatus: 0,
      networkError: error,
    });
    throw new AgentError('MODEL_UNAVAILABLE', MODEL_UNAVAILABLE_REPLY);
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOpenAiResponses(input: {
  model: string;
  userText: string;
  tools?: Array<Record<string, unknown>>;
  instructions?: string;
  timeoutMs?: number;
}): Promise<OpenAiProbeResult> {
  logOpenAiV4ConfigOnce();
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) {
    return {
      httpStatus: 0,
      durationMs: 0,
      errorType: 'config',
      errorCode: 'missing_api_key',
      errorMessage: 'OPENAI_API_KEY not set',
    };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 25000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        instructions: input.instructions ?? 'Respondé de forma breve.',
        input: [{ role: 'user', content: input.userText }],
        ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' } : {}),
        store: false,
        reasoning: { effort: reasoningEffort() },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponsePayload;
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const parsed = parseOpenAiErrorPayload(payload);
      logOpenAiV4Error({
        model: input.model,
        attempt: 1,
        durationMs,
        httpStatus: response.status,
        payload,
      });
      return {
        httpStatus: response.status,
        durationMs,
        ...parsed,
      };
    }
    return {
      httpStatus: response.status,
      durationMs,
      outputText: extractAssistantText(payload) || undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    logOpenAiV4Error({
      model: input.model,
      attempt: 1,
      durationMs,
      httpStatus: 0,
      networkError: error,
    });
    return {
      httpStatus: 0,
      durationMs,
      errorType: 'network',
      errorCode: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : 'unknown',
    };
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAIConversationAgent implements ConversationAgent {
  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const started = Date.now();
    const registry = await buildToolRegistryForTenant(input.tenant);
    const tools = openAiToolsFromRegistry(registry);
    const model = readEnvModel(true);
    const fallback = readEnvModel(false);
    const userText = String(input.transcript ?? input.text ?? '').trim();
    const languageMemory = await loadUserLanguageMemory(
      input.tenant.businessId,
      input.tenant.phone
    ).catch(() => ({ aliases: [] }));
    const capabilityBrief = buildCapabilitySnapshotFromRegistry(registry).agentCapabilityBrief;
    let runtimeBrief: string | null = null;
    try {
      const {
        buildBusinessRuntimeContext,
        formatRuntimeContextForAgent,
      } = await import('../business-runtime-context.ts');
      const { productIdFromAccess } = await import('../../../shared/platform-access.ts');
      const runtimeCtx = await buildBusinessRuntimeContext({
        businessId: input.tenant.businessId,
        productId: productIdFromAccess(input.tenant.platformAccess),
      });
      runtimeBrief = formatRuntimeContextForAgent(runtimeCtx);
    } catch (err) {
      console.warn(
        '[whatsapp:v4] runtimeBrief unavailable',
        err instanceof Error ? err.message : err
      );
    }
    const instructions = `${RILOBOT_V4_SYSTEM_INSTRUCTION}\n\n${buildAgentDeveloperContext(input.tenant, input.state, {
      languageMemory,
      capabilityBrief,
      runtimeBrief,
    })}`;
    const conversationInput: unknown[] = [buildOpenAiUserMessage({ text: userText, image: input.image })];
    const allToolCalls: ToolCallRequest[] = [];
    const allToolResults: ToolExecutionResult[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    const hasImage = Boolean(input.image?.buffer?.length);
    const timeoutMs = openAiTimeoutMsForTurn(hasImage);

    console.info(
      '[whatsapp:v4:start]',
      JSON.stringify({
        businessId: input.tenant.businessId,
        provider: 'openai',
        model,
      })
    );

    const ctx = {
      tenant: input.tenant,
      state: input.state,
      messageId: input.messageId,
      rawUserMessage: userText,
      languageMemory,
    };

    for (let round = 0; round < getMaxToolRounds(); round += 1) {
      let payload: OpenAiResponsePayload;
      try {
        payload = await callOpenAiResponses({
          model,
          instructions,
          conversationInput,
          tools,
          timeoutMs,
          attempt: 1,
        });
      } catch (primaryError) {
        if (!fallback || fallback === model) throw primaryError;
        const primaryStatus =
          primaryError instanceof AgentError && primaryError.details?.httpStatus != null
            ? primaryError.details.httpStatus
            : 'unknown';
        console.info(
          '[openai:v4:fallback]',
          JSON.stringify({
            primaryModel: model,
            primaryStatus,
            fallbackModel: fallback,
          })
        );
        try {
          payload = await callOpenAiResponses({
            model: fallback,
            instructions,
            conversationInput,
            tools,
            timeoutMs,
            attempt: 2,
          });
        } catch (fallbackError) {
          const fallbackStatus =
            fallbackError instanceof AgentError && fallbackError.details?.httpStatus != null
              ? fallbackError.details.httpStatus
              : 'unknown';
          console.info(
            '[openai:v4:fallback]',
            JSON.stringify({
              primaryModel: model,
              primaryStatus,
              fallbackModel: fallback,
              fallbackStatus,
            })
          );
          throw fallbackError;
        }
      }

      usage = {
        inputTokens: (usage.inputTokens ?? 0) + Number(payload.usage?.input_tokens ?? 0),
        outputTokens: (usage.outputTokens ?? 0) + Number(payload.usage?.output_tokens ?? 0),
      };

      const calls = extractFunctionCalls(payload);
      if (calls.length) {
        console.info(
          '[openai:v4:tool_call]',
          JSON.stringify(
            calls.map((row) => ({
              name: row.name,
              arguments: row.arguments,
            }))
          )
        );
      }
      if (!calls.length) {
        const text = extractAssistantText(payload);
        const freezeCalls = freezeWriteCallsFromToolResults(allToolResults);
        if (freezeCalls.length) {
          try {
            const plan = await prepareWriteToolCalls(freezeCalls, ctx, registry);
            return {
              ...turnResultFromPreparedPlan(plan, input, {
                toolCalls: allToolCalls,
                toolResults: allToolResults,
                provider: 'openai',
                model,
                latencyMs: Date.now() - started,
                usage,
                contextPatch: buildContextPatchFromToolResults(allToolResults, input.state),
              }),
            };
          } catch (error) {
            console.warn('[v4:freeze-write] prepare failed', error);
            const detail = error instanceof Error ? error.message : 'No pude preparar la modificación.';
            return {
              reply: v4OutboundReply(
                `No pude guardar ese cambio todavía. ${detail}\n\nNo modifiqué nada en el sistema.`
              ),
              executed: false,
              intent: 'v4_write_prepare_failed',
              toolCalls: allToolCalls,
              toolResults: allToolResults,
              provider: 'openai',
              model,
              latencyMs: Date.now() - started,
              usage,
              statePatch: buildStatePatchFromToolResults(allToolResults, input),
            };
          }
        }
        // Nunca reenviar un "renombré/modifiqué" inventado por el LLM sin write ejecutado.
        if (assistantClaimsCompletedMutation(text)) {
          const previewReady = allToolResults.some(
            (row) =>
              row.ok &&
              row.name === 'preview_rename_product' &&
              (row.output?.status === 'ready' || row.output?.freezeWrite)
          );
          return {
            reply: v4OutboundReply(
              previewReady
                ? 'Vi el cambio que querés hacer, pero no quedó guardado todavía. Decime de nuevo cómo querés renombrarlos y lo ejecuto de verdad.'
                : 'No guardé ese cambio todavía. Pedime de nuevo la modificación y la confirmo con el sistema.'
            ),
            executed: false,
            intent: 'v4_write_claim_blocked',
            toolCalls: allToolCalls,
            toolResults: allToolResults,
            provider: 'openai',
            model,
            latencyMs: Date.now() - started,
            usage,
            statePatch: buildStatePatchFromToolResults(allToolResults, input),
          };
        }
        const lastRead = [...allToolResults].reverse().find((row) => row.ok);
        const lookupReply =
          lastRead && (lastRead.name === 'find_order' || lastRead.name === 'get_order')
            ? presentOrderLookupFromToolOutput(lastRead.output)
            : null;
        const deterministic = await deterministicReplyFromToolsAsync(allToolResults, {
          state: input.state,
          tenant: input.tenant,
          rawUserMessage: userText,
        });
        return {
          reply: v4OutboundReply(lookupReply || deterministic || text || 'Listo.'),
          executed: false,
          intent: 'agent_v4',
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          provider: 'openai',
          model,
          latencyMs: Date.now() - started,
          usage,
          statePatch: buildStatePatchFromToolResults(allToolResults, input),
        };
      }

      const writeCalls: ToolCallRequest[] = [];
      for (const item of payload.output ?? []) {
        if (item.type === 'function_call') {
          conversationInput.push(item);
        }
      }
      const batchWriteCalls = calls.filter((call) => getToolByName(call.name, registry)?.mode === 'write');
      const operationContextReads = readToolsAcceptingOperationContext();
      for (const call of calls) {
        allToolCalls.push(call);
        const tool = getToolByName(call.name, registry);
        if (tool?.mode === 'write') {
          writeCalls.push(call);
          continue;
        }
        const readArguments =
          batchWriteCalls.length && operationContextReads.has(call.name)
            ? {
                ...(call.arguments ?? {}),
                operationContext: {
                  pendingWrites: batchWriteCalls.map((row) => ({
                    tool: row.name,
                    arguments: row.arguments ?? {},
                  })),
                },
              }
            : call.arguments;
        const result = await executeReadToolCall(
          { ...call, arguments: readArguments },
          ctx,
          registry
        );
        allToolResults.push(result);
        const selectionPatch = candidateSelectionPatchFromToolResult(
          result,
          call,
          input,
          batchWriteCalls,
          calls.filter((row) => getToolByName(row.name, registry)?.mode === 'read')
        );
        if (selectionPatch) {
          const output = result.output ?? {};
          const entityType =
            output.entityType === 'client' ||
            output.entityType === 'product' ||
            output.entityType === 'supplier' ||
            output.entityType === 'order' ||
            output.entityType === 'cash_account'
              ? output.entityType
              : inferEntityTypeFromTool(result.name);
          const reply =
            replyForCandidateSelectionToolOutput(output, entityType) ||
            deterministicReplyFromTools(allToolResults) ||
            'Indicame qué ítem querés usar, escribime el nombre, o qué querés hacer.';
          return {
            reply: v4OutboundReply(reply),
            executed: false,
            intent: 'candidate_selection_v4',
            toolCalls: allToolCalls,
            toolResults: allToolResults,
            provider: 'openai',
            model,
            latencyMs: Date.now() - started,
            usage,
            statePatch: selectionPatch,
          };
        }
        const frozen = await freezeVisualDraftFromToolOutput(result.output ?? {}, input, registry);
        if (frozen) {
          return {
            ...frozen,
            toolCalls: allToolCalls,
            toolResults: allToolResults,
            model,
            latencyMs: Date.now() - started,
            usage,
          };
        }
        conversationInput.push({
          type: 'function_call_output',
          call_id: call.id,
          output: JSON.stringify(summarizeToolOutput(result.output)),
        });
      }

      if (writeCalls.length) {
        const findResult = [...allToolResults]
          .reverse()
          .find(
            (row) =>
              row.ok &&
              row.output?.status === 'resolved' &&
              row.output?.entity &&
              (row.name === 'find_order' || row.name === 'find_client')
          );
        if (findResult?.output?.status === 'resolved') {
          const compound = await buildCompoundContinuationFromFindOrder({
            tenant: input.tenant,
            state: input.state ?? null,
            findOutput: findResult.output,
            pendingWrites: pendingWritesFromToolCalls(writeCalls),
            rawUserMessage: userText,
            registry,
          });
          if (compound) {
            return {
              reply: v4OutboundReply(compound.reply),
              executed: false,
              intent: compound.plan ? 'confirm_v4' : 'agent_v4',
              operationPlan: compound.plan,
              toolCalls: allToolCalls,
              toolResults: allToolResults,
              provider: 'openai',
              model,
              latencyMs: Date.now() - started,
              usage,
              statePatch: {
                ...buildContextPatchFromToolResults(allToolResults, input.state),
                ...compound.statePatch,
              },
            };
          }
        }

        let plan;
        try {
          plan = await prepareWriteToolCalls(writeCalls, ctx, registry);
        } catch (error) {
          const cashSelection = cashSelectionPatchFromPrepareError(error, userText);
          if (cashSelection) {
            return {
              reply: cashSelection.reply,
              executed: false,
              intent: cashSelection.notFound ? 'cash_not_found_v4' : 'candidate_selection_v4',
              toolCalls: allToolCalls,
              toolResults: allToolResults,
              provider: 'openai',
              model,
              latencyMs: Date.now() - started,
              usage,
              statePatch: cashSelection.statePatch,
            };
          }
          // Validación de args (ej. type faltante): devolver al modelo para que corrija
          // en el mismo turno en vez de preguntarle al usuario algo que ya dijo.
          if (!(error instanceof AgentError) && round < getMaxToolRounds() - 1) {
            const detail = error instanceof Error ? error.message : 'No pude preparar la operación.';
            for (const call of writeCalls) {
              conversationInput.push({
                type: 'function_call_output',
                call_id: call.id,
                output: JSON.stringify({
                  ok: false,
                  error: detail,
                  retryHint:
                    'Corregí los argumentos y volvé a llamar la misma write tool. Si el usuario ya dijo ingreso/egreso, monto, motivo y caja, completá type ("ingreso"|"egreso"), amount, concept y cashAccountHint. No le preguntes de nuevo lo que ya está en el mensaje o en recentTurns.',
                }),
              });
              allToolResults.push({
                toolCallId: call.id,
                name: call.name,
                ok: false,
                output: { error: detail },
                errorCode: 'DOMAIN_VALIDATION_ERROR',
              });
            }
            console.warn(
              '[openai:v4:write_prepare_retry]',
              JSON.stringify({
                tools: writeCalls.map((row) => row.name),
                detail,
                round,
              })
            );
            continue;
          }
          throw error;
        }
        return turnResultFromPreparedPlan(plan, input, {
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          provider: 'openai',
          model,
          latencyMs: Date.now() - started,
          usage,
          contextPatch: buildContextPatchFromToolResults(allToolResults, input.state),
        });
      }
    }

    throw new AgentError('TOOL_LOOP_LIMIT', 'Necesité demasiados pasos para responder eso. Probá más específico.');
  }
}

function buildStatePatchFromToolResults(
  results: ToolExecutionResult[],
  input: AgentTurnInput
): Partial<import('../conversation-state.ts').ConversationState> {
  const patch: Partial<import('../conversation-state.ts').ConversationState> = {
    ...buildContextPatchFromToolResults(results, input.state),
  };

  const listOrders = results.find((row) => row.name === 'list_orders' && row.ok);
  if (listOrders) {
    const output = listOrders.output;
    const filter = (output.filter ?? {}) as { clientId?: string; clientName?: string; status?: string };
    patch.lastQuery = {
      intent: 'query_orders',
      slots: {
        clientName: filter.clientName,
        entity: 'orders',
        metric: output.mode === 'count' ? 'count' : 'list',
        status: filter.status,
        limit: Array.isArray(output.items) ? output.items.length : undefined,
        offset: Number(output.nextOffset) || 0,
      },
    };
    if (filter.clientId || filter.clientName) {
      patch.focusEntities = {
        ...(patch.focusEntities ?? input.state?.focusEntities ?? {}),
        client: {
          id: filter.clientId,
          name: filter.clientName,
          locked: true,
        },
      };
    }
    if (Array.isArray(output.items) && output.items.length) {
      patch.listContext = {
        type: 'orders',
        items: output.items.map((row) => String((row as { number?: string }).number ?? '')),
        currentPage: 1,
        pageSize: output.items.length,
        totalResults: Number(output.total) || output.items.length,
        hasMore: output.hasMore === true,
        offset: Number(output.nextOffset) || 0,
        clientId: filter.clientId,
        filters: patch.lastQuery?.slots,
        title: filter.clientName ? `Pedidos de ${filter.clientName}` : 'Pedidos',
      };
    }
  }

  const clientBalance = results.find((row) => row.name === 'get_client_balance' && row.ok);
  if (clientBalance) {
    const output = clientBalance.output;
    const clientId = String(output.clientId ?? '').trim();
    const clientName = String(output.clientName ?? '').trim();
    patch.lastQuery = {
      intent: 'query_balance',
      slots: {
        clientName: clientName || undefined,
        entity: 'client',
        metric: 'balance',
      },
    };
    if (clientId || clientName) {
      patch.focusEntities = {
        ...(patch.focusEntities ?? input.state?.focusEntities ?? {}),
        client: {
          id: clientId || undefined,
          name: clientName || undefined,
          locked: true,
        },
      };
    }
  }

  const findOrder = [...results].reverse().find(
    (row) => (row.name === 'find_order' || row.name === 'get_order') && row.ok
  );
  if (findOrder) {
    const output = findOrder.output;
    const entity = (output.entity ?? {}) as Record<string, unknown>;
    const filter = (output.filter ?? {}) as { clientId?: string; clientName?: string };
    patch.lastQuery = {
      intent: 'query_order',
      slots: {
        clientName: String(entity.clientName ?? output.clientName ?? filter.clientName ?? '') || undefined,
        orderNumber: String(output.orderReferenceNormalized ?? entity.number ?? '') || undefined,
        entity: 'order',
        metric: 'details',
      },
    };
    if (output.status !== 'resolved' && (filter.clientId || output.clientId || filter.clientName || output.clientName)) {
      patch.focusEntities = {
        ...(patch.focusEntities ?? input.state?.focusEntities ?? {}),
        client: {
          id: String(output.clientId ?? filter.clientId ?? ''),
          name: String(output.clientName ?? filter.clientName ?? ''),
          locked: true,
        },
      };
    }
  }

  const cash = results.find((row) => row.name === 'get_cash_balance' && row.ok);
  if (cash) {
    patch.lastQuery = { intent: 'query_cash', slots: { entity: 'cash', metric: 'balance' } };
  }
  const visual = [...results].reverse().find(
    (row) => (row.name === 'ingest_visual_document' || row.name === 'patch_visual_draft') && row.ok
  );
  if (visual) {
    const draft = parseVisualDraft(visual.output.draft);
    if (draft) patch.visualDraft = draft;
  }
  const workflow = [...results].reverse().find((row) => row.name === 'manage_workflow' && row.ok);
  if (workflow?.output?.statePatch && typeof workflow.output.statePatch === 'object') {
    Object.assign(patch, workflow.output.statePatch as Partial<import('../conversation-state.ts').ConversationState>);
  }
  const guide = [...results].reverse().find((row) => row.name === 'show_bot_guide' && row.ok);
  if (guide?.output?.statePatch && typeof guide.output.statePatch === 'object') {
    Object.assign(patch, guide.output.statePatch as Partial<import('../conversation-state.ts').ConversationState>);
  }
  return patch;
}

export class MockConversationAgent implements ConversationAgent {
  constructor(private readonly steps: Array<(input: AgentTurnInput) => ToolCallRequest[] | string>) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const registry = await buildToolRegistryForTenant(input.tenant);
    const step = this.steps.shift();
    if (!step) {
      return { reply: 'mock empty', executed: false, intent: 'agent_v4_mock' };
    }
    const result = step(input);
    if (typeof result === 'string') {
      return { reply: v4OutboundReply(result), executed: false, intent: 'agent_v4_mock', provider: 'mock', model: 'mock' };
    }
    const ctx = {
      tenant: input.tenant,
      state: input.state,
      messageId: input.messageId,
      rawUserMessage: input.text,
    };
    const toolResults: ToolExecutionResult[] = [];
    for (const call of result) {
      toolResults.push(await executeReadToolCall(call, ctx, registry));
    }
    const reply = deterministicReplyFromTools(toolResults) ?? 'mock';
    return {
      reply,
      executed: false,
      intent: 'agent_v4_mock',
      toolCalls: result,
      toolResults,
      provider: 'mock',
      model: 'mock',
      statePatch: buildStatePatchFromToolResults(toolResults, input),
    };
  }
}
