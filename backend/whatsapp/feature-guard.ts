import { isWhatsappOperational, type ClientPlatformAccess } from '../../shared/platform-access.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export type WhatsappFeatureBlockReason =
  | 'WHATSAPP_DISABLED'
  | 'WHATSAPP_PAUSED'
  | 'AI_DISABLED'
  | 'TRIAL_EXPIRED'
  | 'SUBSCRIPTION_INACTIVE';

export function assertWhatsappFeatures(
  tenant: WhatsappTenantContext,
  options?: { requireAi?: boolean; trialExpired?: boolean; subscriptionActive?: boolean }
): { ok: true } | { ok: false; reason: WhatsappFeatureBlockReason; message: string } {
  const access: ClientPlatformAccess = tenant.platformAccess;

  if (!access.whatsappEnabled) {
    return {
      ok: false,
      reason: 'WHATSAPP_DISABLED',
      message: 'WhatsApp no está habilitado para esta empresa.',
    };
  }

  if (!isWhatsappOperational(access)) {
    return {
      ok: false,
      reason: 'WHATSAPP_PAUSED',
      message:
        'RILO Bot está dado de baja en esta cuenta. Reactivalo desde Planes, con la misma cuenta.',
    };
  }

  if (options?.requireAi !== false && !access.aiEnabled) {
    return {
      ok: false,
      reason: 'AI_DISABLED',
      message: 'El asistente IA no está habilitado para esta empresa.',
    };
  }

  if (options?.trialExpired) {
    return {
      ok: false,
      reason: 'TRIAL_EXPIRED',
      message: 'La prueba gratuita venció. Activá tu suscripción para seguir usando WhatsApp.',
    };
  }

  if (options?.subscriptionActive === false) {
    return {
      ok: false,
      reason: 'SUBSCRIPTION_INACTIVE',
      message:
        'Tu prueba gratuita terminó. Tus datos siguen guardados. Activá un plan en la web para seguir usando RILO Bot.',
    };
  }

  return { ok: true };
}
