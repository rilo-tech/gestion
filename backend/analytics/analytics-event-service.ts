/**
 * Capa central de analytics backend.
 * Emite eventos de funnel sin conocer Meta CAPI / GA4 (hooks opcionales).
 * Milestones por empresa: idempotentes vía transaction en Firestore.
 */
import { db } from '../firebase.ts';
import { planCountsAsBusinessOperation } from '../../shared/bot-operation-milestones.ts';
import {
  applyBusinessOperationMilestone,
  applyFirstBotMessageMilestone,
  type AnalyticsMilestonesState,
} from '../../shared/analytics-milestones-logic.ts';
import type { TrialLifecycle } from '../../shared/trial-registration.ts';
import { productIdFromAccess, type TrialProductId } from '../../shared/platform-access.ts';

export type BackendAnalyticsEventName =
  | 'first_bot_message'
  | 'first_operation_completed'
  | 'third_operation_completed'
  | 'subscription_paid'
  | 'erp_first_login'
  | 'notification_created'
  | 'notification_opened'
  | 'notification_action_clicked'
  | 'notification_resolved'
  | 'notification_synced';

export type AnalyticsAcquisition = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  campaignSource?: string | null;
  landingPath?: string | null;
};

export type AnalyticsMilestones = AnalyticsMilestonesState;

type EmitContext = {
  businessId: string;
  productId?: TrialProductId | null;
  acquisition?: AnalyticsAcquisition | null;
  tools?: string[];
  source?: string;
};

type AnalyticsSink = (event: {
  name: BackendAnalyticsEventName;
  businessId: string;
  at: string;
  productId?: TrialProductId | null;
  acquisition?: AnalyticsAcquisition | null;
  properties?: Record<string, unknown>;
}) => Promise<void> | void;

const sinks: AnalyticsSink[] = [];

/** Registrar sink opcional (Meta CAPI / GA4 Measurement Protocol) sin secretos en FE. */
export function registerAnalyticsSink(sink: AnalyticsSink): void {
  sinks.push(sink);
}

function businessRef(businessId: string) {
  return db.collection('negocios').doc(businessId);
}

function eventsCol(businessId: string) {
  return businessRef(businessId).collection('analytics_events');
}

export function acquisitionFromLifecycle(lifecycle?: TrialLifecycle | null): AnalyticsAcquisition {
  if (!lifecycle) return {};
  return {
    utmSource: lifecycle.utmSource ?? null,
    utmMedium: lifecycle.utmMedium ?? null,
    utmCampaign: lifecycle.utmCampaign ?? null,
    utmContent: lifecycle.utmContent ?? null,
    utmTerm: lifecycle.utmTerm ?? null,
    fbclid: lifecycle.fbclid ?? null,
    gclid: lifecycle.gclid ?? null,
    campaignSource: lifecycle.campaignSource ?? null,
    landingPath: lifecycle.landingPath ?? null,
  };
}

async function persistEventDoc(
  businessId: string,
  name: BackendAnalyticsEventName,
  at: string,
  ctx: {
    productId?: TrialProductId | null;
    acquisition?: AnalyticsAcquisition | null;
    properties?: Record<string, unknown>;
  }
): Promise<void> {
  const { resolveRiloEnvironment } = await import('../../shared/rilo-environment.ts');
  await eventsCol(businessId).add({
    event: name,
    businessId,
    at,
    environment: resolveRiloEnvironment(),
    productId: ctx.productId ?? null,
    acquisition: ctx.acquisition ?? {},
    properties: ctx.properties ?? {},
  });
}

async function notifySinks(payload: Parameters<AnalyticsSink>[0]): Promise<void> {
  const { allowExternalAnalytics, resolveRiloEnvironment } = await import(
    '../../shared/rilo-environment.ts'
  );
  if (!allowExternalAnalytics()) {
    if (resolveRiloEnvironment() === 'staging') {
      console.info('[analytics:staging] sink externo omitido', payload.name);
    }
    return;
  }
  for (const sink of sinks) {
    try {
      await sink(payload);
    } catch (error) {
      console.warn('[analytics:sink]', payload.name, error);
    }
  }
}

/**
 * Primera vez que el tenant manda un mensaje válido al bot.
 * Idempotente: máximo una vez por empresa.
 */
export async function trackFirstBotMessage(input: EmitContext): Promise<boolean> {
  const at = new Date().toISOString();
  const ref = businessRef(input.businessId);
  let emitted = false;
  let productId = input.productId ?? null;
  let acquisition = input.acquisition ?? null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const milestones = {
      ...((data.analyticsMilestones as AnalyticsMilestones) ?? {}),
    };
    const applied = applyFirstBotMessageMilestone(milestones, at);
    if (!applied.emitted) return;

    if (!productId) {
      const access = data.platformAccess as Parameters<typeof productIdFromAccess>[0] | undefined;
      productId = access ? productIdFromAccess(access) : null;
    }
    if (!acquisition) {
      acquisition = acquisitionFromLifecycle(
        data.lifecycle && typeof data.lifecycle === 'object'
          ? (data.lifecycle as TrialLifecycle)
          : null
      );
    }

    tx.update(ref, {
      analyticsMilestones: applied.next,
      updatedAt: at,
    });
    emitted = true;
  });

  if (!emitted) return false;

  await persistEventDoc(input.businessId, 'first_bot_message', at, {
    productId,
    acquisition,
    properties: { source: input.source ?? 'whatsapp_v4' },
  });
  await notifySinks({
    name: 'first_bot_message',
    businessId: input.businessId,
    at,
    productId,
    acquisition,
  });
  return true;
}

/**
 * Tras un write real exitoso. Incrementa contador; emite first/third una sola vez.
 * `tools` = tools del plan ejecutado. Si ninguna cuenta como operación de negocio, no-op.
 */
export async function trackBotBusinessOperationCompleted(input: EmitContext & {
  tools: string[];
}): Promise<{
  counted: boolean;
  firstOperationEmitted: boolean;
  thirdOperationEmitted: boolean;
  operationCount: number;
}> {
  const empty = {
    counted: false,
    firstOperationEmitted: false,
    thirdOperationEmitted: false,
    operationCount: 0,
  };
  if (!planCountsAsBusinessOperation(input.tools)) return empty;

  const at = new Date().toISOString();
  const ref = businessRef(input.businessId);
  let firstOperationEmitted = false;
  let thirdOperationEmitted = false;
  let operationCount = 0;
  let productId = input.productId ?? null;
  let acquisition = input.acquisition ?? null;
  let counted = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const milestones: AnalyticsMilestones = {
      ...((data.analyticsMilestones as AnalyticsMilestones) ?? {}),
    };
    const applied = applyBusinessOperationMilestone(milestones, at);
    counted = applied.counted;
    operationCount = applied.operationCount;
    firstOperationEmitted = applied.firstOperationEmitted;
    thirdOperationEmitted = applied.thirdOperationEmitted;

    if (!productId) {
      const access = data.platformAccess as Parameters<typeof productIdFromAccess>[0] | undefined;
      productId = access ? productIdFromAccess(access) : null;
    }
    if (!acquisition) {
      acquisition = acquisitionFromLifecycle(
        data.lifecycle && typeof data.lifecycle === 'object'
          ? (data.lifecycle as TrialLifecycle)
          : null
      );
    }

    tx.update(ref, {
      analyticsMilestones: applied.next,
      updatedAt: at,
    });
  });

  if (!counted || operationCount <= 0) return empty;

  if (firstOperationEmitted) {
    await persistEventDoc(input.businessId, 'first_operation_completed', at, {
      productId,
      acquisition,
      properties: { tools: input.tools, operationCount },
    });
    await notifySinks({
      name: 'first_operation_completed',
      businessId: input.businessId,
      at,
      productId,
      acquisition,
      properties: { tools: input.tools, operationCount },
    });
  }

  if (thirdOperationEmitted) {
    await persistEventDoc(input.businessId, 'third_operation_completed', at, {
      productId,
      acquisition,
      properties: { tools: input.tools, operationCount },
    });
    await notifySinks({
      name: 'third_operation_completed',
      businessId: input.businessId,
      at,
      productId,
      acquisition,
      properties: { tools: input.tools, operationCount },
    });
  }

  return {
    counted: true,
    firstOperationEmitted,
    thirdOperationEmitted,
    operationCount,
  };
}

/** Eventos genéricos (avisos) sin milestone idempotente. */
export async function emitAnalyticsEvent(input: {
  name: BackendAnalyticsEventName;
  businessId: string;
  props?: Record<string, unknown>;
  productId?: TrialProductId | null;
}): Promise<void> {
  const at = new Date().toISOString();
  await persistEventDoc(input.businessId, input.name, at, {
    productId: input.productId ?? null,
    properties: input.props ?? {},
  });
  await notifySinks({
    name: input.name,
    businessId: input.businessId,
    at,
    productId: input.productId ?? null,
    properties: input.props ?? {},
  });
}
