import { classifyConfirmReply } from './turn-interpreter.ts';
import type { ConversationState } from './conversation-state.ts';
import type { ParsedWhatsappCommand, WhatsappParseInput } from './ai-command-parser.ts';
import { getLanguageInterpreter } from './language-interpreter.ts';
import {
  overlayKnownEntities,
  turnInterpretationToParsed,
  type TurnInterpretation,
} from './turn-interpretation.ts';
import { logWhatsappTurn } from './conversation-log.ts';
import { freezeRawMessage } from './conversation-engine.ts';
import {
  logSemanticDrift,
  meaningEquivalent,
  resolveSemanticTurn,
  semanticCommandToLegacyEntities,
  shouldClearPendingForCommand,
  snapshotFromCommand,
  snapshotFromInterpretation,
  snapshotFromPlan,
} from './semantic-command.ts';
import { isInterpreterTechnicalFailure } from './interpreter-availability.ts';
import { buildOperationPlanFromCommand } from './operation-plan.ts';

const CONFIRM_PREFIX = 'confirm:';

export type DeterministicBypass =
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'choice'; index: number };

/** SÍ/NO exacto sobre un plan, o un número exacto sobre una lista ya mostrada. */
export function matchDeterministicBypass(
  text: string,
  state: ConversationState | null | undefined
): DeterministicBypass | null {
  const t = String(text ?? '').trim();
  if (!t || !state?.pendingIntent) return null;
  const pending = String(state.pendingIntent);
  if (pending.startsWith(CONFIRM_PREFIX) || pending === 'settle_order') {
    const kind = classifyConfirmReply(t);
    if (kind === 'confirm') return { kind: 'confirm' };
    if (kind === 'cancel') return { kind: 'cancel' };
    return null;
  }
  if (
    pending.startsWith('select_') ||
    pending === 'order_action' ||
    pending === 'select_payment_kind' ||
    pending === 'select_order'
  ) {
    if (/^\d{1,2}$/.test(t)) {
      const index = Number(t);
      if (index >= 1 && index <= 99) return { kind: 'choice', index };
    }
  }
  return null;
}

/** Onboarding/help: solo SÍ/NO o un dígito, sin semántica extra. */
export function isUnequivocalUiReply(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^\d{1,2}$/.test(t)) return true;
  const kind = classifyConfirmReply(t);
  return kind === 'confirm' || kind === 'cancel';
}

export function shouldClearPendingForTurn(interpretation: TurnInterpretation): boolean {
  return interpretation.conversationAction === 'new_task' && interpretation.intent !== 'unknown';
}

export async function interpretLlmFirstTurn(input: WhatsappParseInput): Promise<{
  interpretation: TurnInterpretation;
  parsed: ParsedWhatsappCommand;
  clearPending: boolean;
  resolved?: ReturnType<typeof resolveSemanticTurn>;
}> {
  const rawMessage = freezeRawMessage(input.text);
  const interpretation = await getLanguageInterpreter().interpretTurn({ ...input, text: rawMessage });
  interpretation.rawMessage = interpretation.rawMessage || rawMessage;

  if (isInterpreterTechnicalFailure(interpretation.interpreterFailure)) {
    logWhatsappTurn({
      rawMessage,
      parsedIntent: 'interpreter_unavailable',
      intent: 'interpreter_unavailable',
      conversationAction: 'new_task',
      classifiedConversationAction: 'new_task',
      confidence: 0,
      productParserExecuted: false,
      whyFallbackWasUsed: interpretation.interpreterFailure?.kind ?? 'INTERPRETER_UNAVAILABLE',
      llmOutput: JSON.stringify(interpretation.interpreterFailure).slice(0, 400),
      engine: 'llm_first',
      finalOperationPlan: 'interpreter_unavailable',
    });
    return {
      interpretation,
      parsed: {
        intent: 'interpreter_unavailable',
        confidence: 0,
        raw: rawMessage,
        entities: { sourceText: rawMessage, rawUserMessage: rawMessage },
      },
      clearPending: false,
    };
  }

  const llmSnap = snapshotFromInterpretation(interpretation);
  const resolved = resolveSemanticTurn(interpretation, input.conversation);
  interpretation.conversationAction = resolved.command.conversationAction;
  if (resolved.command.operations[0]?.intent) {
    interpretation.intent = resolved.command.operations[0].intent;
  }

  let parsed = turnInterpretationToParsed(interpretation, input.conversation);
  const semanticEntities = semanticCommandToLegacyEntities(resolved.command);
  if ('entities' in parsed) {
    parsed = {
      ...parsed,
      intent: resolved.command.operations[0]?.intent ?? parsed.intent,
      conversationAction: resolved.command.conversationAction,
      entities: {
        ...parsed.entities,
        ...semanticEntities,
        sourceText: rawMessage,
        rawUserMessage: rawMessage,
        semanticCommand: resolved.command,
      },
    };
  }

  if (
    resolved.command.conversationAction !== 'new_task' &&
    resolved.command.conversationAction !== 'cancel_current' &&
    input.conversation?.knownEntities &&
    'entities' in parsed
  ) {
    parsed = {
      ...parsed,
      entities: overlayKnownEntities(
        input.conversation.knownEntities,
        parsed.entities ?? {},
        resolved.command.conversationAction
      ),
    };
    if (parsed.entities) parsed.entities.semanticCommand = resolved.command;
  }

  const plan = buildOperationPlanFromCommand(resolved.command);
  const drift = meaningEquivalent(llmSnap, snapshotFromPlan(plan), { allowIntentSalvage: true });
  if (!drift.ok) {
    logSemanticDrift({
      rawMessage,
      llm: llmSnap,
      normalized: snapshotFromCommand(resolved.command),
      plan: snapshotFromPlan(plan),
      fieldDiff: drift.diffs,
    });
  }

  logWhatsappTurn({
    rawMessage,
    parsedIntent: parsed.intent,
    intent: parsed.intent,
    conversationAction: resolved.command.conversationAction,
    classifiedConversationAction: resolved.command.conversationAction,
    confidence: interpretation.confidence,
    itemQueries: interpretation.items?.map((item) => item.rawText),
    productParserExecuted: false,
    whyFallbackWasUsed:
      interpretation.clarificationReason === 'interpreter_unavailable'
        ? 'interpreter_unavailable'
        : interpretation.intent === 'unknown'
          ? 'interpreter_unknown'
          : null,
    llmOutput: JSON.stringify({
      intent: interpretation.intent,
      query: interpretation.query,
      filters: interpretation.filters,
      client: interpretation.client,
      clarificationReason: interpretation.clarificationReason,
    }).slice(0, 400),
    resolvedEntities: [
      `llmClient=${interpretation.client?.raw || interpretation.client?.name || ''}`,
      `focusClient=${input.conversation?.focusOrder?.clientName || ''}`,
      `effectiveClient=${('entities' in parsed && parsed.entities?.clientName) || ''}`,
    ],
    engine: 'llm_first',
    finalOperationPlan: plan.operations.map((row) => row.intent).join(','),
  });
  return {
    interpretation,
    parsed,
    clearPending: shouldClearPendingForCommand(resolved.command),
    resolved,
  };
}
