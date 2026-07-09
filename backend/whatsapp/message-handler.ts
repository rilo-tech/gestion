import { getBusiness } from '../auth/business.ts';
import { resolveTenantByPhone } from './tenant-resolver.ts';
import { assertWhatsappFeatures } from './feature-guard.ts';
import {
  clearConversationState,
  getConversationState,
  saveConversationState,
} from './conversation-state.ts';
import { parseWhatsappCommand, type ParsedWhatsappCommand } from './ai-command-parser.ts';
import { executeWhatsappCommand } from './erp-integration.ts';

export interface WhatsappInboundMessage {
  from: string;
  text: string;
}

export interface WhatsappHandlerResult {
  reply: string;
  intent: string;
  executed: boolean;
  businessId?: string;
}

const CONFIRM_YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const CONFIRM_NO = /^(no|cancelar|cancel|n)$/i;

function isTrialBlocked(business: Awaited<ReturnType<typeof getBusiness>>): boolean {
  if (!business) return true;
  return business.enPrueba === true && business.trialStatus === 'expired';
}

function isSubscriptionBlocked(business: Awaited<ReturnType<typeof getBusiness>>): boolean {
  if (!business) return true;
  if (business.enPrueba) return false;
  return business.estadoSuscripcion !== 'activa';
}

async function handlePendingConfirmation(
  businessId: string,
  phone: string,
  text: string,
  pendingIntent: string
): Promise<WhatsappHandlerResult> {
  if (CONFIRM_NO.test(text.trim())) {
    await clearConversationState(businessId, phone);
    return {
      reply: 'Listo, cancelé la operación. Escribime de nuevo cuando quieras.',
      intent: 'cancelled',
      executed: false,
      businessId,
    };
  }

  if (!CONFIRM_YES.test(text.trim())) {
    return {
      reply: 'Respondé SÍ para confirmar o NO para cancelar.',
      intent: pendingIntent,
      executed: false,
      businessId,
    };
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'No encontré tu cuenta. Contactá a soporte.',
      intent: 'error',
      executed: false,
    };
  }

  const parsed = {
    intent: pendingIntent,
    confidence: 1,
    raw: text,
  } as ParsedWhatsappCommand;

  const result = await executeWhatsappCommand(tenant, parsed);
  await clearConversationState(businessId, phone);

  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId,
  };
}

function needsConfirmation(intent: string): boolean {
  return ['create_order', 'create_sale', 'register_payment'].includes(intent);
}

function confirmationPrompt(parsed: ParsedWhatsappCommand): string {
  const raw = 'raw' in parsed ? parsed.raw : '';
  switch (parsed.intent) {
    case 'create_order':
      return `Voy a registrar un pedido${raw ? ` (${raw})` : ''}. ¿Confirmás? Respondé SÍ o NO.`;
    case 'create_sale':
      return `Voy a registrar una venta${raw ? ` (${raw})` : ''}. ¿Confirmás? Respondé SÍ o NO.`;
    case 'register_payment':
      return `Voy a registrar un pago${raw ? ` (${raw})` : ''}. ¿Confirmás? Respondé SÍ o NO.`;
    default:
      return '¿Confirmás la operación? Respondé SÍ o NO.';
  }
}

export async function handleWhatsappMessage(
  message: WhatsappInboundMessage
): Promise<WhatsappHandlerResult> {
  const phone = message.from.trim();
  const text = message.text.trim();

  if (!phone || !text) {
    return { reply: '', intent: 'empty', executed: false };
  }

  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) {
    return {
      reply: 'Tu número no está autorizado en RiloBot. Registrate o pedí acceso al administrador.',
      intent: 'unauthorized',
      executed: false,
    };
  }

  const business = await getBusiness(tenant.businessId);
  const guard = assertWhatsappFeatures(tenant, {
    trialExpired: isTrialBlocked(business),
    subscriptionActive: !isSubscriptionBlocked(business),
  });

  if (!guard.ok) {
    return {
      reply: guard.message,
      intent: guard.reason,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const state = await getConversationState(tenant.businessId, phone);
  if (state?.pendingIntent) {
    return handlePendingConfirmation(tenant.businessId, phone, text, state.pendingIntent);
  }

  const parsed = await parseWhatsappCommand(text);

  if (needsConfirmation(parsed.intent)) {
    await saveConversationState(tenant.businessId, phone, {
      pendingIntent: parsed.intent,
      pendingPayload: 'entities' in parsed ? (parsed.entities ?? {}) : {},
    });
    return {
      reply: confirmationPrompt(parsed),
      intent: parsed.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const result = await executeWhatsappCommand(tenant, parsed);
  return {
    reply: result.reply,
    intent: result.intent,
    executed: result.executed,
    businessId: tenant.businessId,
  };
}
