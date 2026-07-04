import { db } from '../firebase.ts';
import { DEFAULT_BUSINESS_ID } from './constants.ts';
import type { UserRole } from './constants.ts';
import {
  countActiveAdministrators,
  countActiveOperators,
  countActiveUsers,
  getActiveUserCounts,
} from './users.ts';
import {
  DEFAULT_PLAN_ID,
  getPlanOrDefault,
  preloadPlans,
  resolveLegacyPlanId,
  toPublicPlanInfo,
  type PlanRecord,
  type PublicPlanInfo,
} from './plans.ts';
import {
  parseBusinessSubscription,
  resolveBusinessSubscription,
  sanitizeBusinessSubscriptionPayload,
  type BusinessSubscriptionRecord,
  type ResolvedBusinessSubscription,
} from './subscription-entitlements.ts';
import type {
  ModuleOverridesMap,
  MonthlyFeeBreakdown,
  SubscriptionModulesMap,
} from '../../shared/subscription-modules.ts';
import {
  getSubscriptionPaymentSummary,
  currentPeriodo,
  type SubscriptionPaymentRecord,
  type SubscriptionPaymentStatus,
} from './subscription-payments.ts';
import {
  buildTrialFieldUpdates,
  isTrialActiveForBilling,
  syncExpiredTrialStatus,
} from './trial-business.ts';
import { buildFrozenPlanSnapshot } from './plan-snapshot.ts';
import { resolveTrialState } from '../../shared/trial-state.ts';
import type {
  TrialContactVerification,
  TrialLifecycle,
  BusinessSource,
} from '../../shared/trial-registration.ts';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export type TrialStatus = import('../../shared/trial-state.ts').TrialStatus;

export interface BusinessRecord {
  id: string;
  nombre: string;
  planId: string;
  estadoSuscripcion: SubscriptionStatus;
  /** Período de prueba comercial (no altera módulos ni config del cliente). */
  enPrueba?: boolean;
  trialStartDate?: string;
  trialEndDate?: string;
  trialStatus?: TrialStatus | null;
  source?: BusinessSource;
  contactVerification?: TrialContactVerification;
  lifecycle?: TrialLifecycle;
  suscripcion?: BusinessSubscriptionRecord;
  creadoPor?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PublicBusinessSubscription = BusinessSubscriptionRecord;

export interface PublicBusinessInfo {
  id: string;
  nombre: string;
  planId: string;
  plan: PublicPlanInfo;
  estadoSuscripcion: SubscriptionStatus;
  estadoPago: SubscriptionPaymentStatus;
  periodoPagoActual: string;
  montoMensualEsperado: number;
  cuotaDesglose: MonthlyFeeBreakdown;
  entitlements: SubscriptionModulesMap;
  modulosOverride: ModuleOverridesMap;
  limitesEfectivos: {
    limiteAdministradores: number;
    limiteOperadores: number;
    limiteUsuariosTotal: number;
    maxAmbitosCaja: number;
  };
  suscripcion: PublicBusinessSubscription;
  ultimoPagoPeriodo?: string;
  ultimoPagoFecha?: string;
  ultimoPagoMonto?: number;
  enPrueba: boolean;
  trialStartDate?: string | null;
  trialEndDate?: string | null;
  trialStatus?: TrialStatus | null;
  trialDaysRemaining?: number | null;
  trialExpiringSoon?: boolean;
  trialBillingActive?: boolean;
  source?: BusinessSource;
  contactVerification?: TrialContactVerification;
  lifecycle?: TrialLifecycle;
  createdAt?: string;
  administradoresActivos: number;
  operadoresActivos: number;
  usuariosActivos: number;
  administradoresDisponibles: number;
  operadoresDisponibles: number;
  usuariosDisponibles: number;
}

export type { SubscriptionPaymentRecord, SubscriptionPaymentStatus };

const BUSINESS_MUTABLE_FIELDS = new Set([
  'nombre',
  'planId',
  'estadoSuscripcion',
  'enPrueba',
  'trialStartDate',
  'trialEndDate',
  'trialStatus',
  'creadoPor',
  'updatedAt',
]);

function omitUndefinedFields<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function businessRef(businessId: string) {
  return db.collection('negocios').doc(businessId);
}

function normalizeStatus(status: unknown): SubscriptionStatus {
  if (status === 'suspendida' || status === 'vencida') return status;
  return 'activa';
}

function resolvePlanId(data: Record<string, unknown>): string {
  if (typeof data.planId === 'string' && data.planId.trim()) {
    return data.planId.trim();
  }
  return resolveLegacyPlanId(data.plan);
}

function mapBusiness(id: string, data: Record<string, unknown>): BusinessRecord {
  return {
    id,
    nombre: String(data.nombre ?? id).trim(),
    planId: resolvePlanId(data),
    estadoSuscripcion: normalizeStatus(data.estadoSuscripcion),
    enPrueba: data.enPrueba === true,
    trialStartDate:
      typeof data.trialStartDate === 'string' ? data.trialStartDate.slice(0, 10) : undefined,
    trialEndDate:
      typeof data.trialEndDate === 'string' ? data.trialEndDate.slice(0, 10) : undefined,
    trialStatus:
      data.trialStatus === 'active' ||
      data.trialStatus === 'expired' ||
      data.trialStatus === 'converted' ||
      data.trialStatus === 'cancelled'
        ? data.trialStatus
        : undefined,
    source:
      data.source === 'self_service_trial' ||
      data.source === 'manual_platform' ||
      data.source === 'imported'
        ? data.source
        : undefined,
    contactVerification:
      data.contactVerification && typeof data.contactVerification === 'object'
        ? (data.contactVerification as TrialContactVerification)
        : undefined,
    lifecycle:
      data.lifecycle && typeof data.lifecycle === 'object'
        ? (data.lifecycle as TrialLifecycle)
        : undefined,
    suscripcion: parseBusinessSubscription(data),
    creadoPor: data.creadoPor ? String(data.creadoPor) : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
}

async function resolveForBusiness(
  business: BusinessRecord,
  plan?: PlanRecord
): Promise<{ plan: PlanRecord; resolved: ResolvedBusinessSubscription }> {
  const resolvedPlan = plan ?? (await getPlanOrDefault(business.planId));
  const resolved = resolveBusinessSubscription(
    resolvedPlan,
    business.suscripcion ?? {}
  );
  return { plan: resolvedPlan, resolved };
}

export function isAdministratorRole(rol: UserRole): boolean {
  return rol === 'supervisor' || rol === 'admin';
}

export function sanitizeBusinessPayload(
  payload: Record<string, unknown>,
  options?: { allowSubscriptionFields?: boolean }
): Partial<BusinessRecord> {
  const allowSubscription = options?.allowSubscriptionFields === true;
  const next: Partial<BusinessRecord> = {};

  if (typeof payload.nombre === 'string' && payload.nombre.trim()) {
    next.nombre = payload.nombre.trim();
  }

  if (allowSubscription) {
    if (typeof payload.planId === 'string' && payload.planId.trim()) {
      next.planId = payload.planId.trim();
    } else if (payload.plan !== undefined) {
      next.planId = resolveLegacyPlanId(payload.plan);
    }
    if (payload.estadoSuscripcion !== undefined) {
      next.estadoSuscripcion = normalizeStatus(payload.estadoSuscripcion);
    }
    if (payload.enPrueba !== undefined) {
      next.enPrueba = payload.enPrueba === true;
    }
    if (
      payload.trialStartDate !== undefined ||
      payload.trialEndDate !== undefined ||
      payload.trialStatus !== undefined
    ) {
      Object.assign(next, buildTrialFieldUpdates(payload, undefined));
    }
  }

  return next;
}

export async function getBusiness(
  businessId: string
): Promise<BusinessRecord | null> {
  const doc = await businessRef(businessId).get();
  if (!doc.exists) return null;
  return mapBusiness(doc.id, doc.data() as Record<string, unknown>);
}

export async function getBusinessPlan(businessId: string): Promise<PlanRecord> {
  const business =
    (await getBusiness(businessId)) ?? (await ensureDefaultBusiness(businessId));
  return getPlanOrDefault(business.planId);
}

export async function getBusinessSubscription(
  businessId: string
): Promise<ResolvedBusinessSubscription> {
  const business =
    (await getBusiness(businessId)) ?? (await ensureDefaultBusiness(businessId));
  const { resolved } = await resolveForBusiness(business);
  return resolved;
}

export async function ensureDefaultBusiness(
  businessId = DEFAULT_BUSINESS_ID
): Promise<BusinessRecord> {
  const ref = businessRef(businessId);
  const doc = await ref.get();
  if (doc.exists) {
    const business = mapBusiness(doc.id, doc.data() as Record<string, unknown>);
    if (!doc.data()?.planId) {
      await ref.update({
        planId: business.planId,
        updatedAt: new Date().toISOString(),
      });
    }
    return business;
  }

  const payload = {
    nombre: 'Rilo Gestión (demo)',
    planId: DEFAULT_PLAN_ID,
    estadoSuscripcion: 'activa' as SubscriptionStatus,
    creadoPor: 'system',
    createdAt: new Date().toISOString(),
  };
  await ref.set(payload);
  return mapBusiness(businessId, payload);
}

export async function createBusiness(
  businessId: string,
  payload: {
    nombre: string;
    planId?: string;
    estadoSuscripcion?: SubscriptionStatus;
    enPrueba?: boolean;
    trialStartDate?: string;
    trialEndDate?: string;
    trialStatus?: TrialStatus | null;
    creadoPor?: string;
    source?: BusinessSource;
    contactVerification?: TrialContactVerification;
    lifecycle?: TrialLifecycle;
  }
): Promise<BusinessRecord> {
  const ref = businessRef(businessId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('BUSINESS_EXISTS');
  }

  const planId = payload.planId?.trim() || DEFAULT_PLAN_ID;
  await getPlanOrDefault(planId);

  const trialFields = buildTrialFieldUpdates(
    {
      enPrueba: payload.enPrueba,
      trialStartDate: payload.trialStartDate,
      trialEndDate: payload.trialEndDate,
      trialStatus: payload.trialStatus,
    },
    undefined
  );

  const record = {
    nombre: payload.nombre.trim(),
    planId,
    estadoSuscripcion: normalizeStatus(payload.estadoSuscripcion ?? 'activa'),
    enPrueba: payload.enPrueba === true,
    ...trialFields,
    creadoPor: payload.creadoPor ?? 'platform',
    source: payload.source ?? 'manual_platform',
    ...(payload.contactVerification ? { contactVerification: payload.contactVerification } : {}),
    ...(payload.lifecycle ? { lifecycle: payload.lifecycle } : {}),
    createdAt: new Date().toISOString(),
  };

  await ref.set(record);
  return mapBusiness(businessId, record);
}

export async function updateBusiness(
  businessId: string,
  payload: Partial<BusinessRecord> & { suscripcion?: BusinessSubscriptionRecord },
  options?: { allowSubscriptionFields?: boolean; changedBy?: string; historyNote?: string }
): Promise<BusinessRecord> {
  const ref = businessRef(businessId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('BUSINESS_NOT_FOUND');
  }
  const before = mapBusiness(doc.id, doc.data() as Record<string, unknown>);

  const sanitized = sanitizeBusinessPayload(
    payload as Record<string, unknown>,
    options
  );

  if (sanitized.planId) {
    await getPlanOrDefault(sanitized.planId);
  }

  const subscriptionPatch = sanitizeBusinessSubscriptionPayload(
    payload as Record<string, unknown>
  );

  const trialUpdates = buildTrialFieldUpdates(payload as Record<string, unknown>, before);

  const updates: Record<string, unknown> = {
    ...sanitized,
    ...trialUpdates,
    updatedAt: new Date().toISOString(),
  };

  Object.keys(updates).forEach((key) => {
    if (key === 'updatedAt' || key === 'suscripcion') return;
    if (!BUSINESS_MUTABLE_FIELDS.has(key)) {
      delete updates[key];
    }
  });

  if (subscriptionPatch && options?.allowSubscriptionFields) {
    const current = parseBusinessSubscription(doc.data() as Record<string, unknown>);
    const effectivePlanId = sanitized.planId ?? before.planId;
    const plan = await getPlanOrDefault(effectivePlanId);
    const planChanged = Boolean(sanitized.planId && sanitized.planId !== before.planId);
    const mergedSub: BusinessSubscriptionRecord = {
      ...current,
      ...subscriptionPatch,
    };

    if (planChanged || !current.planFrozen) {
      mergedSub.planFrozen = buildFrozenPlanSnapshot(plan);
    }

    updates.suscripcion = omitUndefinedFields(mergedSub);
  }

  await ref.update(updates);
  let after = mapBusiness(businessId, (await ref.get()).data() as Record<string, unknown>);
  after = await syncExpiredTrialStatus(after);

  if (options?.allowSubscriptionFields) {
    const { recordBusinessSubscriptionChange } = await import('./subscription-history.ts');
    await recordBusinessSubscriptionChange({
      businessId,
      changedBy: options.changedBy,
      before,
      after,
      note: options.historyNote,
    });
  }

  return after;
}

export async function listBusinesses(): Promise<BusinessRecord[]> {
  const snapshot = await db.collection('negocios').get();
  return snapshot.docs
    .map((doc) => mapBusiness(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

type PublicBusinessInfoOptions = {
  business?: BusinessRecord;
  plan?: PlanRecord;
  includePayments?: boolean;
  includeUsage?: boolean;
};

function buildPublicBusinessInfo(
  business: BusinessRecord,
  plan: PlanRecord,
  resolved: ResolvedBusinessSubscription,
  counts: {
    administradoresActivos: number;
    operadoresActivos: number;
    usuariosActivos: number;
  },
  paymentSummary: {
    estadoPago: SubscriptionPaymentStatus;
    periodoActual: string;
    montoEsperado: number;
    ultimoPagoPeriodo?: string;
    ultimoPagoFecha?: string;
    ultimoPagoMonto?: number;
  }
): PublicBusinessInfo {
  const limits = resolved.limits;
  const trial = resolveTrialState(business);
  return {
    id: business.id,
    nombre: business.nombre,
    planId: plan.id,
    plan: toPublicPlanInfo(plan),
    estadoSuscripcion: business.estadoSuscripcion,
    estadoPago: paymentSummary.estadoPago,
    periodoPagoActual: paymentSummary.periodoActual,
    montoMensualEsperado: resolved.montoMensualEsperado,
    cuotaDesglose: resolved.cuota,
    entitlements: resolved.entitlements,
    modulosOverride: resolved.moduleOverrides,
    limitesEfectivos: {
      limiteAdministradores: limits.limiteAdministradores,
      limiteOperadores: limits.limiteOperadores,
      limiteUsuariosTotal: limits.limiteUsuariosTotal,
      maxAmbitosCaja: limits.maxAmbitosCaja,
    },
    suscripcion: resolved.suscripcion,
    ultimoPagoPeriodo: paymentSummary.ultimoPagoPeriodo,
    ultimoPagoFecha: paymentSummary.ultimoPagoFecha,
    ultimoPagoMonto: paymentSummary.ultimoPagoMonto,
    enPrueba: business.enPrueba === true,
    trialStartDate: trial.trialStartDate,
    trialEndDate: trial.trialEndDate,
    trialStatus: trial.trialStatus,
    trialDaysRemaining: trial.daysRemaining,
    trialExpiringSoon: trial.isExpiringSoon,
    trialBillingActive: trial.isTrialBillingActive,
    source: business.source,
    contactVerification: business.contactVerification,
    lifecycle: business.lifecycle,
    createdAt: business.createdAt,
    administradoresActivos: counts.administradoresActivos,
    operadoresActivos: counts.operadoresActivos,
    usuariosActivos: counts.usuariosActivos,
    administradoresDisponibles: Math.max(
      0,
      limits.limiteAdministradores - counts.administradoresActivos
    ),
    operadoresDisponibles: Math.max(0, limits.limiteOperadores - counts.operadoresActivos),
    usuariosDisponibles: Math.max(0, limits.limiteUsuariosTotal - counts.usuariosActivos),
  };
}

/** Respuesta inmediata al crear empresa (sin consultas extra). */
export function buildNewBusinessPublicInfo(
  business: BusinessRecord,
  plan: PlanRecord
): PublicBusinessInfo {
  const resolved = resolveBusinessSubscription(plan, business.suscripcion ?? {});
  return buildPublicBusinessInfo(
    business,
    plan,
    resolved,
    {
      administradoresActivos: 1,
      operadoresActivos: 0,
      usuariosActivos: 1,
    },
    {
      estadoPago: isTrialActiveForBilling(business) ? 'al_dia' : 'pendiente',
      periodoActual: currentPeriodo(),
      montoEsperado: resolved.montoMensualEsperado,
    }
  );
}

export async function toSessionBusinessInfo(
  businessId: string,
  existing?: BusinessRecord | null
): Promise<PublicBusinessInfo> {
  const business =
    existing ?? (await getBusiness(businessId)) ?? (await ensureDefaultBusiness(businessId));
  const { plan, resolved } = await resolveForBusiness(business);
  const periodoActual = currentPeriodo();

  return buildPublicBusinessInfo(
    business,
    plan,
    resolved,
    {
      administradoresActivos: 0,
      operadoresActivos: 0,
      usuariosActivos: 0,
    },
    {
      estadoPago: isTrialActiveForBilling(business) ? 'al_dia' : 'pendiente',
      periodoActual,
      montoEsperado: resolved.montoMensualEsperado,
    }
  );
}

export async function toPublicBusinessInfo(
  businessId: string,
  options?: PublicBusinessInfoOptions
): Promise<PublicBusinessInfo> {
  let business =
    options?.business ??
    (await getBusiness(businessId)) ??
    (await ensureDefaultBusiness(businessId));
  business = await syncExpiredTrialStatus(business);
  const { plan, resolved } = options?.plan
    ? {
        plan: options.plan,
        resolved: resolveBusinessSubscription(options.plan, business.suscripcion ?? {}),
      }
    : await resolveForBusiness(business, options?.plan);
  const includeUsage = options?.includeUsage !== false;
  const includePayments = options?.includePayments !== false;

  const [counts, paymentSummary] = await Promise.all([
    includeUsage
      ? getActiveUserCounts(businessId)
      : Promise.resolve({
          administradoresActivos: 0,
          operadoresActivos: 0,
          usuariosActivos: 0,
        }),
    includePayments
      ? getSubscriptionPaymentSummary(businessId, resolved.montoMensualEsperado)
      : Promise.resolve({
          estadoPago: (isTrialActiveForBilling(business)
            ? 'al_dia'
            : 'pendiente') as SubscriptionPaymentStatus,
          periodoActual: currentPeriodo(),
          montoEsperado: resolved.montoMensualEsperado,
        }),
  ]);

  return buildPublicBusinessInfo(business, plan, resolved, counts, paymentSummary);
}

export async function listPublicBusinessInfos(): Promise<PublicBusinessInfo[]> {
  const businesses = await listBusinesses();
  if (!businesses.length) return [];

  const plansById = await preloadPlans();

  return Promise.all(
    businesses.map(async (business) => {
      const synced = await syncExpiredTrialStatus(business);
      const plan =
        plansById.get(synced.planId) ??
        plansById.get(DEFAULT_PLAN_ID) ??
        (await getPlanOrDefault(synced.planId));
      const resolved = resolveBusinessSubscription(plan, synced.suscripcion ?? {});
      const [counts, paymentSummary] = await Promise.all([
        getActiveUserCounts(synced.id),
        getSubscriptionPaymentSummary(synced.id, resolved.montoMensualEsperado),
      ]);
      return buildPublicBusinessInfo(synced, plan, resolved, counts, paymentSummary);
    })
  );
}

export async function assertBusinessActive(businessId: string): Promise<BusinessRecord> {
  let business = await getBusiness(businessId);
  if (!business && businessId === DEFAULT_BUSINESS_ID) {
    business = await ensureDefaultBusiness(businessId);
  }
  if (!business) {
    throw new Error('BUSINESS_NOT_FOUND');
  }

  if (business.estadoSuscripcion === 'suspendida') {
    throw new Error('SUBSCRIPTION_SUSPENDED');
  }
  if (business.estadoSuscripcion === 'vencida') {
    throw new Error('SUBSCRIPTION_EXPIRED');
  }

  const plan = await getPlanOrDefault(business.planId);
  if (!plan.activo) {
    throw new Error('PLAN_INACTIVE');
  }

  return business;
}

export async function assertCanAddUser(
  businessId: string,
  rol: UserRole
): Promise<{ business: BusinessRecord; plan: PlanRecord }> {
  const business = await assertBusinessActive(businessId);
  const { plan, resolved } = await resolveForBusiness(business);
  const limits = resolved.limits;

  if (isAdministratorRole(rol)) {
    const administradoresActivos = await countActiveAdministrators(businessId);
    if (administradoresActivos >= limits.limiteAdministradores) {
      throw new Error('ADMIN_LIMIT_REACHED');
    }
  }

  if (rol === 'staff') {
    const operadoresActivos = await countActiveOperators(businessId);
    if (operadoresActivos >= limits.limiteOperadores) {
      throw new Error('OPERATOR_LIMIT_REACHED');
    }
  }

  const usuariosActivos = await countActiveUsers(businessId);
  if (usuariosActivos >= limits.limiteUsuariosTotal) {
    throw new Error('USER_LIMIT_REACHED');
  }

  return { business, plan };
}

export async function assertCanActivateUser(
  businessId: string,
  rol: UserRole,
  currentUserId?: string
): Promise<void> {
  await assertBusinessActive(businessId);
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const { resolved } = await resolveForBusiness(business);
  const limits = resolved.limits;

  if (isAdministratorRole(rol)) {
    let administradoresActivos = await countActiveAdministrators(businessId);
    if (currentUserId) {
      const userDoc = await db
        .collection(`negocios/${businessId}/usuarios`)
        .doc(currentUserId)
        .get();
      const data = userDoc.data();
      if (
        userDoc.exists &&
        data?.activo !== false &&
        isAdministratorRole(data.rol as UserRole)
      ) {
        administradoresActivos -= 1;
      }
    }
    if (administradoresActivos >= limits.limiteAdministradores) {
      throw new Error('ADMIN_LIMIT_REACHED');
    }
  }

  if (rol === 'staff') {
    let operadoresActivos = await countActiveOperators(businessId);
    if (currentUserId) {
      const userDoc = await db
        .collection(`negocios/${businessId}/usuarios`)
        .doc(currentUserId)
        .get();
      const data = userDoc.data();
      if (userDoc.exists && data?.activo !== false && data?.rol === 'staff') {
        operadoresActivos -= 1;
      }
    }
    if (operadoresActivos >= limits.limiteOperadores) {
      throw new Error('OPERATOR_LIMIT_REACHED');
    }
  }

  let usuariosActivos = await countActiveUsers(businessId);
  if (currentUserId) {
    const userDoc = await db
      .collection(`negocios/${businessId}/usuarios`)
      .doc(currentUserId)
      .get();
    if (userDoc.exists && userDoc.data()?.activo !== false) {
      usuariosActivos -= 1;
    }
  }
  if (usuariosActivos >= limits.limiteUsuariosTotal) {
    throw new Error('USER_LIMIT_REACHED');
  }
}

export { listSubscriptionPayments, registerSubscriptionPayment } from './subscription-payments.ts';
