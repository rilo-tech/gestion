import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import type {
  AutomationActionId,
  AutomationRecord,
  AutomationSchedule,
  AutomationStatus,
  AutomationType,
  AutomationUsageMetrics,
} from '../../shared/automation-types.ts';
import type { AutomationChannel } from '../../shared/automation-channels.ts';
import {
  defaultAutomationChannels,
  parseAutomationChannels,
  resolveAutomationChannels,
} from '../../shared/automation-channels.ts';
import {
  defaultConditionState,
  getAutomationAction,
  resolveBusinessTimezone,
} from './automation-action-registry.ts';
import { resolveAutomationLimits } from '../../shared/automation-limits.ts';
import { getBusiness, resolveForBusiness } from '../auth/business.ts';
import { emptyModulesMap } from '../../shared/subscription-modules.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

function automationsCol(businessId: string) {
  return db.collection(`negocios/${businessId}/automations`);
}

function usageRef(businessId: string) {
  return db.doc(`negocios/${businessId}/metrics/automations`);
}

function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function computeNextRunAt(
  type: AutomationType,
  schedule: AutomationSchedule | undefined,
  timezone = DEFAULT_TZ,
  from = new Date()
): string | null {
  if (type === 'condition_watch') return null;
  if (type === 'scheduled_once') {
    const runAt = String(schedule?.runAt ?? '').trim();
    return runAt || null;
  }
  const time = String(schedule?.time ?? '09:00').trim();
  const [hh, mm] = time.split(':').map((part) => Number(part) || 0);
  const days = schedule?.daysOfWeek?.length ? schedule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(from.getTime() + offset * 86_400_000);
    const parts = formatter.formatToParts(candidate);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
    if (!days.includes(dayIndex)) continue;

    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);

    const localNow = new Date(from);
    const isToday = offset === 0;
    if (isToday && (hour < localNow.getHours() || (hour === localNow.getHours() && minute <= localNow.getMinutes()))) {
      continue;
    }

    const isoLocal = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
    const parsed = new Date(isoLocal);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const fallback = new Date(from.getTime() + 86_400_000);
  fallback.setHours(hh, mm, 0, 0);
  return fallback.toISOString();
}

function mapAutomationDoc(id: string, businessId: string, data: Record<string, unknown>): AutomationRecord {
  return {
    id,
    businessId,
    type: String(data.type ?? 'recurring') as AutomationType,
    actionId: String(data.actionId ?? '') as AutomationActionId,
    parameters: (data.parameters as Record<string, unknown>) ?? {},
    schedule: (data.schedule as AutomationSchedule) ?? undefined,
    status: String(data.status ?? 'active') as AutomationStatus,
    label: data.label != null ? String(data.label) : undefined,
    recipientPhone: String(data.recipientPhone ?? ''),
    channels: parseAutomationChannels(data.channels),
    lastDeliveryFingerprint:
      data.lastDeliveryFingerprint != null ? String(data.lastDeliveryFingerprint) : null,
    lastWhatsappSentAt: data.lastWhatsappSentAt != null ? String(data.lastWhatsappSentAt) : null,
    conditionState: (data.conditionState as AutomationRecord['conditionState']) ?? undefined,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    createdBy: data.createdBy != null ? String(data.createdBy) : undefined,
    nextRunAt: data.nextRunAt != null ? String(data.nextRunAt) : null,
    lastRunAt: data.lastRunAt != null ? String(data.lastRunAt) : null,
    runCount: Number(data.runCount) || 0,
    messagesSent: Number(data.messagesSent) || 0,
  };
}

export type CreateAutomationInput = {
  businessId: string;
  type: AutomationType;
  actionId: AutomationActionId;
  parameters: Record<string, unknown>;
  schedule?: AutomationSchedule;
  recipientPhone: string;
  label?: string;
  createdBy?: string;
  channels?: AutomationChannel[];
};

export async function createAutomation(input: CreateAutomationInput): Promise<AutomationRecord> {
  const action = getAutomationAction(input.actionId);
  if (!action) throw new Error('AUTOMATION_ACTION_UNKNOWN');
  if (!action.automationTypesSupported.includes(input.type)) {
    throw new Error('AUTOMATION_TYPE_NOT_SUPPORTED');
  }

  const business = await getBusiness(input.businessId);
  const { resolved } = business
    ? await resolveForBusiness(business)
    : { resolved: null };
  const entitlements = resolved?.entitlements ?? emptyModulesMap(true);
  const limits = resolveAutomationLimits(entitlements, {
    maxActiveAutomations: resolved?.suscripcion?.maxActiveAutomations ?? null,
    conditionWatchesAllowed: resolved?.suscripcion?.conditionWatchesAllowed,
  });
  if (!limits.enabled) throw new Error('AUTOMATIONS_NOT_ENABLED');
  if (input.type === 'condition_watch' && !limits.conditionWatchesAllowed) {
    throw new Error('CONDITION_WATCH_NOT_ALLOWED');
  }
  if (limits.maxActiveAutomations != null) {
    const active = await listAutomations(input.businessId, { status: 'active' });
    if (active.length >= limits.maxActiveAutomations) {
      throw new Error('MAX_ACTIVE_AUTOMATIONS');
    }
  }

  const timezone = input.schedule?.timezone ?? (await resolveBusinessTimezone(input.businessId));
  const schedule = input.schedule ? { ...input.schedule, timezone } : undefined;
  const now = new Date().toISOString();
  const ref = automationsCol(input.businessId).doc();
  const nextRunAt = computeNextRunAt(input.type, schedule, timezone);
  const access = normalizePlatformAccess(business?.platformAccess);
  const channels =
    input.channels?.length
      ? resolveAutomationChannels(access, input.channels)
      : defaultAutomationChannels(access);

  const payload: Record<string, unknown> = {
    type: input.type,
    actionId: input.actionId,
    parameters: input.parameters,
    schedule: schedule ?? null,
    status: 'active',
    label: input.label ?? action.label,
    recipientPhone: input.recipientPhone,
    channels,
    lastDeliveryFingerprint: null,
    lastWhatsappSentAt: null,
    conditionState: input.type === 'condition_watch' ? defaultConditionState() : null,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? null,
    nextRunAt,
    lastRunAt: null,
    runCount: 0,
    messagesSent: 0,
  };

  await ref.set(payload);
  await incrementAutomationUsage(input.businessId, { activeDelta: 1 });
  return mapAutomationDoc(ref.id, input.businessId, payload);
}

export async function listAutomations(
  businessId: string,
  options?: { status?: AutomationStatus | AutomationStatus[] }
): Promise<AutomationRecord[]> {
  const snap = await automationsCol(businessId).get();
  const statuses = options?.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : null;

  return snap.docs
    .map((doc) => mapAutomationDoc(doc.id, businessId, doc.data() as Record<string, unknown>))
    .filter((row) => (statuses ? statuses.includes(row.status) : row.status !== 'cancelled'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getAutomation(
  businessId: string,
  automationId: string
): Promise<AutomationRecord | null> {
  const snap = await automationsCol(businessId).doc(automationId).get();
  if (!snap.exists) return null;
  return mapAutomationDoc(snap.id, businessId, snap.data() as Record<string, unknown>);
}

export type UpdateAutomationInput = {
  businessId: string;
  automationId: string;
  parameters?: Record<string, unknown>;
  schedule?: AutomationSchedule;
  label?: string;
  status?: AutomationStatus;
  channels?: AutomationChannel[];
  recipientPhone?: string;
};

export async function updateAutomation(input: UpdateAutomationInput): Promise<AutomationRecord> {
  const existing = await getAutomation(input.businessId, input.automationId);
  if (!existing) throw new Error('AUTOMATION_NOT_FOUND');

  const timezone =
    input.schedule?.timezone ??
    existing.schedule?.timezone ??
    (await resolveBusinessTimezone(input.businessId));
  const schedule = input.schedule ? { ...input.schedule, timezone } : existing.schedule;
  const nextRunAt = computeNextRunAt(existing.type, schedule, timezone);
  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (input.parameters) patch.parameters = input.parameters;
  if (input.schedule) patch.schedule = schedule;
  if (input.label != null) patch.label = input.label;
  if (input.status) patch.status = input.status;
  if (input.recipientPhone != null) patch.recipientPhone = input.recipientPhone;
  if (input.channels) {
    const business = await getBusiness(input.businessId);
    const access = normalizePlatformAccess(business?.platformAccess);
    patch.channels = resolveAutomationChannels(access, input.channels);
  }
  if (nextRunAt !== undefined) patch.nextRunAt = nextRunAt;

  await automationsCol(input.businessId).doc(input.automationId).set(patch, { merge: true });
  const updated = await getAutomation(input.businessId, input.automationId);
  if (!updated) throw new Error('AUTOMATION_NOT_FOUND');
  return updated;
}

export async function setAutomationStatus(
  businessId: string,
  automationId: string,
  status: AutomationStatus
): Promise<AutomationRecord> {
  const existing = await getAutomation(businessId, automationId);
  if (!existing) throw new Error('AUTOMATION_NOT_FOUND');
  const wasActive = existing.status === 'active';
  await automationsCol(businessId).doc(automationId).set(
    { status, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  if (wasActive && status !== 'active') {
    await incrementAutomationUsage(businessId, { activeDelta: -1 });
  } else if (!wasActive && status === 'active') {
    await incrementAutomationUsage(businessId, { activeDelta: 1 });
  }
  const updated = await getAutomation(businessId, automationId);
  if (!updated) throw new Error('AUTOMATION_NOT_FOUND');
  return updated;
}

export async function markAutomationRun(
  businessId: string,
  automationId: string,
  patch: {
    nextRunAt?: string | null;
    conditionState?: AutomationRecord['conditionState'];
    delivered?: boolean;
    whatsappDelivered?: boolean;
    fingerprint?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    lastRunAt: now,
    updatedAt: now,
    runCount: FieldValue.increment(1),
  };
  if (patch.nextRunAt !== undefined) update.nextRunAt = patch.nextRunAt;
  if (patch.conditionState) update.conditionState = patch.conditionState;
  if (patch.delivered) update.messagesSent = FieldValue.increment(1);
  if (patch.whatsappDelivered) update.lastWhatsappSentAt = now;
  if (patch.fingerprint != null) update.lastDeliveryFingerprint = patch.fingerprint;
  await automationsCol(businessId).doc(automationId).set(update, { merge: true });

  await incrementAutomationUsage(businessId, {
    runsDelta: 1,
    conditionChecksDelta: patch.conditionState ? 1 : 0,
    messagesDelta: patch.delivered ? 1 : 0,
  });
}

export async function incrementAutomationUsage(
  businessId: string,
  delta: {
    activeDelta?: number;
    runsDelta?: number;
    conditionChecksDelta?: number;
    messagesDelta?: number;
    errorsDelta?: number;
  }
): Promise<void> {
  const key = monthKey();
  const patch: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    monthKey: key,
  };
  if (delta.activeDelta) patch.activeAutomations = FieldValue.increment(delta.activeDelta);
  if (delta.runsDelta) patch[`runsByMonth.${key}`] = FieldValue.increment(delta.runsDelta);
  if (delta.conditionChecksDelta) {
    patch[`conditionChecksByMonth.${key}`] = FieldValue.increment(delta.conditionChecksDelta);
  }
  if (delta.messagesDelta) patch[`messagesByMonth.${key}`] = FieldValue.increment(delta.messagesDelta);
  if (delta.errorsDelta) patch[`errorsByMonth.${key}`] = FieldValue.increment(delta.errorsDelta);
  await usageRef(businessId).set(patch, { merge: true });
}

export async function getAutomationUsageMetrics(businessId: string): Promise<AutomationUsageMetrics> {
  const snap = await usageRef(businessId).get();
  const data = snap.data() ?? {};
  const key = monthKey();
  return {
    activeAutomations: Number(data.activeAutomations) || 0,
    runsThisMonth: Number((data.runsByMonth as Record<string, number> | undefined)?.[key]) || 0,
    conditionChecksThisMonth:
      Number((data.conditionChecksByMonth as Record<string, number> | undefined)?.[key]) || 0,
    messagesSentThisMonth:
      Number((data.messagesByMonth as Record<string, number> | undefined)?.[key]) || 0,
    errorsThisMonth: Number((data.errorsByMonth as Record<string, number> | undefined)?.[key]) || 0,
    updatedAt: String(data.updatedAt ?? ''),
  };
}

export async function listDueAutomations(now = new Date()): Promise<AutomationRecord[]> {
  const businesses = await db.collection('negocios').select().get();
  const due: AutomationRecord[] = [];

  for (const businessDoc of businesses.docs) {
    const snap = await automationsCol(businessDoc.id)
      .where('status', '==', 'active')
      .get();
    for (const doc of snap.docs) {
      const row = mapAutomationDoc(doc.id, businessDoc.id, doc.data() as Record<string, unknown>);
      if (row.type === 'condition_watch') {
        due.push(row);
        continue;
      }
      const next = row.nextRunAt ? Date.parse(row.nextRunAt) : NaN;
      if (!Number.isNaN(next) && next <= now.getTime()) {
        due.push(row);
      }
    }
  }

  return due;
}
