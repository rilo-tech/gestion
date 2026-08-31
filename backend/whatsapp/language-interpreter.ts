import { generateInterpreterJson, type GeminiPart } from './gemini.ts';
import type { WhatsappParseInput } from './ai-command-parser.ts';
import {
  GEMINI_TURN_SCHEMA_V2,
  isValidTurnInterpretationJson,
  normalizeTurnInterpretation,
  type TurnInterpretation,
} from './turn-interpretation.ts';
import { formatLanguageMemoryPrompt } from './language-memory.ts';
import { formatOperatorMemoryPrompt, loadOperatorMemory } from './operator-memory.ts';
import { calendarDayAr } from './semantic-command.ts';
import { formatAvailableCapabilitiesPrompt } from './capability-registry.ts';

export interface LanguageInterpreter {
  interpretTurn(input: WhatsappParseInput): Promise<TurnInterpretation>;
}

export const RILOBOT_SYSTEM_INSTRUCTION = `Eres el intérprete conversacional de RiloBot (ERP por WhatsApp).

Interpretá español natural (rioplatense, typos, varias instrucciones). Usá el mensaje y el contexto.

Separá: crear vs consultar vs modificar vs corregir vs cancelar vs confirmar vs how_to.
Pago no es estado. Consultar no es crear. How_to no ejecuta. «ese/el último/el segundo» usa focusEntities / lastQuery / lastCompleted, no inventes ids.

Consultas: query.entity + query.metric (list|count|sum|status|balance|details|stock|verify) + query.filters (clientHint, status, dateToken/dateFrom/dateTo, dateField). query.limit solo si el usuario dijo una cantidad. query.requestAll si pidió todos. query.page=next si pide la siguiente página. No asumas estado ni fecha.

Acciones de escritura: create_order, create_sale, create_purchase, create_client, register_cash (cash.type ingreso|egreso, amount, concept, scope/ambitoHint, date), register_payment (kind senia|pago, amount o fullBalance), update_order_status (requestedStatus), register_cost, update_product_cost.

Varias instrucciones → operations[] extra, cada una con su payload. Correcciones → conversationAction=correct_current, mismo itemKey, solo el campo cambiado.

Si falta certeza de intent pero hay estructura (cash, query, items, payment, requestedStatus, client, filters), rellená esos campos. No uses unknown para borrar trabajo. Si la operación no está en available capabilities, igual identificá intent/requestedCapability; no lo conviertas en unknown.

No inventes clientId, productId, orderId, saldos ni stock. Devolvé solo el structured output.`;

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function buildTurnContextPrompt(input: WhatsappParseInput): string {
  const conversation = input.conversation;
  const thread = (conversation?.turns ?? [])
    .filter((turn) => String(turn.text ?? '').trim())
    .slice(-6)
    .map((turn) => `${turn.role === 'bot' ? 'bot' : 'dueño'}: ${String(turn.text).slice(0, 280)}`)
    .join('\n');
  const focus = conversation?.focusOrder;
  const last = conversation?.lastOperation;
  const product = conversation?.focusEntities?.product;
  const products = conversation?.focusEntities?.products ?? [];
  const lastQuery = conversation?.lastQuery;
  const lines = [
    'CONTEXTO DEL TURNO',
    `hoy: ${calendarDayAr()} (UTC-3; usá esta fecha para ayer/mañana/pasado mañana)`,
    `mensaje: ${JSON.stringify(input.text.trim() || '(sin texto)')}`,
    conversation?.awaiting ? `awaiting: ${conversation.awaiting}` : '',
    conversation?.pendingIntent ? `pendingIntent: ${conversation.pendingIntent}` : '',
    conversation?.pendingPrompt
      ? `lastQuestion: ${String(conversation.pendingPrompt).slice(0, 280)}`
      : '',
    conversation?.originalIntent ? `originalIntent: ${conversation.originalIntent}` : '',
    focus?.id
      ? `focusOrder: #${focus.label || ''} ${focus.clientName || ''} id=${focus.id} estado=${focus.status || ''}`
      : '',
    product?.id || product?.name
      ? `focusProduct: ${product.name || ''} id=${product.id || ''}`
      : '',
    products.length > 1
      ? `focusProducts: ${products.map((row) => row.name || row.id).filter(Boolean).join(' · ')}`
      : '',
    lastQuery?.intent
      ? `lastQuery: ${lastQuery.intent} ${compactJson(lastQuery.slots)}`
      : '',
    last?.id
      ? `lastCompleted: ${last.kind || ''} #${last.label || ''} ${last.clientName || ''} ${last.status || ''}`
      : '',
    conversation?.knownEntities
      ? `knownEntities: ${compactJson({
          clientName: conversation.knownEntities.clientName,
          items: conversation.knownEntities.items,
          amount: conversation.knownEntities.amount,
          notes: conversation.knownEntities.notes,
          deliveryDate: conversation.knownEntities.deliveryDate,
          orderStatus: conversation.knownEntities.orderStatus,
          requestedStatus: conversation.knownEntities.requestedStatus,
          targetOrderId: conversation.knownEntities.targetOrderId,
          paid: conversation.knownEntities.paid,
          cashType: conversation.knownEntities.cashType,
          cashConcept: conversation.knownEntities.cashConcept,
          cashAmbitoHint: conversation.knownEntities.cashAmbitoHint,
        })}`
      : '',
    formatAvailableCapabilitiesPrompt(),
    conversation?.candidates?.length
      ? `candidates: ${conversation.candidates.map((row) => `${row.index}) ${row.label}`).join(' · ')}`
      : '',
    conversation?.missingKeys?.length ? `missingFields: ${conversation.missingKeys.join(', ')}` : '',
    thread ? `turns:\n${thread}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export class GeminiInterpreter implements LanguageInterpreter {
  async interpretTurn(input: WhatsappParseInput): Promise<TurnInterpretation> {
    const rawMessage = String(input.text ?? '').trim();
    const hasAudio = Boolean(input.audio?.buffer?.length);
    const hasImage = Boolean(input.image?.buffer?.length);
    let memory = '';
    if (input.businessId) {
      try {
        memory = formatOperatorMemoryPrompt(await loadOperatorMemory(input.businessId));
      } catch (error) {
        console.warn('[whatsapp] operator memory load failed:', error);
      }
    }
    if (input.conversation?.languageMemory) {
      const spoken = formatLanguageMemoryPrompt(input.conversation.languageMemory);
      if (spoken) memory = [memory, spoken].filter(Boolean).join('\n');
    }

    const userText = [buildTurnContextPrompt(input), memory].filter(Boolean).join('\n\n');
    const schemaChars = JSON.stringify(GEMINI_TURN_SCHEMA_V2).length;
    const systemChars = RILOBOT_SYSTEM_INSTRUCTION.length;
    const userChars = userText.length;
    const totalChars = systemChars + schemaChars + userChars;
    console.info(
      '[whatsapp:interpreter:input]',
      JSON.stringify({
        systemChars,
        schemaChars,
        contextChars: userChars,
        messageChars: rawMessage.length,
        totalChars,
        approxTokens: Math.max(1, Math.round(totalChars / 4)),
      })
    );
    const parts: GeminiPart[] = [{ text: userText || `mensaje: ${JSON.stringify(rawMessage)}` }];
    if (input.image?.buffer?.length) {
      parts.push({
        inlineData: {
          mimeType: input.image.contentType.startsWith('image/') ? input.image.contentType : 'image/jpeg',
          data: input.image.buffer.toString('base64'),
        },
      });
    }
    if (input.audio?.buffer?.length) {
      parts.push({
        inlineData: {
          mimeType: input.audio.contentType || 'audio/ogg',
          data: input.audio.buffer.toString('base64'),
        },
      });
    }

    const result = await generateInterpreterJson({
      parts,
      label: 'rilobot-interpreter',
      businessId: input.businessId,
      tool: 'parser',
      responseSchema: GEMINI_TURN_SCHEMA_V2 as unknown as Record<string, unknown>,
      systemInstruction: RILOBOT_SYSTEM_INSTRUCTION,
      validate: isValidTurnInterpretationJson,
    });

    if (!result.json) {
      return {
        intent: 'interpreter_unavailable',
        confidence: 0,
        conversationAction: 'new_task',
        rawMessage,
        requiresClarification: false,
        interpreterFailure: result.failure,
      };
    }
    const normalized = normalizeTurnInterpretation(
      result.json,
      rawMessage || String(result.json.transcript ?? '')
    );
    return normalized;
  }
}

export class OpenAIInterpreter implements LanguageInterpreter {
  /**
   * @deprecated Legacy V2 intent classifier stub. V4 usa OpenAIConversationAgent (tool calling).
   * No usar con RILOBOT_CONVERSATION_ENGINE=v4.
   */
  async interpretTurn(input: WhatsappParseInput): Promise<TurnInterpretation> {
    const rawMessage = String(input.text ?? '').trim();
    return {
      intent: 'unknown',
      confidence: 0,
      conversationAction: 'new_task',
      rawMessage,
      requiresClarification: true,
      clarificationReason: 'openai_interpreter_legacy_not_used_by_v4',
    };
  }
}

export type InterpreterProvider = 'gemini' | 'openai';

export function createLanguageInterpreter(
  provider: InterpreterProvider | LanguageInterpreter = 'gemini'
): LanguageInterpreter {
  if (typeof provider !== 'string') return provider;
  if (provider === 'openai') return new OpenAIInterpreter();
  return new GeminiInterpreter();
}

let activeInterpreter: LanguageInterpreter | null = null;

export function setLanguageInterpreter(interpreter: LanguageInterpreter | null): void {
  activeInterpreter = interpreter;
}

export function getLanguageInterpreter(): LanguageInterpreter {
  return activeInterpreter ?? createLanguageInterpreter('gemini');
}
