import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import {
  emptyUsageMeter,
  estimateUsageUsd,
  roundUsd,
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
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
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

export async function incrementUsageField(
  businessId: string,
  field: 'aiActions' | 'waOutbound' | 'waInbound' | 'waOps' | 'purchasedWhatsapp' | 'purchasedAi',
  amount = 1
): Promise<void> {
  if (!businessId || amount <= 0) return;
  const period = usagePeriod();
  await usageRef(businessId, period).set(
    {
      period,
      [field]: FieldValue.increment(amount),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
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

export function decorateUsageForApi(meter: UsageMeterSnapshot, at = new Date()) {
  const cost = estimateUsageUsd(meter, at);
  return {
    ...meter,
    whatsappUsd: roundUsd(cost.whatsappUsd),
    geminiUsd: roundUsd(cost.geminiUsd),
    totalUsd: roundUsd(cost.totalUsd),
  };
}
