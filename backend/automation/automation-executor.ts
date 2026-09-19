import type { AutomationExecuteResult, AutomationRecord } from '../../shared/automation-types.ts';
import {
  allowedAutomationChannels,
  defaultAutomationChannels,
  resolveAutomationChannels,
} from '../../shared/automation-channels.ts';
import { MAX_WA_AUTOMATION_SENDS_PER_DAY } from '../../shared/erp-notices.ts';
import { presetIdForAction } from '../../shared/automation-presets.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';
import { evaluateConditionWatchState } from './automation-condition-state.ts';
import { getAutomationAction, resolveBusinessTimezone } from './automation-action-registry.ts';
import { computeNextRunAt, markAutomationRun } from './automation-service.ts';
import { formatAutomationMessage } from './automation-presenters.ts';
import { sendWhatsappText } from '../whatsapp/meta-api.ts';
import { getBusiness } from '../auth/business.ts';
import {
  assertCanSendWhatsapp,
  isUsageLimitError,
  resolveBillingMode,
} from '../auth/usage-gates.ts';
import { incrementUsageField } from '../auth/usage-meter.ts';
import { buildNoticeFingerprint, createErpNotice, routeForAction } from './erp-notices.ts';

export type AutomationExecutionOutcome = {
  automationId: string;
  businessId: string;
  delivered: boolean;
  whatsappDelivered?: boolean;
  erpNoticeCreated?: boolean;
  skippedReason?: string;
  message?: string;
  error?: string;
  result?: AutomationExecuteResult;
};

function dayKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function sameLocalDay(iso: string | null | undefined, timezone: string, now: Date): boolean {
  if (!iso) return false;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  return dayKeyInTimezone(then, timezone) === dayKeyInTimezone(now, timezone);
}

export async function executeAutomationRecord(
  automation: AutomationRecord,
  options?: { referenceDate?: Date; dryRun?: boolean }
): Promise<AutomationExecutionOutcome> {
  const action = getAutomationAction(automation.actionId);
  if (!action || action.status !== 'implemented') {
    return {
      automationId: automation.id,
      businessId: automation.businessId,
      delivered: false,
      error: 'ACTION_NOT_AVAILABLE',
    };
  }

  const timezone =
    automation.schedule?.timezone ?? (await resolveBusinessTimezone(automation.businessId));
  const now = options?.referenceDate ?? new Date();

  try {
    const business = await getBusiness(automation.businessId);
    if (!business) {
      return {
        automationId: automation.id,
        businessId: automation.businessId,
        delivered: false,
        error: 'BUSINESS_NOT_FOUND',
      };
    }

    const billingMode = resolveBillingMode(business);
    if (billingMode === 'blocked') {
      return {
        automationId: automation.id,
        businessId: automation.businessId,
        delivered: false,
        skippedReason: 'SUBSCRIPTION_INACTIVE',
      };
    }

    const access = normalizePlatformAccess(business.platformAccess);
    const channels = resolveAutomationChannels(
      access,
      automation.channels?.length ? automation.channels : defaultAutomationChannels(access)
    );
    if (!channels.length) {
      return {
        automationId: automation.id,
        businessId: automation.businessId,
        delivered: false,
        skippedReason: 'NO_CHANNELS_FOR_PLAN',
      };
    }

    const result = await action.execute({
      businessId: automation.businessId,
      automation,
      referenceDate: now,
      timezone,
    });

    let shouldDeliver = result.shouldDeliver;
    let nextConditionState = automation.conditionState;

    if (automation.type === 'condition_watch') {
      const evaluation = evaluateConditionWatchState({
        conditionMet: result.conditionMet === true,
        conditionValue: result.conditionValue,
        state: automation.conditionState ?? { armed: true },
      });
      shouldDeliver = evaluation.shouldNotify;
      nextConditionState = evaluation.nextState;
    }

    const message = formatAutomationMessage(result);
    if (!shouldDeliver || !message || result.empty) {
      if (!options?.dryRun) {
        const nextRunAt =
          automation.type === 'scheduled_once'
            ? null
            : automation.type === 'recurring'
              ? computeNextRunAt(automation.type, automation.schedule, timezone, new Date(Date.now() + 60_000))
              : automation.nextRunAt ?? null;
        await markAutomationRun(automation.businessId, automation.id, {
          nextRunAt,
          conditionState: nextConditionState,
          delivered: false,
        });
      }
      return {
        automationId: automation.id,
        businessId: automation.businessId,
        delivered: false,
        skippedReason: 'NO_DATA',
        message,
        result,
      };
    }

    const fingerprint = buildNoticeFingerprint({
      actionId: automation.actionId,
      title: result.title,
      body: message,
      dayKey: dayKeyInTimezone(now, timezone),
    });

    if (automation.lastDeliveryFingerprint === fingerprint) {
      if (!options?.dryRun) {
        const nextRunAt =
          automation.type === 'scheduled_once'
            ? null
            : automation.type === 'recurring'
              ? computeNextRunAt(automation.type, automation.schedule, timezone, new Date(Date.now() + 60_000))
              : automation.nextRunAt ?? null;
        await markAutomationRun(automation.businessId, automation.id, {
          nextRunAt,
          conditionState: nextConditionState,
          delivered: false,
          fingerprint,
        });
      }
      return {
        automationId: automation.id,
        businessId: automation.businessId,
        delivered: false,
        skippedReason: 'DUPLICATE',
        message,
        result,
      };
    }

    let whatsappDelivered = false;
    let erpNoticeCreated = false;
    let deliveryError: string | undefined;

    if (!options?.dryRun) {
      if (channels.includes('erp') && allowedAutomationChannels(access).includes('erp')) {
        const notice = await createErpNotice({
          businessId: automation.businessId,
          automationId: automation.id,
          actionId: automation.actionId,
          presetId: presetIdForAction(automation.actionId),
          title: result.title,
          body: message,
          fingerprint,
          route: routeForAction(automation.actionId),
        });
        erpNoticeCreated = !!notice;
      }

      if (channels.includes('whatsapp') && allowedAutomationChannels(access).includes('whatsapp')) {
        const alreadySentToday = sameLocalDay(automation.lastWhatsappSentAt, timezone, now);
        const sendsToday = alreadySentToday ? 1 : 0;
        if (sendsToday >= MAX_WA_AUTOMATION_SENDS_PER_DAY) {
          deliveryError = deliveryError ?? 'WA_DAILY_CAP';
        } else if (!automation.recipientPhone) {
          deliveryError = deliveryError ?? 'NO_RECIPIENT';
        } else {
          try {
            await assertCanSendWhatsapp(automation.businessId);
            const send = await sendWhatsappText(automation.recipientPhone, message);
            if (send.ok) {
              whatsappDelivered = true;
              await incrementUsageField(automation.businessId, 'waOutbound', 1).catch((err) =>
                console.warn('[automation] waOutbound meter:', err)
              );
            } else {
              deliveryError = send.error;
              // Meta may reject free-form outside 24h window; do not invent template spam.
              if (String(send.error).toLowerCase().includes('template')) {
                deliveryError = 'WA_TEMPLATE_REQUIRED';
              }
            }
          } catch (error) {
            if (isUsageLimitError(error)) {
              deliveryError = error.message;
            } else {
              throw error;
            }
          }
        }
      }
    } else {
      whatsappDelivered = channels.includes('whatsapp');
      erpNoticeCreated = channels.includes('erp');
    }

    const delivered = whatsappDelivered || erpNoticeCreated;

    if (!options?.dryRun) {
      const nextRunAt =
        automation.type === 'scheduled_once'
          ? null
          : automation.type === 'recurring'
            ? computeNextRunAt(automation.type, automation.schedule, timezone, new Date(Date.now() + 60_000))
            : automation.nextRunAt ?? null;

      await markAutomationRun(automation.businessId, automation.id, {
        nextRunAt,
        conditionState: nextConditionState,
        delivered: whatsappDelivered,
        whatsappDelivered,
        fingerprint,
      });
    }

    return {
      automationId: automation.id,
      businessId: automation.businessId,
      delivered,
      whatsappDelivered,
      erpNoticeCreated,
      message,
      error: delivered ? undefined : deliveryError,
      result,
    };
  } catch (error) {
    return {
      automationId: automation.id,
      businessId: automation.businessId,
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAutomationTick(now = new Date()): Promise<{
  processed: number;
  delivered: number;
  errors: number;
  skipped: number;
  attentionSynced?: number;
}> {
  const { listDueAutomations } = await import('./automation-service.ts');
  const due = await listDueAutomations(now);
  let delivered = 0;
  let errors = 0;
  let skipped = 0;

  for (const automation of due) {
    const outcome = await executeAutomationRecord(automation, { referenceDate: now });
    if (outcome.delivered) delivered += 1;
    if (outcome.error) errors += 1;
    if (outcome.skippedReason) skipped += 1;
  }

  // Sync attention notices for businesses that had due automations (cheap batch)
  let attentionSynced = 0;
  const businessIds = [...new Set(due.map((a) => a.businessId))];
  if (businessIds.length) {
    const { syncAttentionNotices } = await import('./attention-sync.ts');
    for (const businessId of businessIds.slice(0, 40)) {
      try {
        const result = await syncAttentionNotices(businessId);
        attentionSynced += result.upserted;
      } catch (err) {
        console.warn('[automation:tick] attention sync failed', businessId, err);
      }
    }
  }

  return { processed: due.length, delivered, errors, skipped, attentionSynced };
}
