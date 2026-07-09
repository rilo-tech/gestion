import type { ClientPlatformAccess, TrialProductId } from '../../shared/platform-access.ts';
import {
  isTrialProductId,
  normalizePlatformAccess,
  platformAccessForTrialProduct,
} from '../../shared/platform-access.ts';

export function resolvePlatformAccessForBusiness(
  data: Record<string, unknown>
): ClientPlatformAccess {
  const raw = data.platformAccess;
  if (raw && typeof raw === 'object') {
    return normalizePlatformAccess(raw as Partial<ClientPlatformAccess>);
  }
  return normalizePlatformAccess(null);
}

export function platformAccessPayload(access: ClientPlatformAccess): ClientPlatformAccess {
  return {
    erpCoreEnabled: true,
    erpWebEnabled: access.erpWebEnabled === true,
    whatsappEnabled: access.whatsappEnabled === true,
    aiEnabled: access.aiEnabled === true,
    trialProduct: access.trialProduct ?? null,
  };
}

export function platformAccessFromTrialProduct(product: TrialProductId): ClientPlatformAccess {
  return platformAccessPayload(platformAccessForTrialProduct(product));
}

export function parseTrialProductFromBody(body: Record<string, unknown>): TrialProductId {
  const raw = body.trialProduct ?? body.producto ?? body.product;
  if (isTrialProductId(raw)) return raw;
  return 'completo';
}

export function sanitizePlatformAccessPatch(
  body: Record<string, unknown>
): Partial<ClientPlatformAccess> {
  const patch: Partial<ClientPlatformAccess> = {};
  if (typeof body.erpWebEnabled === 'boolean') patch.erpWebEnabled = body.erpWebEnabled;
  if (typeof body.whatsappEnabled === 'boolean') patch.whatsappEnabled = body.whatsappEnabled;
  if (typeof body.aiEnabled === 'boolean') patch.aiEnabled = body.aiEnabled;
  if (isTrialProductId(body.trialProduct)) patch.trialProduct = body.trialProduct;
  return patch;
}
