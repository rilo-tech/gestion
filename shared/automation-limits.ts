import type { SubscriptionModulesMap } from './subscription-modules.ts';

/** Límites comerciales de automatizaciones (sin precios todavía). */
export type AutomationLimits = {
  enabled: boolean;
  /** null = sin tope */
  maxActiveAutomations: number | null;
  conditionWatchesAllowed: boolean;
};

export type AutomationLimitOverrides = {
  maxActiveAutomations?: number | null;
  conditionWatchesAllowed?: boolean;
};

export function resolveAutomationLimits(
  entitlements: SubscriptionModulesMap,
  overrides?: AutomationLimitOverrides | null
): AutomationLimits {
  const enabled = entitlements.automations === true;
  if (!enabled) {
    return {
      enabled: false,
      maxActiveAutomations: 0,
      conditionWatchesAllowed: false,
    };
  }

  const maxRaw = overrides?.maxActiveAutomations;
  const maxActiveAutomations =
    maxRaw === null || maxRaw === undefined
      ? null
      : Number.isFinite(Number(maxRaw)) && Number(maxRaw) >= 0
        ? Math.trunc(Number(maxRaw))
        : null;

  return {
    enabled: true,
    maxActiveAutomations,
    conditionWatchesAllowed: overrides?.conditionWatchesAllowed !== false,
  };
}
