import type { ClientPlatformAccess } from '../../shared/platform-access.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export type WhatsappFeatureBlockReason =
  | 'WHATSAPP_DISABLED'
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
      message: 'La suscripción no está activa.',
    };
  }

  return { ok: true };
}
