import { db } from '../firebase.ts';

export const DEFAULT_PLAN_ID = 'plan_basico';

export interface PlanRecord {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  precioMensual: number;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicPlanInfo {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  precioMensual: number;
  activo: boolean;
}

const DEFAULT_PLANS: Omit<PlanRecord, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'plan_basico',
    nombre: 'Plan Básico',
    limiteAdministradores: 1,
    limiteOperadores: 2,
    limiteUsuariosTotal: 3,
    precioMensual: 15000,
    activo: true,
  },
  {
    id: 'plan_profesional',
    nombre: 'Plan Profesional',
    limiteAdministradores: 2,
    limiteOperadores: 5,
    limiteUsuariosTotal: 7,
    precioMensual: 35000,
    activo: true,
  },
  {
    id: 'plan_premium',
    nombre: 'Plan Premium',
    limiteAdministradores: 3,
    limiteOperadores: 10,
    limiteUsuariosTotal: 13,
    precioMensual: 65000,
    activo: true,
  },
];

function plansCollection() {
  return db.collection('planes');
}

function mapPlan(id: string, data: Record<string, unknown>): PlanRecord {
  const limiteAdministradores =
    typeof data.limiteAdministradores === 'number' && data.limiteAdministradores >= 0
      ? data.limiteAdministradores
      : 1;
  const limiteOperadores =
    typeof data.limiteOperadores === 'number' && data.limiteOperadores >= 0
      ? data.limiteOperadores
      : 0;
  const limiteUsuariosTotal =
    typeof data.limiteUsuariosTotal === 'number' && data.limiteUsuariosTotal > 0
      ? data.limiteUsuariosTotal
      : limiteAdministradores + limiteOperadores;

  return {
    id,
    nombre: String(data.nombre ?? id).trim(),
    limiteAdministradores,
    limiteOperadores,
    limiteUsuariosTotal,
    precioMensual: Math.max(0, Number(data.precioMensual) || 0),
    activo: data.activo !== false,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
}

export function toPublicPlanInfo(plan: PlanRecord): PublicPlanInfo {
  return {
    id: plan.id,
    nombre: plan.nombre,
    limiteAdministradores: plan.limiteAdministradores,
    limiteOperadores: plan.limiteOperadores,
    limiteUsuariosTotal: plan.limiteUsuariosTotal,
    precioMensual: plan.precioMensual,
    activo: plan.activo,
  };
}

export async function ensureDefaultPlans(): Promise<void> {
  const col = plansCollection();
  for (const plan of DEFAULT_PLANS) {
    const ref = col.doc(plan.id);
    const doc = await ref.get();
    if (doc.exists) continue;

    await ref.set({
      ...plan,
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getPlan(planId: string): Promise<PlanRecord | null> {
  const doc = await plansCollection().doc(planId).get();
  if (!doc.exists) return null;
  return mapPlan(doc.id, doc.data() as Record<string, unknown>);
}

export async function getPlanOrDefault(planId: string): Promise<PlanRecord> {
  await ensureDefaultPlans();
  const plan = await getPlan(planId);
  if (plan) return plan;

  const fallback = await getPlan(DEFAULT_PLAN_ID);
  if (fallback) return fallback;

  throw new Error('PLAN_NOT_FOUND');
}

export async function listPlans(activeOnly = false): Promise<PlanRecord[]> {
  await ensureDefaultPlans();
  const snapshot = await plansCollection().get();
  return snapshot.docs
    .map((doc) => mapPlan(doc.id, doc.data() as Record<string, unknown>))
    .filter((plan) => (activeOnly ? plan.activo : true))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function createPlan(
  planId: string,
  payload: Omit<PlanRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PlanRecord> {
  const ref = plansCollection().doc(planId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('PLAN_EXISTS');
  }

  const record = {
    nombre: payload.nombre.trim(),
    limiteAdministradores: payload.limiteAdministradores,
    limiteOperadores: payload.limiteOperadores,
    limiteUsuariosTotal:
      payload.limiteUsuariosTotal > 0
        ? payload.limiteUsuariosTotal
        : payload.limiteAdministradores + payload.limiteOperadores,
    precioMensual: Math.max(0, Number(payload.precioMensual) || 0),
    activo: payload.activo !== false,
    createdAt: new Date().toISOString(),
  };

  await ref.set(record);
  return mapPlan(planId, record);
}

export async function updatePlan(
  planId: string,
  payload: Partial<Omit<PlanRecord, 'id' | 'createdAt'>>
): Promise<PlanRecord> {
  const ref = plansCollection().doc(planId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('PLAN_NOT_FOUND');
  }

  const current = mapPlan(doc.id, doc.data() as Record<string, unknown>);
  const next = {
    nombre:
      typeof payload.nombre === 'string' && payload.nombre.trim()
        ? payload.nombre.trim()
        : current.nombre,
    limiteAdministradores:
      typeof payload.limiteAdministradores === 'number'
        ? payload.limiteAdministradores
        : current.limiteAdministradores,
    limiteOperadores:
      typeof payload.limiteOperadores === 'number'
        ? payload.limiteOperadores
        : current.limiteOperadores,
    limiteUsuariosTotal:
      typeof payload.limiteUsuariosTotal === 'number'
        ? payload.limiteUsuariosTotal
        : current.limiteUsuariosTotal,
    precioMensual:
      typeof payload.precioMensual === 'number'
        ? Math.max(0, payload.precioMensual)
        : current.precioMensual,
    activo: payload.activo !== undefined ? payload.activo !== false : current.activo,
    updatedAt: new Date().toISOString(),
  };

  await ref.update(next);
  const updated = await ref.get();
  return mapPlan(updated.id, updated.data() as Record<string, unknown>);
}

export function resolveLegacyPlanId(plan: unknown): string {
  if (plan === 'profesional') return 'plan_profesional';
  if (plan === 'empresa' || plan === 'premium') return 'plan_premium';
  return DEFAULT_PLAN_ID;
}
