import type { SubscriptionModulesMap } from './subscription-modules.ts';
import type { TrialProductId } from './platform-access.ts';
import {
  isBusinessFeatureEnabled,
  type BusinessFeatureId,
  type BusinessProfile,
} from './business-profile.ts';
import { featureForAgentCapability } from './tool-feature-map.ts';

export type CapabilityCheckInput = {
  productId?: TrialProductId | null;
  entitlements: SubscriptionModulesMap;
  profile: BusinessProfile;
  feature: BusinessFeatureId;
  permission: boolean;
};

/** Mapeo mínimo módulo de plan → feature operativa (FASE 1). */
export function entitlementAllowsFeature(
  entitlements: SubscriptionModulesMap,
  feature: BusinessFeatureId
): boolean {
  switch (feature) {
    case 'cash':
      return entitlements.caja === true;
    case 'orders':
      return entitlements.pedidos === true;
    case 'payables':
      return entitlements.payables === true;
    case 'collaborators':
      return entitlements.collaborators === true;
    case 'clients':
    case 'catalog':
    case 'products':
    case 'services':
    case 'stock':
    case 'sales':
    case 'purchases':
    case 'suppliers':
      return entitlements.core === true;
    default:
      return false;
  }
}

/** Límites comerciales por producto contratado. */
export function productAllowsFeature(
  productId: TrialProductId | null | undefined,
  feature: BusinessFeatureId
): boolean {
  if (!productId) return true;
  if (productId === 'cash') {
    return feature === 'cash';
  }
  if (productId === 'erp') {
    return feature !== 'cash' || true;
  }
  return true;
}

/**
 * Disponibilidad final: producto AND entitlement AND feature habilitada AND permiso.
 */
export function canUseBusinessFeature(input: CapabilityCheckInput): boolean {
  if (!productAllowsFeature(input.productId, input.feature)) return false;
  if (!entitlementAllowsFeature(input.entitlements, input.feature)) return false;
  if (!isBusinessFeatureEnabled(input.profile, input.feature)) return false;
  if (!input.permission) return false;
  return true;
}

/** Filtra tools del agente según producto, entitlements y perfil. */
export function agentCapabilityAllowed(input: {
  productId?: TrialProductId | null;
  entitlements: SubscriptionModulesMap;
  profile: BusinessProfile;
  capability: string;
}): boolean {
  if (input.capability === 'automations') {
    return input.entitlements.automations === true;
  }
  const feature = featureForAgentCapability(input.capability);
  if (!feature) return true;
  return canUseBusinessFeature({
    productId: input.productId,
    entitlements: input.entitlements,
    profile: input.profile,
    feature,
    permission: true,
  });
}
