import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import {
  emptyUsageMeter,
  estimateUsageUsd,
  roundUsd,
  type PhoneUsageTotals,
  type UsageMeterSnapshot,
  type UsageToolId,
  type UsageToolTotals,
} from '../../shared/usage-cost.ts';

export function usagePeriod(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}

function usageRef(businessId: string, period = usagePeriod()) {
  return db.doc(`negocios/${businessId}/private/usage_${period}`);
}

function asTotals(raw: unknown): UsageToolTotals {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    calls: Math.max(0, Number(row.calls) || 0),
    inputTokens: Math.max(0, Number(row.inputTokens) || 0),
    outputTokens: Math.max(0, Number(row.outputTokens) || 0),
  };
}

export function parseUsageMeter(period: string, data: Record<string, unknown> | undefined): UsageMeterSnapshot {
  const base = emptyUsageMeter(period);
  if (!data) return base;
  const toolsRaw = (data.tools ?? {}) as Record<string, unknown>;
  const modelsRaw = (data.models ?? {}) as Record<string, unknown>;
  const tools: UsageMeterSnapshot['tools'] = {};
  for (const key of ['parser', 'catalog', 'clarify', 'voice'] as UsageToolId[]) {
    if (toolsRaw[key]) tools[key] = asTotals(toolsRaw[key]);
  }
  const models: UsageMeterSnapshot['models'] = {};
  for (const [name, row] of Object.entries(modelsRaw)) {
    models[name] = asTotals(row);
  }
  const phonesRaw = (data.phones ?? {}) as Record<string, unknown>;
  const phones: Record<string, PhoneUsageTotals> = {};
  for (const [key, row] of Object.entries(phonesRaw)) {
    const item = (row ?? {}) as Record<string, unknown>;
    phones[key] = {
      aiActions: Math.max(0, Number(item.aiActions) || 0),
      waInbound: Math.max(0, Number(item.waInbound) || 0),
      waOutbound: Math.max(0, Number(item.waOutbound) || 0),
    };
  }
  return {
    period: String(data.period ?? period),
    aiActions: Math.max(0, Number(data.aiActions) || 0),
    waOutbound: Math.max(0, Number(data.waOutbound) || 0),
    waInbound: Math.max(0, Number(data.waInbound) || 0),
    waOps: Math.max(0, Number(data.waOps) || 0),
    purchasedWhatsapp: Math.max(0, Number(data.purchasedWhatsapp) || 0),
    purchasedAi: Math.max(0, Number(data.purchasedAi) || 0),
    waQuotaNotified: data.waQuotaNotified === true,
    waQuotaWarned80: data.waQuotaWarned80 === true,
    tools,
    models,
    phones,
    dailyAi: parseDailyMap(data.dailyAi),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

function parseDailyMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    out[key] = Math.max(0, Number(value) || 0);
  }
  return out;
}

async function legacyCount(businessId: string, prefix: 'ai_usage' | 'wa_ops'): Promise<number> {
  const snap = await db.doc(`negocios/${businessId}/private/${prefix}_${usagePeriod()}`).get();
  return Number(snap.data()?.count) || 0;
}

export async function loadUsageMeter(
  businessId: string,
  period = usagePeriod()
): Promise<UsageMeterSnapshot> {
  const snap = await usageRef(businessId, period).get();
  const meter = parseUsageMeter(period, snap.data() as Record<string, unknown> | undefined);
  if (!meter.aiActions) meter.aiActions = await legacyCount(businessId, 'ai_usage');
  if (!meter.waOps) meter.waOps = await legacyCount(businessId, 'wa_ops');
  return meter;
}

export async function markWhatsappQuotaNotified(businessId: string): Promise<void> {
  if (!businessId) return;
  const period = usagePeriod();
  await usageRef(businessId, period).set(
    {
      period,
      waQuotaNotified: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function markWhatsappQuotaWarned80(businessId: string): Promise<void> {
  if (!businessId) return;
  const period = usagePeriod();
  await usageRef(businessId, period).set(
    {
      period,
      waQuotaWarned80: true,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function clearWhatsappQuotaNotices(businessId: string): Promise<void> {
  if (!businessId) return;
  const period = usagePeriod();
  await usageRef(businessId, period).set(
    {
      period,
      waQuotaNotified: false,
      waQuotaWarned80: false,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export function phoneMeterKey(phone: string): string {
  const digits = String(phone ?? '').replace(/[^\d]/g, '');
  return digits || 'unknown';
}

export async function incrementUsageField(
  businessId: string,
  field: 'aiActions' | 'waOutbound' | 'waInbound' | 'waOps' | 'purchasedWhatsapp' | 'purchasedAi',
  amount = 1,
  phone?: string | null
): Promise<void> {
  if (!businessId || amount <= 0) return;
  const period = usagePeriod();
  const payload: Record<string, unknown> = {
    period,
    [field]: FieldValue.increment(amount),
    updatedAt: new Date().toISOString(),
  };
  if (field === 'aiActions') {
    const day = new Date().toISOString().slice(0, 10);
    payload[`dailyAi.${day}`] = FieldValue.increment(amount);
  }
  const key = phone ? phoneMeterKey(phone) : '';
  if (key && (field === 'aiActions' || field === 'waInbound' || field === 'waOutbound')) {
    payload[`phones.${key}.${field}`] = FieldValue.increment(amount);
  }
  await usageRef(businessId, period).set(payload, { merge: true });
}

export async function recordGeminiUsage(input: {
  businessId: string;
  tool: UsageToolId;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const businessId = String(input.businessId ?? '').trim();
  if (!businessId) return;
  const model = String(input.model ?? 'unknown').trim() || 'unknown';
  const inputTokens = Math.max(0, Math.round(Number(input.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(input.outputTokens) || 0));
  const period = usagePeriod();
  await usageRef(businessId, period).set(
    {
      period,
      tools: {
        [input.tool]: {
          calls: FieldValue.increment(1),
          inputTokens: FieldValue.increment(inputTokens),
          outputTokens: FieldValue.increment(outputTokens),
        },
      },
      models: {
        [model]: {
          calls: FieldValue.increment(1),
          inputTokens: FieldValue.increment(inputTokens),
          outputTokens: FieldValue.increment(outputTokens),
        },
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function loadDailyAiSeries(
  businessId: string,
  days = 30,
  at = new Date()
): Promise<{ date: string; actions: number }[]> {
  const dates: string[] = [];
  const periods = new Set<string>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(at);
    day.setUTCDate(day.getUTCDate() - i);
    const iso = day.toISOString().slice(0, 10);
    dates.push(iso);
    periods.add(iso.slice(0, 7));
  }
  const meters = await Promise.all([...periods].map((period) => loadUsageMeter(businessId, period)));
  const merged: Record<string, number> = {};
  for (const meter of meters) {
    Object.assign(merged, meter.dailyAi ?? {});
  }
  return dates.map((date) => ({ date, actions: merged[date] || 0 }));
}

export function decorateUsageForApi(meter: UsageMeterSnapshot, at = new Date()) {
  const cost = estimateUsageUsd(meter, at);
  return {
    ...meter,
    whatsappUsd: roundUsd(cost.whatsappUsd),
    geminiUsd: roundUsd(cost.geminiUsd),
    totalUsd: roundUsd(cost.totalUsd),
  };
}
