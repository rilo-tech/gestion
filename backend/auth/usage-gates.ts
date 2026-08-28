import { db } from '../firebase.ts';
import { getBusiness } from './business.ts';
import { getCommercialCatalog } from './commercial-catalog.ts';
import { resolveTrialState } from '../../shared/trial-state.ts';
import type { CommercialCatalog } from '../../shared/commercial-catalog.ts';
import { productIdFromAccess } from '../../shared/platform-access.ts';
import {
  incrementUsageField,
  loadUsageMeter,
  decorateUsageForApi,
  markWhatsappQuotaNotified,
  markWhatsappQuotaWarned80,
} from './usage-meter.ts';
import { parseBusinessUsageQuota } from '../../shared/usage-cost.ts';

export type BillingMode = 'trial' | 'lite' | 'paid' | 'blocked';

function hasPaidCoverage(paidUntil?: string | null): boolean {
  const raw = String(paidUntil ?? '').trim();
  if (!raw) return false;
  const date = new Date(raw.includes('T') ? raw : `${raw.slice(0, 10)}T23:59:59`);
  return !Number.isNaN(date.getTime()) && date.getTime() >= Date.now();
}

export function resolveBillingMode(business: {
  estadoSuscripcion?: string;
  enPrueba?: boolean;
  trialStatus?: string | null;
  trialEndDate?: string | null;
  trialStartDate?: string | null;
  billing?: { paidUntil?: string | null } | null;
}): BillingMode {
  if (business.estadoSuscripcion === 'suspendida' || business.estadoSuscripcion === 'vencida') {
    return 'blocked';
  }
  if (hasPaidCoverage(business.billing?.paidUntil)) return 'paid';
  const trial = resolveTrialState(business);
  if (trial.isTrialBillingActive) return 'trial';
  if (business.enPrueba === true) return 'blocked';
  return 'paid';
}

async function countCollection(businessId: string, collection: string): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/${collection}`).count().get();
  return snap.data().count;
}

function usagePeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function aiUsageRef(businessId: string) {
  return db.doc(`negocios/${businessId}/private/ai_usage_${usagePeriod()}`);
}

export async function getAiUsageCount(businessId: string): Promise<number> {
  const snap = await aiUsageRef(businessId).get();
  return Number(snap.data()?.count) || 0;
}

export async function incrementAiUsage(businessId: string, amount = 1): Promise<number> {
  const ref = aiUsageRef(businessId);
  const next = (await getAiUsageCount(businessId)) + Math.max(1, amount);
  await ref.set(
    {
      period: usagePeriod(),
      count: next,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  try {
    await incrementUsageField(businessId, 'aiActions', Math.max(1, amount));
  } catch (error) {
    console.warn('[usage] aiActions meter:', error);
  }
  return next;
}

export async function aiQuotaForBusiness(businessId: string): Promise<{
  mode: BillingMode;
  used: number;
  max: number;
  extra: number;
  purchased: number;
  catalog: CommercialCatalog;
}> {
  const [business, catalog, used, meter] = await Promise.all([
    getBusiness(businessId),
    getCommercialCatalog(),
    getAiUsageCount(businessId),
    loadUsageMeter(businessId),
  ]);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const mode = resolveBillingMode(business);
  let max = catalog.trialAccionesIaMes;
  if (mode === 'lite') max = catalog.lite.maxAccionesIaMes;
  if (mode === 'paid') {
    const product = productIdFromAccess(business.platformAccess ?? { erpCoreEnabled: true, erpWebEnabled: false, whatsappEnabled: false, aiEnabled: false }) ?? 'completo';
    max = catalog.products[product]?.includedAi ?? catalog.products.completo.includedAi;
  }
  const extra = parseBusinessUsageQuota(business.usageQuota).extraAi;
  const purchased = meter.purchasedAi;
  if (mode === 'blocked') max = 0;
  else max += extra + purchased;
  return { mode, used, max, extra, purchased, catalog };
}

export async function assertCanUseAi(businessId: string, cost = 1): Promise<void> {
  const quota = await aiQuotaForBusiness(businessId);
  if (quota.mode === 'blocked') throw new Error('SUBSCRIPTION_INACTIVE');
  if (quota.max <= 0) return;
  if (quota.used + cost > quota.max) throw new Error('AI_QUOTA_EXCEEDED');
}

export async function assertCanCreateClient(businessId: string): Promise<void> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const mode = resolveBillingMode(business);
  if (mode !== 'lite') return;
  const catalog = await getCommercialCatalog();
  const used = await countCollection(businessId, 'clientes');
  if (used >= catalog.lite.maxClientes) throw new Error('CLIENT_LIMIT_REACHED');
}

function opsUsageRef(businessId: string) {
  return db.doc(`negocios/${businessId}/private/wa_ops_${usagePeriod()}`);
}

export async function getWhatsappOpsCount(businessId: string): Promise<number> {
  const snap = await opsUsageRef(businessId).get();
  return Number(snap.data()?.count) || 0;
}

export async function incrementWhatsappOps(businessId: string, amount = 1): Promise<number> {
  const ref = opsUsageRef(businessId);
  const next = (await getWhatsappOpsCount(businessId)) + Math.max(1, amount);
  await ref.set(
    {
      period: usagePeriod(),
      count: next,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  try {
    await incrementUsageField(businessId, 'waOps', Math.max(1, amount));
  } catch (error) {
    console.warn('[usage] waOps meter:', error);
  }
  return next;
}

export async function whatsappBubbleQuotaForBusiness(businessId: string): Promise<{
  mode: BillingMode;
  used: number;
  max: number;
  extra: number;
  purchased: number;
  catalog: CommercialCatalog;
}> {
  const [business, catalog, meter] = await Promise.all([
    getBusiness(businessId),
    getCommercialCatalog(),
    loadUsageMeter(businessId),
  ]);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const mode = resolveBillingMode(business);
  let max = catalog.trialWhatsappMensajes;
  if (mode === 'lite') max = catalog.lite.maxWhatsappMensajes;
  if (mode === 'paid') {
    const product =
      productIdFromAccess(
        business.platformAccess ?? {
          erpCoreEnabled: true,
          erpWebEnabled: false,
          whatsappEnabled: false,
          aiEnabled: false,
        }
      ) ?? 'completo';
    max = catalog.products[product]?.includedWhatsapp ?? 0;
    if (max <= 0 && business.platformAccess?.whatsappEnabled) {
      max = catalog.products.whatsapp.includedWhatsapp;
    }
  }
  const extra = parseBusinessUsageQuota(business.usageQuota).extraWhatsapp;
  const purchased = meter.purchasedWhatsapp;
  if (mode === 'blocked') max = 0;
  else max += extra + purchased;
  return { mode, used: meter.waOutbound, max, extra, purchased, catalog };
}

export async function assertCanSendWhatsapp(businessId: string): Promise<void> {
  const quota = await whatsappBubbleQuotaForBusiness(businessId);
  if (quota.mode === 'blocked') throw new Error('SUBSCRIPTION_INACTIVE');
  if (quota.max <= 0) return;
  if (quota.used >= quota.max) throw new Error('WA_BUBBLE_QUOTA_EXCEEDED');
}

/** One “cupo lleno” bubble, then silence so Meta does not keep charging. */
export async function whatsappQuotaNoticeOrSilent(businessId: string): Promise<string> {
  const meter = await loadUsageMeter(businessId);
  if (meter.waQuotaNotified) return '';
  await markWhatsappQuotaNotified(businessId);
  return replyForUsageError('WA_BUBBLE_QUOTA_EXCEEDED', businessId);
}

/** One warning near 80% of the month cupo. */
export async function maybeWhatsappQuotaWarning(businessId: string): Promise<string | null> {
  const [quota, meter] = await Promise.all([
    whatsappBubbleQuotaForBusiness(businessId),
    loadUsageMeter(businessId),
  ]);
  if (quota.max <= 0 || quota.mode === 'blocked') return null;
  if (quota.used >= quota.max) return null;
  if (quota.used / quota.max < 0.8) return null;
  if (meter.waQuotaWarned80) return null;
  await markWhatsappQuotaWarned80(businessId);
  const left = quota.max - quota.used;
  return `Vas por ${quota.used} de ${quota.max} mensajes este mes. Quedan ${left}. SÍ/NO también cuentan.`;
}

export async function assertCanRunWhatsappWrite(businessId: string): Promise<void> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const mode = resolveBillingMode(business);
  if (mode === 'blocked') throw new Error('SUBSCRIPTION_INACTIVE');
  if (mode !== 'lite') return;
  const catalog = await getCommercialCatalog();
  const used = await getWhatsappOpsCount(businessId);
  if (used >= catalog.lite.maxOperacionesMes) throw new Error('OPS_LIMIT_REACHED');
}

export async function assertCanCreateProduct(businessId: string): Promise<void> {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const mode = resolveBillingMode(business);
  if (mode !== 'lite') return;
  const catalog = await getCommercialCatalog();
  const used = await countCollection(businessId, 'stock');
  if (used >= catalog.lite.maxProductos) throw new Error('PRODUCT_LIMIT_REACHED');
}

const USAGE_LIMIT_CODES = new Set([
  'CLIENT_LIMIT_REACHED',
  'PRODUCT_LIMIT_REACHED',
  'AI_QUOTA_EXCEEDED',
  'OPS_LIMIT_REACHED',
  'WA_BUBBLE_QUOTA_EXCEEDED',
  'SUBSCRIPTION_INACTIVE',
]);

export function isUsageLimitError(error: unknown): error is Error {
  return error instanceof Error && USAGE_LIMIT_CODES.has(error.message);
}

export function usageLimitMessage(code: string, catalog: CommercialCatalog, maxAi?: number): string {
  if (code === 'CLIENT_LIMIT_REACHED') {
    return `En el plan libre podés tener hasta ${catalog.lite.maxClientes} clientes. Activá un plan para seguir cargando.`;
  }
  if (code === 'PRODUCT_LIMIT_REACHED') {
    return `En el plan libre podés tener hasta ${catalog.lite.maxProductos} productos. Activá un plan para seguir cargando.`;
  }
  if (code === 'AI_QUOTA_EXCEEDED') {
    const max = maxAi ?? catalog.lite.maxAccionesIaMes;
    return `Llegaste al tope de ${max} acciones IA este mes. Activá un plan o esperá al próximo mes para seguir usando la IA de RILO Bot.`;
  }
  if (code === 'OPS_LIMIT_REACHED') {
    return `En el plan libre podés cargar hasta ${catalog.lite.maxOperacionesMes} operaciones por WhatsApp este mes. Activá un plan para seguir al ritmo de tu negocio.`;
  }
  if (code === 'WA_BUBBLE_QUOTA_EXCEEDED') {
    return 'Llegaste al tope de mensajes de WhatsApp de este mes. Se renueva el mes que viene. El panel sigue igual.';
  }
  if (code === 'SUBSCRIPTION_INACTIVE') {
    return 'Tu prueba gratuita terminó. Tus datos siguen guardados. Activá un plan en la web para seguir usando RILO Bot.';
  }
  return 'Activá un plan para seguir usando esta función.';
}

export async function replyForUsageError(code: string, businessId: string): Promise<string> {
  const catalog = await getCommercialCatalog();
  if (code === 'AI_QUOTA_EXCEEDED') {
    const quota = await aiQuotaForBusiness(businessId);
    if (quota.mode === 'trial') {
      return `Llegaste al tope de ${quota.max} acciones IA de la prueba este mes. Seguí con mensajes simples (sin foto) o activá un plan.`;
    }
    if (quota.mode === 'paid') {
      return `Llegaste al tope de ${quota.max} acciones IA este mes. En Mi plan podés comprar un pack extra.`;
    }
    return `En el plan libre tenés ${quota.max} acciones IA al mes. Activá un plan para seguir usando la IA de RILO Bot.`;
  }
  if (code === 'WA_BUBBLE_QUOTA_EXCEEDED') {
    const quota = await whatsappBubbleQuotaForBusiness(businessId);
    if (quota.mode === 'trial') {
      return `Llegaste a los ${quota.max} mensajes de WhatsApp de la prueba este mes. El panel sigue; el bot se renueva el mes que viene o activá un plan.`;
    }
    if (quota.mode === 'paid') {
      return `Llegaste a los ${quota.max} mensajes de WhatsApp este mes. SÍ/NO también cuentan. En Mi plan podés comprar un pack extra.`;
    }
    return `En el plan libre tenés ${quota.max} mensajes de WhatsApp al mes. Activá un plan para seguir al ritmo del negocio.`;
  }
  return usageLimitMessage(code, catalog);
}

export async function formatThrownUsage(error: unknown, businessId: string): Promise<string> {
  if (!isUsageLimitError(error)) {
    return error instanceof Error ? error.message : 'No pude completar la operación.';
  }
  return replyForUsageError(error.message, businessId);
}

export async function buildUsageReport(businessId: string) {
  const [ai, wa, meter] = await Promise.all([
    aiQuotaForBusiness(businessId),
    whatsappBubbleQuotaForBusiness(businessId),
    loadUsageMeter(businessId),
  ]);
  const cost = decorateUsageForApi(meter);
  return {
    period: meter.period,
    mode: ai.mode,
    ai: { used: Math.max(ai.used, meter.aiActions), max: ai.max, extra: ai.extra, purchased: ai.purchased },
    whatsapp: { used: wa.used, max: wa.max, extra: wa.extra, purchased: wa.purchased },
    waInbound: meter.waInbound,
    waOps: meter.waOps,
    tools: meter.tools,
    models: meter.models,
    whatsappUsd: cost.whatsappUsd,
    geminiUsd: cost.geminiUsd,
    totalUsd: cost.totalUsd,
  };
}

export async function trySendUsageLimit(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  error: unknown
): Promise<boolean> {
  if (!isUsageLimitError(error)) return false;
  const catalog = await getCommercialCatalog();
  res.status(403).json({
    error: usageLimitMessage(error.message, catalog),
    code: error.message,
  });
  return true;
}
