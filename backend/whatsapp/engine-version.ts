export type ConversationEngineVersion = 'legacy' | 'llm_first' | 'v3' | 'v4';

/**
 * Motor conversacional. Default: llm_first.
 * RILOBOT_CONVERSATION_ENGINE=legacy restaura routing/regex previo.
 * RILOBOT_CONVERSATION_ENGINE=v3 activa el core v3 globalmente.
 * RILOBOT_CONVERSATION_ENGINE=v4 activa Conversation Agent V4 (tool calling).
 * RILOBOT_V3_TENANTS=rilo activa v3 solo en esos businessId.
 * RILOBOT_V4_TENANTS=rilo activa v4 solo en esos businessId.
 */
export function conversationEngineVersion(
  override?: ConversationEngineVersion | string | null
): ConversationEngineVersion {
  const raw = String(override ?? process.env.RILOBOT_CONVERSATION_ENGINE ?? 'llm_first')
    .trim()
    .toLowerCase();
  if (raw === 'legacy' || raw === 'v1') return 'legacy';
  if (raw === 'v4') return 'v4';
  if (raw === 'v3') return 'v3';
  return 'llm_first';
}

export function isLlmFirstEngine(override?: ConversationEngineVersion | string | null): boolean {
  const v = conversationEngineVersion(override);
  return v === 'llm_first' || v === 'v3';
}

export function isV3Engine(businessId?: string | null, override?: string | null): boolean {
  if (isV4Engine(businessId, override)) return false;
  const tenants = String(process.env.RILOBOT_V3_TENANTS ?? '')
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
  if (businessId && tenants.includes(businessId)) return true;
  return conversationEngineVersion(override) === 'v3';
}

export function isV4Engine(businessId?: string | null, override?: string | null): boolean {
  const tenants = String(process.env.RILOBOT_V4_TENANTS ?? '')
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
  if (businessId && tenants.includes(businessId)) return true;
  return conversationEngineVersion(override) === 'v4';
}
