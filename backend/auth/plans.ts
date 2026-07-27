import { db } from '../firebase.ts';

export const DEFAULT_PLAN_ID = 'plan_basico';

import {
  DEFAULT_PLAN_MODULES,
  emptyModulesMap,
  normalizeModulesMap,
  type SubscriptionModuleId,
  type SubscriptionModulesMap,
} from '../../shared/subscription-modules.ts';
import { getErpPlanTemplatePrices } from '../../shared/billing-catalog.ts';

export interface PlanRecord {
  id: string;
  nombre: string;
  limiteAdministradores: number;
  limiteOperadores: number;
  limiteUsuariosTotal: number;
  /** @deprecated Usar precioBaseMensual. Se mantiene por compatibilidad. */
  precioMensual: number;
  precioBaseMensual: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  modulosIncluidos: SubscriptionModulesMap;
  preciosAddonModulo: Partial<Record<SubscriptionModuleId, number>>;
  maxAmbitosCaja: number;
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
  precioBaseMensual: number;
  precioPorAdministrador: number;
  precioPorOperador: number;
  modulosIncluidos: SubscriptionModulesMap;
  preciosAddonModulo: Partial<Record<SubscriptionModuleId, number>>;
  maxAmbitosCaja: number;
  activo: boolean;
}

function landingPrices(planId: string) {
  return getErpPlanTemplatePrices(planId, 'UY');
}

const basicoPrices = landingPrices('plan_basico');
const intermedioPrices = landingPrices('plan_intermedio');
const profesionalPrices = landingPrices('plan_profesional');

const DEFAULT_PLANS: Omit<PlanRecord, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'plan_basico',
    nombre: 'RiloBot (WhatsApp)',
    limiteAdministradores: 1,
    limiteOperadores: 0,
    limiteUsuariosTotal: 1,
    precioMensual: basicoPrices?.precioBaseMensual ?? 1490,
    precioBaseMensual: basicoPrices?.precioBaseMensual ?? 1490,
    precioPorAdministrador: 0,
    precioPorOperador: basicoPrices?.precioPorOperador ?? 490,
    modulosIncluidos: DEFAULT_PLAN_MODULES.plan_basico,
    preciosAddonModulo: {},
    maxAmbitosCaja: 0,
    activo: true,
  },
  {
    id: 'plan_intermedio',
    nombre: 'Panel web',
    limiteAdministradores: 1,
    limiteOperadores: 0,
    limiteUsuariosTotal: 1,
    precioMensual: intermedioPrices?.precioBaseMensual ?? 2490,
    precioBaseMensual: intermedioPrices?.precioBaseMensual ?? 2490,
    precioPorAdministrador: 0,
    precioPorOperador: intermedioPrices?.precioPorOperador ?? 490,
    modulosIncluidos: DEFAULT_PLAN_MODULES.plan_intermedio,
    preciosAddonModulo: {},
    maxAmbitosCaja: 1,
    activo: true,
  },
  {
    id: 'plan_profesional',
    nombre: 'RiloBot + Panel',
    limiteAdministradores: 1,
    limiteOperadores: 0,
    limiteUsuariosTotal: 2,
    precioMensual: profesionalPrices?.precioBaseMensual ?? 3490,
    precioBaseMensual: profesionalPrices?.precioBaseMensual ?? 3490,
    precioPorAdministrador: 0,
    precioPorOperador: profesionalPrices?.precioPorOperador ?? 490,
    modulosIncluidos: DEFAULT_PLAN_MODULES.plan_profesional,
    preciosAddonModulo: {},
    maxAmbitosCaja: 2,
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

  const precioBaseMensual = Math.max(
    0,
    Number(data.precioBaseMensual ?? data.precioMensual) || 0
  );

  return {
    id,
    nombre: String(data.nombre ?? id).trim(),
    limiteAdministradores,
    limiteOperadores,
    limiteUsuariosTotal,
    precioMensual: precioBaseMensual,
    precioBaseMensual,
    precioPorAdministrador: Math.max(0, Number(data.precioPorAdministrador) || 0),
    precioPorOperador: Math.max(0, Number(data.precioPorOperador) || 0),
    modulosIncluidos: normalizeModulesMap(
      data.modulosIncluidos as Partial<Record<string, boolean>> | undefined,
      id
    ),
    preciosAddonModulo:
      (data.preciosAddonModulo as Partial<Record<SubscriptionModuleId, number>>) ?? {},
    maxAmbitosCaja: Math.max(0, Number(data.maxAmbitosCaja) || 0),
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
    precioMensual: plan.precioBaseMensual,
    precioBaseMensual: plan.precioBaseMensual,
    precioPorAdministrador: plan.precioPorAdministrador,
    precioPorOperador: plan.precioPorOperador,
    modulosIncluidos: plan.modulosIncluidos,
    preciosAddonModulo: plan.preciosAddonModulo,
    maxAmbitosCaja: plan.maxAmbitosCaja,
    activo: plan.activo,
  };
}

/** Alinea plantillas ERP con precios de la landing (UY). No toca empresas existentes. */
export async function syncPlanTemplatesFromLandingCatalog(): Promise<PlanRecord[]> {
  const col = plansCollection();
  const now = new Date().toISOString();
  const updated: PlanRecord[] = [];

  for (const plan of DEFAULT_PLANS) {
    const landing = getErpPlanTemplatePrices(plan.id, 'UY');
    const ref = col.doc(plan.id);
    const doc = await ref.get();
    const payload = {
      nombre: plan.nombre,
      precioMensual: landing?.precioBaseMensual ?? plan.precioBaseMensual,
      precioBaseMensual: landing?.precioBaseMensual ?? plan.precioBaseMensual,
      precioPorAdministrador: landing?.precioPorAdministrador ?? plan.precioPorAdministrador,
      precioPorOperador: landing?.precioPorOperador ?? plan.precioPorOperador,
      limiteAdministradores: plan.limiteAdministradores,
      limiteOperadores: plan.limiteOperadores,
      limiteUsuariosTotal: plan.limiteUsuariosTotal,
      maxAmbitosCaja: plan.maxAmbitosCaja,
      modulosIncluidos: plan.modulosIncluidos,
      activo: true,
      updatedAt: now,
    };

    if (doc.exists) {
      await ref.set(payload, { merge: true });
    } else {
      await ref.set({
        ...plan,
        ...payload,
        preciosAddonModulo: plan.preciosAddonModulo,
        createdAt: now,
      });
    }
    planCache.delete(plan.id);
    const fresh = await getPlan(plan.id);
    if (fresh) updated.push(fresh);
  }

  return updated;
}

export async function ensureDefaultPlans(): Promise<void> {
  const col = plansCollection();
  for (const plan of DEFAULT_PLANS) {
    const ref = col.doc(plan.id);
    const doc = await ref.get();
    if (doc.exists) {
      const data = doc.data() as Record<string, unknown> | undefined;
      const modules = normalizeModulesMap(
        data?.modulosIncluidos as Partial<Record<string, boolean>> | undefined,
        plan.id
      );
      const patch: Record<string, unknown> = {};
      if (modules.pedidos && modules.order_photos !== true) {
        patch.modulosIncluidos = { ...modules, order_photos: true };
      }
      // Migra plantillas con precios legacy (15k–35k) o módulos viejos a catálogo landing.
      const currentBase = Number(data?.precioBaseMensual ?? data?.precioMensual) || 0;
      const landing = getErpPlanTemplatePrices(plan.id, 'UY');
      if (currentBase >= 10000 && landing) {
        patch.nombre = plan.nombre;
        patch.precioMensual = landing.precioBaseMensual;
        patch.precioBaseMensual = landing.precioBaseMensual;
        patch.precioPorAdministrador = landing.precioPorAdministrador;
        patch.precioPorOperador = landing.precioPorOperador;
        patch.limiteAdministradores = plan.limiteAdministradores;
        patch.limiteOperadores = plan.limiteOperadores;
        patch.limiteUsuariosTotal = plan.limiteUsuariosTotal;
      }
      // Siempre alinear módulos a prueba = todo menos colaboradores/reportes.
      const modulesEqual =
        modules.collaborators === plan.modulosIncluidos.collaborators &&
        modules.reports === plan.modulosIncluidos.reports &&
        modules.caja === plan.modulosIncluidos.caja &&
        modules.payables === plan.modulosIncluidos.payables;
      if (!modulesEqual) {
        patch.modulosIncluidos = plan.modulosIncluidos;
      }
      if (Object.keys(patch).length) {
        patch.updatedAt = new Date().toISOString();
        await ref.update(patch);
        planCache.delete(plan.id);
      }
      continue;
    }

    await ref.set({
      ...plan,
      createdAt: new Date().toISOString(),
    });
  }

  await migratePremiumIntoProfesional();
}

let premiumMigrationDone = false;

/** Unifica plan_premium en plan_profesional (plantilla única de plan alto). */
export async function migratePremiumIntoProfesional(): Promise<void> {
  if (premiumMigrationDone) return;
  premiumMigrationDone = true;

  const premiumRef = plansCollection().doc('plan_premium');
  const premiumDoc = await premiumRef.get();
  if (premiumDoc.exists) {
    await premiumRef.set(
      {
        activo: false,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  const { listBusinesses } = await import('./business.ts');
  const businesses = await listBusinesses();
  const now = new Date().toISOString();
  for (const business of businesses) {
    if (business.planId !== 'plan_premium') continue;
    await db.collection('negocios').doc(business.id).update({
      planId: 'plan_profesional',
      updatedAt: now,
    });
  }
}

export async function getPlan(planId: string): Promise<PlanRecord | null> {
  const doc = await plansCollection().doc(planId).get();
  if (!doc.exists) return null;
  return mapPlan(doc.id, doc.data() as Record<string, unknown>);
}

let defaultPlansEnsured = false;
const planCache = new Map<string, PlanRecord>();

async function ensureDefaultPlansOnce(): Promise<void> {
  if (defaultPlansEnsured) return;
  await ensureDefaultPlans();
  defaultPlansEnsured = true;
}

export async function getPlanOrDefault(planId: string): Promise<PlanRecord> {
  const cached = planCache.get(planId);
  if (cached) return cached;

  await ensureDefaultPlansOnce();

  const plan = (await getPlan(planId)) ?? (await getPlan(DEFAULT_PLAN_ID));
  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }

  planCache.set(plan.id, plan);
  return plan;
}

export async function preloadPlans(): Promise<Map<string, PlanRecord>> {
  await ensureDefaultPlansOnce();
  const snapshot = await plansCollection().get();
  const map = new Map<string, PlanRecord>();
  for (const doc of snapshot.docs) {
    const plan = mapPlan(doc.id, doc.data() as Record<string, unknown>);
    map.set(plan.id, plan);
    planCache.set(plan.id, plan);
  }
  return map;
}

export async function listPlans(activeOnly = false): Promise<PlanRecord[]> {
  await ensureDefaultPlans();
  const snapshot = await plansCollection().get();
  return snapshot.docs
    .map((doc) => mapPlan(doc.id, doc.data() as Record<string, unknown>))
    .filter((plan) => (activeOnly ? plan.activo : true))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export type CreatePlanPayload = Omit<PlanRecord, 'id' | 'createdAt' | 'updatedAt'>;

export async function createPlan(
  planId: string,
  payload: CreatePlanPayload
): Promise<PlanRecord> {
  const ref = plansCollection().doc(planId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('PLAN_EXISTS');
  }

  const precioBaseMensual = Math.max(
    0,
    Number(payload.precioBaseMensual ?? payload.precioMensual) || 0
  );

  const record = {
    nombre: payload.nombre.trim(),
    limiteAdministradores: payload.limiteAdministradores,
    limiteOperadores: payload.limiteOperadores,
    limiteUsuariosTotal:
      payload.limiteUsuariosTotal > 0
        ? payload.limiteUsuariosTotal
        : payload.limiteAdministradores + payload.limiteOperadores,
    precioMensual: precioBaseMensual,
    precioBaseMensual,
    precioPorAdministrador: Math.max(0, Number(payload.precioPorAdministrador) || 0),
    precioPorOperador: Math.max(0, Number(payload.precioPorOperador) || 0),
    modulosIncluidos: normalizeModulesMap(payload.modulosIncluidos, planId),
    preciosAddonModulo: payload.preciosAddonModulo ?? {},
    maxAmbitosCaja: Math.max(0, Number(payload.maxAmbitosCaja) || 0),
    activo: payload.activo !== false,
    createdAt: new Date().toISOString(),
  };

  await ref.set(record);
  planCache.delete(planId);
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
  const precioBaseMensual =
    typeof payload.precioBaseMensual === 'number'
      ? Math.max(0, payload.precioBaseMensual)
      : typeof payload.precioMensual === 'number'
        ? Math.max(0, payload.precioMensual)
        : current.precioBaseMensual;

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
    precioMensual: precioBaseMensual,
    precioBaseMensual,
    precioPorAdministrador:
      typeof payload.precioPorAdministrador === 'number'
        ? Math.max(0, payload.precioPorAdministrador)
        : current.precioPorAdministrador,
    precioPorOperador:
      typeof payload.precioPorOperador === 'number'
        ? Math.max(0, payload.precioPorOperador)
        : current.precioPorOperador,
    modulosIncluidos:
      payload.modulosIncluidos !== undefined
        ? normalizeModulesMap(payload.modulosIncluidos, planId)
        : current.modulosIncluidos,
    preciosAddonModulo:
      payload.preciosAddonModulo !== undefined
        ? payload.preciosAddonModulo
        : current.preciosAddonModulo,
    maxAmbitosCaja:
      typeof payload.maxAmbitosCaja === 'number'
        ? Math.max(0, payload.maxAmbitosCaja)
        : current.maxAmbitosCaja,
    activo: payload.activo !== undefined ? payload.activo !== false : current.activo,
    updatedAt: new Date().toISOString(),
  };

  await ref.update(next);
  planCache.delete(planId);
  const updated = await ref.get();
  return mapPlan(updated.id, updated.data() as Record<string, unknown>);
}

export function resolveLegacyPlanId(plan: unknown): string {
  if (plan === 'profesional' || plan === 'intermedio') return 'plan_profesional';
  if (plan === 'empresa' || plan === 'premium') return 'plan_profesional';
  return DEFAULT_PLAN_ID;
}

export { emptyModulesMap };
