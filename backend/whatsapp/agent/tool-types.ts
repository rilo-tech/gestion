import type { AssignablePermission } from '../../../auth/constants.ts';
import type { SubscriptionModuleId } from '../../../shared/subscription-modules.ts';
import type { ConversationState } from '../conversation-state.ts';
import type { WhatsappTenantContext } from '../tenant-resolver.ts';

export type ToolMode = 'read' | 'write';

export type ToolRisk = 'low' | 'sensitive';

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mode: ToolMode;
  /** Id de capability del Agent (mapea a feature de plan vía tool-feature-map). */
  capability: string;
  /** Entidad de dominio (product, client, …). Se puede inferir del capability. */
  entity?: string;
  /** Riesgo operativo: low = EXECUTE_DIRECTLY; sensitive = NEEDS_CONFIRMATION. */
  risk?: ToolRisk;
  /** Feature de BusinessProfile / entitlements asociada. */
  feature?: string;
  permission?: 'read' | 'write';
  requiredModule?: SubscriptionModuleId;
  accessPermission?: AssignablePermission;
  requiresTeamManage?: boolean;
  requiresHoursWrite?: boolean;
  requiresPaymentWrite?: boolean;
  /** Si true, no se expone al Agent hasta tener adaptador completo. */
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
  summaryTitle?: string;
  summaryLines?: string[];
};

export type AgentOperationPlan = {
  version: 'v4';
  planId?: string;
  planVersion?: number;
  supersedesPlanId?: string;
  status?: 'awaiting_confirmation' | 'superseded' | 'executed' | 'cancelled';
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
  image?: { buffer: Buffer; contentType: string } | null;
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
  /** Memoria de expresiones confirmadas del usuario (aliases). */
  languageMemory?: import('../language-memory.ts').UserLanguageMemory | null;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
) => Promise<Record<string, unknown>>;

export type ToolRegistryEntry = ToolDefinition & {
  execute?: ToolHandler;
  prepare?: ToolHandler;
};
