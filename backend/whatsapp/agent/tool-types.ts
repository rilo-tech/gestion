import type { ConversationState } from '../conversation-state.ts';
import type { WhatsappTenantContext } from '../tenant-resolver.ts';

export type ToolMode = 'read' | 'write';

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mode: ToolMode;
  capability: string;
  permission?: 'read' | 'write';
  requiresDomainAdapter?: boolean;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolExecutionResult = {
  toolCallId: string;
  name: string;
  ok: boolean;
  output: Record<string, unknown>;
  errorCode?: string;
};

export type AgentPlannedWrite = {
  tool: string;
  args: Record<string, unknown>;
  label: string;
};

export type AgentOperationPlan = {
  version: 'v4';
  writes: AgentPlannedWrite[];
  summary: { title: string; lines: string[] };
  rawUserMessage: string;
  idempotencyKey?: string;
};

export type AgentTurnInput = {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  text: string;
  messageId?: string | null;
  transcript?: string | null;
  imageSummary?: string | null;
  nowIso?: string;
};

export type AgentTurnResult = {
  reply: string;
  executed: boolean;
  intent: string;
  statePatch?: Partial<ConversationState>;
  toolCalls?: ToolCallRequest[];
  toolResults?: ToolExecutionResult[];
  operationPlan?: AgentOperationPlan | null;
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export interface ConversationAgent {
  runTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
}

export type ToolExecutionContext = {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  messageId?: string | null;
  rawUserMessage: string;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
) => Promise<Record<string, unknown>>;

export type ToolRegistryEntry = ToolDefinition & {
  execute?: ToolHandler;
  prepare?: ToolHandler;
};
