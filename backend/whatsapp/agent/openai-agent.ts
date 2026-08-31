import { AgentError, MODEL_UNAVAILABLE_REPLY } from './agent-errors.ts';
import { buildAgentDeveloperContext, RILOBOT_V4_SYSTEM_INSTRUCTION } from './agent-context.ts';
import {
  presentCashBalance,
  presentClientList,
  presentConfirmationPlan,
  presentOrderBalance,
  presentOrderListFromToolOutput,
  presentStock,
} from './agent-presenter.ts';
import { buildToolRegistry, getToolByName, openAiToolsFromRegistry } from './tool-registry.ts';
import {
  executeReadToolCall,
  getMaxToolRounds,
  prepareWriteToolCalls,
  summarizeToolOutput,
} from './tool-executor.ts';
import type {
  AgentTurnInput,
  AgentTurnResult,
  ConversationAgent,
  ToolCallRequest,
  ToolExecutionResult,
} from './tool-types.ts';

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

function deterministicReplyFromTools(results: ToolExecutionResult[]): string | null {
  const last = [...results].reverse().find((row) => row.ok);
  if (!last) return null;
  if (last.name === 'list_orders') return presentOrderListFromToolOutput(last.output);
  if (last.name === 'get_cash_balance') return presentCashBalance(last.output);
  if (last.name === 'list_clients') return presentClientList(last.output);
  if (last.name === 'get_order_balance') return presentOrderBalance(last.output);
  if (last.name === 'get_stock') return presentStock(last.output);
  if (last.output.status === 'filter_blocked') return String(last.output.message ?? '');
  if (last.output.status === 'not_found' && last.output.query) {
    return `No encontré ${String(last.output.query)}.`;
  }
  if (last.output.status === 'ambiguous' && Array.isArray(last.output.candidates)) {
    const names = last.output.candidates
      .slice(0, 5)
      .map((row) => `• ${String((row as { name?: string }).name ?? '')}`)
      .join('\n');
    return `Encontré más de una opción:\n${names}\nDecime cuál.`;
  }
  return null;
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
    const registry = buildToolRegistry();
    const tools = openAiToolsFromRegistry(registry);
    const model = readEnvModel(true);
    const fallback = readEnvModel(false);
    const userText = String(input.transcript ?? input.text ?? '').trim();
    const instructions = `${RILOBOT_V4_SYSTEM_INSTRUCTION}\n\n${buildAgentDeveloperContext(input.tenant, input.state)}`;
    const conversationInput: unknown[] = [{ role: 'user', content: userText }];
    const allToolCalls: ToolCallRequest[] = [];
    const allToolResults: ToolExecutionResult[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };

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
    };

    for (let round = 0; round < getMaxToolRounds(); round += 1) {
      let payload: OpenAiResponsePayload;
      try {
        payload = await callOpenAiResponses({
          model,
          instructions,
          conversationInput,
          tools,
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
      if (!calls.length) {
        const text = extractAssistantText(payload);
        const deterministic = deterministicReplyFromTools(allToolResults);
        return {
          reply: text || deterministic || 'Listo.',
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
      for (const call of calls) {
        allToolCalls.push(call);
        const tool = getToolByName(call.name, registry);
        if (tool?.mode === 'write') {
          writeCalls.push(call);
          continue;
        }
        const result = await executeReadToolCall(call, ctx, registry);
        allToolResults.push(result);
        conversationInput.push({
          type: 'function_call_output',
          call_id: call.id,
          output: JSON.stringify(summarizeToolOutput(result.output)),
        });
      }

      if (writeCalls.length) {
        const plan = await prepareWriteToolCalls(writeCalls, ctx, registry);
        return {
          reply: presentConfirmationPlan(plan),
          executed: false,
          intent: 'confirm_v4',
          operationPlan: plan,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          provider: 'openai',
          model,
          latencyMs: Date.now() - started,
          usage,
          statePatch: {
            pendingIntent: 'confirm:v4_write',
            pendingPayload: { plan },
            pendingPrompt: presentConfirmationPlan(plan),
            operationPlan: plan as unknown as Record<string, unknown>,
            activeTask: {
              intent: 'confirm_v4',
              awaiting: { field: 'confirmation', type: 'confirm' },
            },
          },
        };
      }
    }

    throw new AgentError('TOOL_LOOP_LIMIT', 'Necesité demasiados pasos para responder eso. Probá más específico.');
  }
}

function buildStatePatchFromToolResults(
  results: ToolExecutionResult[],
  input: AgentTurnInput
): Partial<import('../conversation-state.ts').ConversationState> {
  const patch: Partial<import('../conversation-state.ts').ConversationState> = {};
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
        ...(input.state?.focusEntities ?? {}),
        client: {
          id: filter.clientId,
          name: filter.clientName,
          locked: true,
        },
      };
    }
    if (Array.isArray(output.items) && output.items.length) {
      const first = output.items[0] as Record<string, unknown>;
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
      patch.focusOrder = {
        id: String(first.id ?? ''),
        label: String(first.number ?? ''),
        clientName: String(first.clientName ?? filter.clientName ?? ''),
        clientId: String(first.clientId ?? filter.clientId ?? ''),
        status: String(first.status ?? ''),
        at: new Date().toISOString(),
      };
    }
  }
  const cash = results.find((row) => row.name === 'get_cash_balance' && row.ok);
  if (cash) {
    patch.lastQuery = { intent: 'query_cash', slots: { entity: 'cash', metric: 'balance' } };
  }
  return patch;
}

export class MockConversationAgent implements ConversationAgent {
  constructor(private readonly steps: Array<(input: AgentTurnInput) => ToolCallRequest[] | string>) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const registry = buildToolRegistry();
    const step = this.steps.shift();
    if (!step) {
      return { reply: 'mock empty', executed: false, intent: 'agent_v4_mock' };
    }
    const result = step(input);
    if (typeof result === 'string') {
      return { reply: result, executed: false, intent: 'agent_v4_mock', provider: 'mock', model: 'mock' };
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
