import { getBusiness, resolveForBusiness } from '../auth/business.ts';
import { resolveBusinessProfile } from '../../shared/business-profile.ts';
import {
  allowedAutomationChannels,
  defaultAutomationChannels,
  resolveAutomationChannels,
  type AutomationChannel,
} from '../../shared/automation-channels.ts';
import {
  AUTOMATION_PRESETS,
  getAutomationPreset,
  type AutomationPresetDefinition,
  type AutomationPresetId,
} from '../../shared/automation-presets.ts';
import {
  isAutomationActionAvailable,
  type AutomationAvailabilityContext,
} from './automation-availability.ts';
import { getAutomationAction } from './automation-action-registry.ts';
import {
  createAutomation,
  listAutomations,
  setAutomationStatus,
  updateAutomation,
} from './automation-service.ts';
import { loadAutomationUserPrefs, muteAutomationPreset } from './automation-prefs.ts';
import { muteNoticesForPreset } from './erp-notices.ts';
import {
  isOfferEligible,
  recordAutomationOfferChoice,
} from './automation-prefs.ts';
import type { AutomationOfferId } from '../../shared/erp-notices.ts';
import { normalizePlatformAccess, productIdFromAccess } from '../../shared/platform-access.ts';
import { listWhatsappUsers } from '../whatsapp/whatsapp-users.ts';
import { db } from '../firebase.ts';

export type PresetView = {
  preset: AutomationPresetDefinition;
  enabled: boolean;
  automationId: string | null;
  time: string | null;
  channels: AutomationChannel[];
  available: boolean;
  unavailableReason?: string;
};

async function availabilityCtx(businessId: string): Promise<{
  ctx: AutomationAvailabilityContext;
  access: ReturnType<typeof normalizePlatformAccess>;
  productId: ReturnType<typeof productIdFromAccess>;
}> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const { resolved } = await resolveForBusiness(business);
  const access = normalizePlatformAccess(business.platformAccess);
  const productId = productIdFromAccess(access);
  return {
    access,
    productId,
    ctx: {
      productId,
      entitlements: resolved.entitlements,
      profile: resolveBusinessProfile(business.businessProfile),
      permission: true,
      automationLimits: {
        maxActiveAutomations: resolved.suscripcion?.maxActiveAutomations ?? null,
        conditionWatchesAllowed: resolved.suscripcion?.conditionWatchesAllowed,
      },
    },
  };
}

async function primaryRecipientPhone(businessId: string): Promise<string> {
  const users = await listWhatsappUsers(businessId);
  const primary =
    users.find((u) => u.kind === 'primary' && u.enabled && u.phone) ??
    users.find((u) => u.enabled && u.phone);
  return primary?.phone?.trim() || '';
}

export async function listPresetViews(businessId: string): Promise<{
  presets: PresetView[];
  allowedChannels: AutomationChannel[];
  productId: string | null;
}> {
  const { ctx, access, productId } = await availabilityCtx(businessId);
  const automations = await listAutomations(businessId, { status: ['active', 'paused'] });
  const prefs = await loadAutomationUserPrefs(businessId);
  const allowedChannels = allowedAutomationChannels(access);

  const presets: PresetView[] = AUTOMATION_PRESETS.map((preset) => {
    const action = getAutomationAction(preset.actionId);
    const available =
      !!action &&
      isAutomationActionAvailable(action, ctx) &&
      allowedChannels.length > 0 &&
      !prefs.mutedPresets.includes(preset.id);
    const match = automations.find(
      (row) => row.actionId === preset.actionId && row.status !== 'cancelled'
    );
    const channels = resolveAutomationChannels(
      access,
      match?.channels?.length
        ? match.channels
        : prefs.preferredChannels?.length
          ? prefs.preferredChannels
          : preset.preferredChannels
    );
    return {
      preset,
      enabled: match?.status === 'active',
      automationId: match?.id ?? null,
      time: match?.schedule?.time ?? preset.defaultTime ?? null,
      channels,
      available,
      unavailableReason: !allowedChannels.length
        ? 'PLAN_NO_CHANNELS'
        : !available
          ? 'FEATURE_OR_MUTED'
          : undefined,
    };
  });

  return { presets, allowedChannels, productId };
}

export async function setPresetEnabled(input: {
  businessId: string;
  presetId: AutomationPresetId;
  enabled: boolean;
  time?: string;
  channels?: AutomationChannel[];
  actor?: string;
}): Promise<PresetView> {
  const preset = getAutomationPreset(input.presetId);
  if (!preset) throw new Error('PRESET_UNKNOWN');
  const { ctx, access } = await availabilityCtx(input.businessId);
  const action = getAutomationAction(preset.actionId);
  if (!action || !isAutomationActionAvailable(action, ctx)) {
    throw new Error('AUTOMATION_ACTION_NOT_AVAILABLE');
  }

  const channels = resolveAutomationChannels(
    access,
    input.channels?.length ? input.channels : defaultAutomationChannels(access)
  );
  if (!channels.length) throw new Error('NO_CHANNELS_FOR_PLAN');

  const automations = await listAutomations(input.businessId, { status: ['active', 'paused'] });
  const existing = automations.find((row) => row.actionId === preset.actionId);

  if (!input.enabled) {
    if (existing && existing.status === 'active') {
      await setAutomationStatus(input.businessId, existing.id, 'paused');
    }
  } else if (existing) {
    await updateAutomation({
      businessId: input.businessId,
      automationId: existing.id,
      schedule:
        preset.scheduleRequired
          ? {
              ...(existing.schedule ?? {}),
              time: input.time || existing.schedule?.time || preset.defaultTime || '09:00',
            }
          : existing.schedule,
      channels,
      status: 'active',
    });
    if (existing.status !== 'active') {
      await setAutomationStatus(input.businessId, existing.id, 'active');
    }
  } else {
    const phone = channels.includes('whatsapp')
      ? await primaryRecipientPhone(input.businessId)
      : '';
    if (channels.includes('whatsapp') && !phone) {
      throw new Error('WHATSAPP_RECIPIENT_REQUIRED');
    }
    await createAutomation({
      businessId: input.businessId,
      type: preset.type,
      actionId: preset.actionId,
      parameters: preset.parameters ?? {},
      schedule: preset.scheduleRequired
        ? { time: input.time || preset.defaultTime || '09:00' }
        : undefined,
      recipientPhone: phone,
      label: preset.label,
      createdBy: input.actor,
      channels,
    });
  }

  const views = await listPresetViews(input.businessId);
  const view = views.presets.find((row) => row.preset.id === input.presetId);
  if (!view) throw new Error('PRESET_UNKNOWN');
  return view;
}

export async function neverShowPreset(
  businessId: string,
  presetId: AutomationPresetId
): Promise<void> {
  await muteAutomationPreset(businessId, presetId);
  await muteNoticesForPreset(businessId, presetId);
  const automations = await listAutomations(businessId, { status: ['active', 'paused'] });
  const preset = getAutomationPreset(presetId);
  if (!preset) return;
  const match = automations.find((row) => row.actionId === preset.actionId);
  if (match) await setAutomationStatus(businessId, match.id, 'cancelled');
}

/** Presets recomendados standard_v1 al aceptar avisos en onboarding. */
export const STANDARD_V1_RECOMMENDED_PRESET_IDS = [
  'daily_attention',
  'daily_summary',
  'payables_due',
] as const satisfies readonly AutomationPresetId[];

/**
 * Activa los avisos recomendados standard_v1:
 * - 08:30 daily_attention_digest
 * - 19:00 daily_business_summary
 * - payables_due_reminder (daysBefore: 3)
 */
export async function enableStandardRecommendedAlerts(input: {
  businessId: string;
  actor?: string;
}): Promise<PresetView[]> {
  const enabled: PresetView[] = [];
  const specs: Array<{ presetId: AutomationPresetId; time?: string; parameters?: Record<string, unknown> }> = [
    { presetId: 'daily_attention', time: '08:30' },
    { presetId: 'daily_summary', time: '19:00' },
    { presetId: 'payables_due', time: '09:00', parameters: { daysBefore: 3 } },
    { presetId: 'overdue_orders', time: '09:30' },
  ];

  for (const spec of specs) {
    try {
      const view = await setPresetEnabled({
        businessId: input.businessId,
        presetId: spec.presetId,
        enabled: true,
        time: spec.time,
        actor: input.actor,
      });
      enabled.push(view);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      // Soft-skip if feature/plan/channel no aplica (p.ej. sin payables o sin WhatsApp aún).
      if (
        code === 'AUTOMATION_ACTION_NOT_AVAILABLE' ||
        code === 'NO_CHANNELS_FOR_PLAN' ||
        code === 'WHATSAPP_RECIPIENT_REQUIRED' ||
        code === 'PRESET_UNKNOWN'
      ) {
        continue;
      }
      throw error;
    }
  }

  return enabled;
}

export type ProgressiveOffer = {
  id: AutomationOfferId;
  presetId: AutomationPresetId;
  title: string;
  body: string;
};

export async function listProgressiveOffers(businessId: string): Promise<ProgressiveOffer[]> {
  const prefs = await loadAutomationUserPrefs(businessId);
  const { presets } = await listPresetViews(businessId);
  const offers: ProgressiveOffer[] = [];

  const daily = presets.find((p) => p.preset.id === 'daily_summary');
  if (
    daily?.available &&
    !daily.enabled &&
    isOfferEligible(prefs, 'offer_daily_summary')
  ) {
    const salesSnap = await db
      .collection(`negocios/${businessId}/ventas`)
      .orderBy('fecha', 'desc')
      .limit(5)
      .get()
      .catch(() => null);
    if (salesSnap && !salesSnap.empty) {
      offers.push({
        id: 'offer_daily_summary',
        presetId: 'daily_summary',
        title: 'Resumen diario',
        body: 'Ya tenés ventas registradas. ¿Querés que RILO te mande un resumen así todos los días?',
      });
    }
  }

  const stock = presets.find((p) => p.preset.id === 'low_stock');
  if (stock?.available && !stock.enabled && isOfferEligible(prefs, 'offer_low_stock')) {
    const products = await db
      .collection(`negocios/${businessId}/stock`)
      .where('stockMinimo', '>', 0)
      .limit(1)
      .get()
      .catch(() => null);
    if (products && !products.empty) {
      offers.push({
        id: 'offer_low_stock',
        presetId: 'low_stock',
        title: 'Aviso de stock bajo',
        body: 'Ya tenés productos con stock mínimo. ¿Querés que RILO te avise cuando alguno esté por agotarse?',
      });
    }
  }

  const due = presets.find((p) => p.preset.id === 'orders_due_today');
  if (due?.available && !due.enabled && isOfferEligible(prefs, 'offer_orders_due')) {
    const orders = await db
      .collection(`negocios/${businessId}/pedidos`)
      .limit(1)
      .get()
      .catch(() => null);
    if (orders && !orders.empty) {
      offers.push({
        id: 'offer_orders_due',
        presetId: 'orders_due_today',
        title: 'Pedidos de hoy',
        body: '¿Querés que RILO te avise a la mañana los pedidos para entregar hoy?',
      });
    }
  }

  return offers.slice(0, 1);
}

export async function respondProgressiveOffer(input: {
  businessId: string;
  offerId: AutomationOfferId;
  choice: 'accepted' | 'deferred' | 'declined';
  time?: string;
  actor?: string;
}): Promise<{ offerHandled: true; preset?: PresetView }> {
  const mapping: Record<AutomationOfferId, AutomationPresetId> = {
    offer_daily_summary: 'daily_summary',
    offer_low_stock: 'low_stock',
    offer_orders_due: 'orders_due_today',
    offer_pending_balances: 'pending_balances',
  };
  const presetId = mapping[input.offerId];
  await recordAutomationOfferChoice(input.businessId, input.offerId, input.choice);
  if (input.choice !== 'accepted') return { offerHandled: true };
  const preset = await setPresetEnabled({
    businessId: input.businessId,
    presetId,
    enabled: true,
    time: input.time,
    actor: input.actor,
  });
  return { offerHandled: true, preset };
}
