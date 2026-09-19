import type { SubscriptionModulesMap } from '../../shared/subscription-modules.ts';
import type { BusinessProfile } from '../../shared/business-profile.ts';
import type { TrialProductId } from '../../shared/platform-access.ts';
import { canUseBusinessFeature } from '../../shared/business-capability.ts';
import {
  resolveAutomationLimits,
  type AutomationLimitOverrides,
} from '../../shared/automation-limits.ts';
import {
  AUTOMATION_CATEGORY_CATALOG,
  type AutomationCategoryId,
} from '../../shared/automation-categories.ts';
import type { AutomationActionDefinition } from '../../shared/automation-types.ts';
import { getAutomationAction, listAutomationActions } from './automation-action-registry.ts';

export type AutomationAvailabilityContext = {
  productId?: TrialProductId | null;
  entitlements: SubscriptionModulesMap;
  profile: BusinessProfile;
  permission?: boolean;
  automationLimits?: AutomationLimitOverrides | null;
};

export function isAutomationsEntitlementEnabled(ctx: AutomationAvailabilityContext): boolean {
  return resolveAutomationLimits(ctx.entitlements, ctx.automationLimits).enabled;
}

export function isAutomationActionAvailable(
  action: AutomationActionDefinition,
  ctx: AutomationAvailabilityContext
): boolean {
  if (action.status !== 'implemented') return false;
  if (!isAutomationsEntitlementEnabled(ctx)) return false;
  const limits = resolveAutomationLimits(ctx.entitlements, ctx.automationLimits);
  if (action.automationTypesSupported.includes('condition_watch') && !limits.conditionWatchesAllowed) {
    if (action.automationTypesSupported.every((t) => t === 'condition_watch')) {
      return false;
    }
  }
  if (
    !canUseBusinessFeature({
      productId: ctx.productId,
      entitlements: ctx.entitlements,
      profile: ctx.profile,
      feature: action.requiredFeature,
      permission: ctx.permission !== false,
    })
  ) {
    return false;
  }
  if (action.requiredModules?.includes('reports') && ctx.entitlements.reports !== true) {
    if (action.id !== 'daily_business_summary') return false;
  }
  if (action.requiredModules?.includes('payables') && ctx.entitlements.payables !== true) {
    return false;
  }
  return true;
}

export function listAvailableAutomationActions(
  ctx: AutomationAvailabilityContext
): AutomationActionDefinition[] {
  return listAutomationActions().filter((action) => isAutomationActionAvailable(action, ctx));
}

export type AutomationCategoryMenu = {
  id: AutomationCategoryId;
  label: string;
  icon: string;
  actions: AutomationActionDefinition[];
};

export function buildAutomationCategoryMenus(
  ctx: AutomationAvailabilityContext
): AutomationCategoryMenu[] {
  const available = listAvailableAutomationActions(ctx);
  const menus: AutomationCategoryMenu[] = [];

  for (const category of AUTOMATION_CATEGORY_CATALOG) {
    if (
      !canUseBusinessFeature({
        productId: ctx.productId,
        entitlements: ctx.entitlements,
        profile: ctx.profile,
        feature: category.requiredFeature,
        permission: ctx.permission !== false,
      })
    ) {
      continue;
    }
    const actions = available.filter((action) => action.category === category.id);
    if (!actions.length) continue;
    menus.push({
      id: category.id,
      label: category.label,
      icon: category.icon,
      actions,
    });
  }

  return menus;
}

export function formatAvailableActionsMenu(menus: AutomationCategoryMenu[]): {
  title: string;
  body: string;
  categories: AutomationCategoryMenu[];
} {
  const lines = menus.map((menu, index) => `${index + 1}. ${menu.icon} ${menu.label}`);
  const body = [
    '*⏰ Automatizaciones disponibles*',
    '',
    'RILO puede avisarte o enviarte información automáticamente.',
    '',
    ...lines,
    '',
    'Elegí una opción.',
  ].join('\n');

  return { title: 'Automatizaciones disponibles', body, categories: menus };
}

export function formatCategoryActionsMenu(category: AutomationCategoryMenu): string {
  const lines = category.actions.map(
    (action, index) => `${index + 1}. ${action.icon} ${action.label}`
  );
  return [
    `*${category.icon} ${category.label}*`,
    '',
    ...lines,
    '',
    'Elegí una opción.',
  ].join('\n');
}

export function resolveActionFromCategorySelection(
  menus: AutomationCategoryMenu[],
  categoryIndex: number,
  actionIndex?: number
): AutomationActionDefinition | undefined {
  const category = menus[categoryIndex - 1];
  if (!category) return undefined;
  if (actionIndex == null) return undefined;
  return category.actions[actionIndex - 1];
}

export function assertActionAvailable(actionId: string, ctx: AutomationAvailabilityContext): void {
  const action = getAutomationAction(actionId);
  if (!action) throw new Error('AUTOMATION_ACTION_UNKNOWN');
  if (!isAutomationActionAvailable(action, ctx)) throw new Error('AUTOMATION_ACTION_NOT_AVAILABLE');
}
