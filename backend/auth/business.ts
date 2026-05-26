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
  getSubscriptionPaymentSummary,
  currentPeriodo,
  type SubscriptionPaymentRecord,
  type SubscriptionPaymentStatus,
} from './subscription-payments.ts';

export type SubscriptionStatus = 'activa' | 'suspendida' | 'vencida';

export interface BusinessRecord {
  id: string;
  nombre: string;
  planId: string;
  estadoSuscripcion: SubscriptionStatus;
  /** Período de prueba: acceso al sistema sin exigir pago mensual en control de cobros. */
  enPrueba?: boolean;
  creadoPor?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicBusinessInfo {
  id: string;
  nombre: string;
  planId: string;
  plan: PublicPlanInfo;
  estadoSuscripcion: SubscriptionStatus;
  estadoPago: SubscriptionPaymentStatus;
  periodoPagoActual: string;
  montoMensualEsperado: number;
  ultimoPagoPeriodo?: string;
  ultimoPagoFecha?: string;
  ultimoPagoMonto?: number;
  enPrueba: boolean;
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
  'creadoPor',
  'updatedAt',
]);

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
    creadoPor: data.creadoPor ? String(data.creadoPor) : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
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
    creadoPor?: string;
  }
): Promise<BusinessRecord> {
  const ref = businessRef(businessId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('BUSINESS_EXISTS');
  }

  const planId = payload.planId?.trim() || DEFAULT_PLAN_ID;
  await getPlanOrDefault(planId);

  const record = {
    nombre: payload.nombre.trim(),
    planId,
    estadoSuscripcion: normalizeStatus(payload.estadoSuscripcion ?? 'activa'),
    enPrueba: payload.enPrueba === true,
    creadoPor: payload.creadoPor ?? 'platform',
    createdAt: new Date().toISOString(),
  };

  await ref.set(record);
  return mapBusiness(businessId, record);
}

export async function updateBusiness(
  businessId: string,
  payload: Partial<BusinessRecord>,
  options?: { allowSubscriptionFields?: boolean }
): Promise<BusinessRecord> {
  const sanitized = sanitizeBusinessPayload(
    payload as Record<string, unknown>,
    options
  );

  if (sanitized.planId) {
    await getPlanOrDefault(sanitized.planId);
  }

  const updates: Record<string, unknown> = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };

  Object.keys(updates).forEach((key) => {
    if (!BUSINESS_MUTABLE_FIELDS.has(key) && key !== 'updatedAt') {
      delete updates[key];
    }
  });

  const ref = businessRef(businessId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('BUSINESS_NOT_FOUND');
  }

  await ref.update(updates);
  const next = await ref.get();
  return mapBusiness(next.id, next.data() as Record<string, unknown>);
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
  return {
    id: business.id,
    nombre: business.nombre,
    planId: plan.id,
    plan: toPublicPlanInfo(plan),
    estadoSuscripcion: business.estadoSuscripcion,
    estadoPago: paymentSummary.estadoPago,
    periodoPagoActual: paymentSummary.periodoActual,
    montoMensualEsperado: paymentSummary.montoEsperado,
    ultimoPagoPeriodo: paymentSummary.ultimoPagoPeriodo,
    ultimoPagoFecha: paymentSummary.ultimoPagoFecha,
    ultimoPagoMonto: paymentSummary.ultimoPagoMonto,
    enPrueba: business.enPrueba === true,
    createdAt: business.createdAt,
    administradoresActivos: counts.administradoresActivos,
    operadoresActivos: counts.operadoresActivos,
    usuariosActivos: counts.usuariosActivos,
    administradoresDisponibles: Math.max(
      0,
      plan.limiteAdministradores - counts.administradoresActivos
    ),
    operadoresDisponibles: Math.max(0, plan.limiteOperadores - counts.operadoresActivos),
    usuariosDisponibles: Math.max(0, plan.limiteUsuariosTotal - counts.usuariosActivos),
  };
}

/** Respuesta inmediata al crear empresa (sin consultas extra). */
export function buildNewBusinessPublicInfo(
  business: BusinessRecord,
  plan: PlanRecord
): PublicBusinessInfo {
  return buildPublicBusinessInfo(
    business,
    plan,
    {
      administradoresActivos: 1,
      operadoresActivos: 0,
      usuariosActivos: 1,
    },
    {
      estadoPago: business.enPrueba ? 'al_dia' : 'pendiente',
      periodoActual: currentPeriodo(),
      montoEsperado: plan.precioMensual,
    }
  );
}

export async function toSessionBusinessInfo(
  businessId: string,
  existing?: BusinessRecord | null
): Promise<PublicBusinessInfo> {
  const business =
    existing ?? (await getBusiness(businessId)) ?? (await ensureDefaultBusiness(businessId));
  const plan = await getPlanOrDefault(business.planId);
  const periodoActual = currentPeriodo();

  return buildPublicBusinessInfo(
    business,
    plan,
    {
      administradoresActivos: 0,
      operadoresActivos: 0,
      usuariosActivos: 0,
    },
    {
      estadoPago: business.enPrueba ? 'al_dia' : 'pendiente',
      periodoActual,
      montoEsperado: plan.precioMensual,
    }
  );
}

export async function toPublicBusinessInfo(
  businessId: string,
  options?: PublicBusinessInfoOptions
): Promise<PublicBusinessInfo> {
  const business =
    options?.business ??
    (await getBusiness(businessId)) ??
    (await ensureDefaultBusiness(businessId));
  const plan = options?.plan ?? (await getPlanOrDefault(business.planId));
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
      ? getSubscriptionPaymentSummary(businessId, plan.precioMensual)
      : Promise.resolve({
          estadoPago: (business.enPrueba ? 'al_dia' : 'pendiente') as SubscriptionPaymentStatus,
          periodoActual: currentPeriodo(),
          montoEsperado: plan.precioMensual,
        }),
  ]);

  return buildPublicBusinessInfo(business, plan, counts, paymentSummary);
}

export async function listPublicBusinessInfos(): Promise<PublicBusinessInfo[]> {
  const businesses = await listBusinesses();
  if (!businesses.length) return [];

  const plansById = await preloadPlans();

  return Promise.all(
    businesses.map(async (business) => {
      const plan =
        plansById.get(business.planId) ??
        plansById.get(DEFAULT_PLAN_ID) ??
        (await getPlanOrDefault(business.planId));
      const [counts, paymentSummary] = await Promise.all([
        getActiveUserCounts(business.id),
        getSubscriptionPaymentSummary(business.id, plan.precioMensual),
      ]);
      return buildPublicBusinessInfo(business, plan, counts, paymentSummary);
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
  const plan = await getPlanOrDefault(business.planId);

  if (isAdministratorRole(rol)) {
    const administradoresActivos = await countActiveAdministrators(businessId);
    if (administradoresActivos >= plan.limiteAdministradores) {
      throw new Error('ADMIN_LIMIT_REACHED');
    }
  }

  if (rol === 'staff') {
    const operadoresActivos = await countActiveOperators(businessId);
    if (operadoresActivos >= plan.limiteOperadores) {
      throw new Error('OPERATOR_LIMIT_REACHED');
    }
  }

  const usuariosActivos = await countActiveUsers(businessId);
  if (usuariosActivos >= plan.limiteUsuariosTotal) {
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
  const plan = await getBusinessPlan(businessId);

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
    if (administradoresActivos >= plan.limiteAdministradores) {
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
    if (operadoresActivos >= plan.limiteOperadores) {
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
  if (usuariosActivos >= plan.limiteUsuariosTotal) {
    throw new Error('USER_LIMIT_REACHED');
  }
}

export { listSubscriptionPayments, registerSubscriptionPayment } from './subscription-payments.ts';
