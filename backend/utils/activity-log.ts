import { db } from '../firebase.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { isPrivilegedRole, type UserRole } from '../auth/constants.ts';

export const ACTIVITY_MODULES = [
  'clients',
  'suppliers',
  'stock',
  'purchases',
  'orders',
  'sales',
  'cash',
  'payables',
  'price_catalog',
  'collaborators',
] as const;

export type ActivityModule = (typeof ACTIVITY_MODULES)[number];
export type ActivityAction = 'create' | 'update' | 'delete' | 'payment' | 'cancel';

export interface ActivityLogRecord {
  id: string;
  module: ActivityModule;
  action: ActivityAction;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  userId: string;
  userNombre: string;
  userRol: UserRole | 'superadmin';
  summary: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityLogInput {
  module: ActivityModule;
  action: ActivityAction;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function activityCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/actividad`);
}

export function activityActor(req: AuthenticatedRequest) {
  if (req.auth?.scope !== 'company') return null;
  return {
    userId: req.auth.userId,
    userNombre: req.auth.user.nombre?.trim() || 'Usuario',
    userRol: req.auth.user.rol as UserRole,
  };
}

export async function logActivity(
  businessId: string,
  actor: { userId: string; userNombre: string; userRol: UserRole | 'superadmin' },
  input: ActivityLogInput
): Promise<void> {
  try {
    const payload = {
      module: input.module,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      userId: actor.userId,
      userNombre: actor.userNombre,
      userRol: actor.userRol,
      summary: input.summary.trim(),
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    await activityCollection(businessId).add(payload);
  } catch (error) {
    console.error('[activity-log] No se pudo registrar actividad:', error);
  }
}

export async function logActivityFromRequest(
  req: AuthenticatedRequest,
  businessId: string,
  input: ActivityLogInput
): Promise<void> {
  const actor = activityActor(req);
  if (!actor) return;
  await logActivity(businessId, actor, input);
}

export async function listModuleActivity(
  businessId: string,
  module: ActivityModule,
  viewer: { userId: string; rol: UserRole | 'superadmin' },
  limit = 120
): Promise<ActivityLogRecord[]> {
  const privileged = isPrivilegedRole(viewer.rol);
  const fetchLimit = Math.min(Math.max(limit * 4, 120), 500);

  const snapshot = await activityCollection(businessId)
    .orderBy('createdAt', 'desc')
    .limit(fetchLimit)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        module: data.module as ActivityModule,
        action: data.action as ActivityAction,
        entityType: String(data.entityType ?? ''),
        entityId: data.entityId ? String(data.entityId) : undefined,
        entityLabel: data.entityLabel ? String(data.entityLabel) : undefined,
        userId: String(data.userId ?? ''),
        userNombre: String(data.userNombre ?? 'Usuario'),
        userRol: (data.userRol as UserRole | 'superadmin') ?? 'staff',
        summary: String(data.summary ?? ''),
        metadata: (data.metadata as Record<string, unknown> | null) ?? undefined,
        createdAt: String(data.createdAt ?? new Date().toISOString()),
      };
    })
    .filter((entry) => entry.module === module)
    .filter((entry) => privileged || entry.userId === viewer.userId)
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

export function isActivityModule(value: unknown): value is ActivityModule {
  return typeof value === 'string' && ACTIVITY_MODULES.includes(value as ActivityModule);
}
