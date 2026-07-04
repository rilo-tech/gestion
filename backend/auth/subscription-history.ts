import { db } from '../firebase.ts';
import type { BusinessRecord } from './business.ts';
import type { BusinessSubscriptionRecord } from './subscription-entitlements.ts';
import type { TrialStatus } from '../../shared/trial-state.ts';

export type SubscriptionHistoryChangeType =
  | 'plan'
  | 'modules'
  | 'pricing'
  | 'limits'
  | 'trial'
  | 'status'
  | 'general';

export interface SubscriptionHistoryEntry {
  id: string;
  date: string;
  changedBy?: string;
  changeType: SubscriptionHistoryChangeType;
  note?: string;
  previousPlanId?: string;
  newPlanId?: string;
  previousTrialStatus?: TrialStatus | null;
  newTrialStatus?: TrialStatus | null;
  previousEnPrueba?: boolean;
  newEnPrueba?: boolean;
  previousSuscripcion?: BusinessSubscriptionRecord;
  newSuscripcion?: BusinessSubscriptionRecord;
}

function historyCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/subscription_history`);
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function pickSubscriptionSnapshot(
  suscripcion?: BusinessSubscriptionRecord
): BusinessSubscriptionRecord | undefined {
  if (!suscripcion) return undefined;
  return JSON.parse(JSON.stringify(suscripcion)) as BusinessSubscriptionRecord;
}

export async function listSubscriptionHistory(
  businessId: string,
  limit = 50
): Promise<SubscriptionHistoryEntry[]> {
  const snapshot = await historyCollection(businessId)
    .orderBy('date', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<SubscriptionHistoryEntry, 'id'>),
  }));
}

export async function appendSubscriptionHistory(
  businessId: string,
  entry: Omit<SubscriptionHistoryEntry, 'id' | 'date'> & { date?: string }
): Promise<void> {
  await historyCollection(businessId).add(
    omitUndefined({
      ...entry,
      date: entry.date ?? new Date().toISOString(),
    })
  );
}

export async function recordBusinessSubscriptionChange(params: {
  businessId: string;
  changedBy?: string;
  before: BusinessRecord;
  after: BusinessRecord;
  note?: string;
}): Promise<void> {
  const { businessId, changedBy, before, after, note } = params;
  const changes: SubscriptionHistoryChangeType[] = [];

  if (before.planId !== after.planId) changes.push('plan');
  if (before.enPrueba !== after.enPrueba || before.trialStatus !== after.trialStatus) {
    changes.push('trial');
  }
  if (before.estadoSuscripcion !== after.estadoSuscripcion) changes.push('status');

  const prevSub = pickSubscriptionSnapshot(before.suscripcion);
  const nextSub = pickSubscriptionSnapshot(after.suscripcion);
  const subJsonBefore = JSON.stringify(prevSub ?? {});
  const subJsonAfter = JSON.stringify(nextSub ?? {});
  if (subJsonBefore !== subJsonAfter) {
    if (
      prevSub?.modulosOverride !== nextSub?.modulosOverride ||
      JSON.stringify(prevSub?.modulosOverride) !== JSON.stringify(nextSub?.modulosOverride)
    ) {
      changes.push('modules');
    }
    if (
      prevSub?.precioBaseOverride !== nextSub?.precioBaseOverride ||
      prevSub?.precioPorAdministradorOverride !== nextSub?.precioPorAdministradorOverride ||
      prevSub?.precioPorOperadorOverride !== nextSub?.precioPorOperadorOverride ||
      prevSub?.descuentoMensual !== nextSub?.descuentoMensual ||
      JSON.stringify(prevSub?.preciosAddonModuloOverride) !==
        JSON.stringify(nextSub?.preciosAddonModuloOverride)
    ) {
      changes.push('pricing');
    }
    if (
      prevSub?.limiteAdministradores !== nextSub?.limiteAdministradores ||
      prevSub?.limiteOperadores !== nextSub?.limiteOperadores ||
      prevSub?.limiteUsuariosTotal !== nextSub?.limiteUsuariosTotal ||
      prevSub?.maxAmbitosCaja !== nextSub?.maxAmbitosCaja
    ) {
      changes.push('limits');
    }
    if (!changes.includes('modules') && !changes.includes('pricing') && !changes.includes('limits')) {
      changes.push('general');
    }
  }

  if (changes.length === 0 && !note) return;

  await appendSubscriptionHistory(businessId, {
    changedBy,
    changeType: changes[0] ?? 'general',
    note,
    previousPlanId: before.planId,
    newPlanId: after.planId,
    previousTrialStatus: before.trialStatus ?? null,
    newTrialStatus: after.trialStatus ?? null,
    previousEnPrueba: before.enPrueba === true,
    newEnPrueba: after.enPrueba === true,
    previousSuscripcion: prevSub,
    newSuscripcion: nextSub,
  });
}
