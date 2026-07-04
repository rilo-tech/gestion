import { db } from '../firebase.ts';
import type { PlanRecord } from './plans.ts';
import type { BusinessSubscriptionRecord } from './subscription-entitlements.ts';
import { listBusinesses } from './business.ts';

export type FrozenPlanSnapshot = {
  modulosIncluidos: PlanRecord['modulosIncluidos'];
  precioBaseMensual: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  preciosAddonModulo: PlanRecord['preciosAddonModulo'];
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  maxAmbitosCaja: number;
};

export function buildFrozenPlanSnapshot(plan: PlanRecord): FrozenPlanSnapshot {
  return {
    modulosIncluidos: { ...plan.modulosIncluidos },
    precioBaseMensual: plan.precioBaseMensual,
    precioPorAdministrador: plan.precioPorAdministrador,
    precioPorOperador: plan.precioPorOperador,
    preciosAddonModulo: { ...plan.preciosAddonModulo },
    limiteAdministradores: plan.limiteAdministradores,
    limiteOperadores: plan.limiteOperadores,
    limiteUsuariosTotal: plan.limiteUsuariosTotal,
    maxAmbitosCaja: plan.maxAmbitosCaja,
  };
}

export async function countBusinessesOnPlan(planId: string): Promise<number> {
  const businesses = await listBusinesses();
  return businesses.filter((business) => business.planId === planId).length;
}

export async function freezePlanForExistingBusinesses(
  planId: string,
  plan: PlanRecord
): Promise<number> {
  const snapshot = buildFrozenPlanSnapshot(plan);
  const businesses = (await listBusinesses()).filter((b) => b.planId === planId);
  let updated = 0;

  for (const business of businesses) {
    if (business.suscripcion?.planFrozen) continue;
    const suscripcion: BusinessSubscriptionRecord = {
      ...(business.suscripcion ?? {}),
      planFrozen: snapshot,
    };
    await db.collection('negocios').doc(business.id).update({
      suscripcion,
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }

  return updated;
}

export async function clearFrozenPlanForBusinesses(planId: string): Promise<number> {
  const businesses = (await listBusinesses()).filter((b) => b.planId === planId);
  let updated = 0;

  for (const business of businesses) {
    if (!business.suscripcion?.planFrozen) continue;
    const { planFrozen: _removed, ...rest } = business.suscripcion;
    await db.collection('negocios').doc(business.id).update({
      suscripcion: rest,
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }

  return updated;
}
