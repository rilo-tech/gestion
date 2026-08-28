import { saveConversationState, clearConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { whatsappCopyForRubro } from './copy.ts';
import { loadSetupGaps, startSetupStep } from './onboarding.ts';
import {
  hasSetupGaps,
  looksLikeIntenseHelp,
  looksLikeUnsupportedHelp,
  matchHelpTopic,
  matchSetupLoad,
  riloBotHelpMenu,
  riloBotHelpTopic,
  riloBotSetupStartCard,
  riloBotUnsupportedHelp,
  type HelpTopicId,
} from '../../shared/whatsapp-copy.ts';

export const HELP_TOPIC_INTENT = 'help_topic';
export { isHelpFollowUp, matchSetupLoad } from '../../shared/whatsapp-copy.ts';

const CONFIRM_NO = /^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i;

type HelpPayload = {
  helpUnsupportedCount?: number;
};

type HelpTurnResult = {
  reply: string;
  replies?: string[];
  intent: string;
  executed: boolean;
  businessId: string;
};

export async function handleHelpTurn(
  tenant: WhatsappTenantContext,
  text: string,
  pendingPayload?: Record<string, unknown> | null
): Promise<HelpTurnResult> {
  const { businessId, phone, rubro } = tenant;

  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Dale. Cuando quieras operar, escribime.',
      intent: HELP_TOPIC_INTENT,
      executed: false,
      businessId,
    };
  }

  const setupStep = matchSetupLoad(text);
  if (setupStep) {
    return startSetupStep(tenant, setupStep);
  }

  const copy = whatsappCopyForRubro(rubro);
  const prev = (pendingPayload ?? {}) as HelpPayload;
  let misses = Number(prev.helpUnsupportedCount) || 0;
  const topic = matchHelpTopic(text);

  let reply: string;
  let replies: string[] | undefined;
  if (looksLikeUnsupportedHelp(text) && (!topic || topic === 'menu')) {
    misses += 1;
    reply = riloBotUnsupportedHelp(misses >= 2 || looksLikeIntenseHelp(text));
  } else if (topic && topic !== 'menu') {
    misses = 0;
    reply = riloBotHelpTopic(topic as HelpTopicId, copy);
  } else if (looksLikeIntenseHelp(text) && misses >= 1) {
    misses += 1;
    reply = riloBotUnsupportedHelp(true);
  } else {
    const menu = riloBotHelpMenu();
    const gaps = await loadSetupGaps(businessId);
    const setupCard = hasSetupGaps(gaps) ? riloBotSetupStartCard(gaps) : '';
    if (setupCard) {
      replies = [menu, setupCard];
      reply = menu;
    } else {
      reply = menu;
    }
  }

  await saveConversationState(businessId, phone, {
    pendingIntent: HELP_TOPIC_INTENT,
    pendingPayload: { helpUnsupportedCount: misses },
    pendingPrompt: riloBotHelpMenu(),
  });

  return {
    reply,
    replies,
    intent: HELP_TOPIC_INTENT,
    executed: false,
    businessId,
  };
}
