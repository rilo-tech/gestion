/**
 * Motor conversacional.
 *
 * v2 (default, llm_first): LanguageInterpreter → TurnInterpretation → orchestrator-v2.
 * v3 (RILOBOT_V3_TENANTS / RILOBOT_CONVERSATION_ENGINE=v3): QueryPlan + entity resolver
 *   sobre los mismos Query Services. No reinterpreta español después de Gemini.
 * legacy: parseWithRules + Gemini merge (RILOBOT_CONVERSATION_ENGINE=legacy)
 */
import type { WhatsappCommandEntities, WhatsappParseInput, ParsedWhatsappCommand } from './ai-command-parser.ts';
import { parseWhatsappCommand } from './ai-command-parser.ts';
import { classifyConfirmReply } from './turn-interpreter.ts';
import { logWhatsappTurn } from './conversation-log.ts';

export const DATA_SOURCES = [
  'user_explicit',
  'user_correction',
  'conversation_context',
  'user_memory',
  'erp_resolver',
  'business_default',
] as const;

export type DataSource = (typeof DATA_SOURCES)[number];

export type FieldProvenance = {
  value: unknown;
  source: DataSource;
  sourceTurnId?: string;
  sourceSpan?: string;
};

const SOURCE_PRIORITY: Record<DataSource, number> = {
  user_correction: 6,
  user_explicit: 5,
  conversation_context: 4,
  user_memory: 3,
  erp_resolver: 2,
  business_default: 1,
};

export function sourceOutranks(next: DataSource, current?: DataSource | null): boolean {
  if (!current) return true;
  return SOURCE_PRIORITY[next] >= SOURCE_PRIORITY[current];
}

/** El texto del usuario es evidencia inmutable. Nunca se reescribe. */
export function freezeRawMessage(text: unknown): string {
  return String(text ?? '');
}

export function attachRawMessage(
  entities: WhatsappCommandEntities,
  raw: string
): WhatsappCommandEntities {
  const frozen = freezeRawMessage(raw);
  if (!entities.rawUserMessage) entities.rawUserMessage = frozen;
  if (!entities.sourceText) entities.sourceText = frozen;
  return entities;
}

/** SÍ / NO exactos, sin más contenido. Cualquier cola pasa por Gemini. */
export function isBareDeterministicReply(text: string): 'confirm' | 'cancel' | null {
  const kind = classifyConfirmReply(text);
  if (kind === 'confirm' || kind === 'cancel') return kind;
  return null;
}

export function utteranceGoesBeyondSlot(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (isBareDeterministicReply(t)) return false;
  return /(?<![\p{L}])(?:move|movelo|p[oó]nelo|p[aá]salo|dejalo|cambial|dise[nñ]o|listo|entregado|pag(?:o|ado)|cobr)(?![\p{L}])/iu.test(
    t
  );
}

/**
 * Punto único de interpretación semántica.
 * Gemini ve el mensaje completo + ConversationState. El backend no reinterpreta.
 */
export async function interpretTurn(input: string | WhatsappParseInput): Promise<ParsedWhatsappCommand> {
  const normalized: WhatsappParseInput = typeof input === 'string' ? { text: input } : input;
  const rawUserMessage = freezeRawMessage(normalized.text);
  const parsed = await parseWhatsappCommand({ ...normalized, text: rawUserMessage });
  if ('entities' in parsed && parsed.entities) {
    attachRawMessage(parsed.entities, rawUserMessage || String('raw' in parsed ? parsed.raw ?? '' : ''));
  }
  logWhatsappTurn({
    rawMessage: rawUserMessage,
    parsedIntent: parsed.intent,
    intent: parsed.intent,
    conversationAction: parsed.conversationAction,
    confidence: parsed.confidence,
    itemQueries: 'entities' in parsed ? parsed.entities?.items?.map((item) => item.rawText) : undefined,
    productParserExecuted:
      'entities' in parsed &&
      Boolean(parsed.entities?.productName || parsed.entities?.items?.length),
    whyFallbackWasUsed: parsed.intent === 'unknown' ? 'no_confident_intent' : null,
    classifiedConversationAction: parsed.conversationAction,
  });
  return parsed;
}
