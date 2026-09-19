import { db } from '../firebase.ts';
import { getPlanOrDefault, DEFAULT_PLAN_ID } from '../auth/plans.ts';
import {
  businessHasModule,
  resolveBusinessSubscription,
  type ResolvedBusinessSubscription,
} from '../auth/subscription-entitlements.ts';
import {
  isPrivilegedRole,
  userHasPermission,
  type AssignablePermission,
  type UserRole,
} from '../auth/constants.ts';
import { getStoredUser } from '../auth/users.ts';
import {
  assertCanManageCollaboratorTeam,
  type CollaboratorAccessScope,
} from '../utils/collaborator-scope.ts';
import { AgentError } from '../whatsapp/agent/agent-errors.ts';
import type { ToolExecutionContext } from '../whatsapp/agent/tool-types.ts';
import type { WhatsappTenantContext } from '../whatsapp/tenant-resolver.ts';

export type WhatsappCollaboratorGate = {
  subscription: ResolvedBusinessSubscription;
  scope: CollaboratorAccessScope;
  role: UserRole;
  permisos: AssignablePermission[];
  canRead: boolean;
  /** Alta/edición/baja de colaboradores (equipo). */
  canWrite: boolean;
  /** Registro de horas (propio colaborador o equipo). */
  canWriteHours: boolean;
  /** Registro de pagos (solo gestión de equipo). */
  canWritePayments: boolean;
};

function mapWhatsappRole(role: string | undefined): UserRole {
  if (role === 'supervisor') return 'supervisor';
  if (role === 'admin') return 'admin';
  return 'staff';
}

async function loadBusinessSubscription(businessId: string): Promise<ResolvedBusinessSubscription> {
  const snap = await db.doc(`negocios/${businessId}`).get();
  const data = (snap.data() ?? {}) as { planId?: string; suscripcion?: Record<string, unknown> };
  const planId = String(data.planId ?? '').trim() || DEFAULT_PLAN_ID;
  const plan = await getPlanOrDefault(planId);
  return resolveBusinessSubscription(plan, (data.suscripcion ?? {}) as never);
}

async function resolveWhatsappErpUser(
  tenant: WhatsappTenantContext
): Promise<{ role: UserRole; permisos: AssignablePermission[]; colaboradorId?: string }> {
  const role = mapWhatsappRole(tenant.role);
  if (role === 'supervisor') {
    return { role, permisos: [] };
  }

  const waSnap = await db
    .collection(`negocios/${tenant.businessId}/whatsapp_users`)
    .where('phone', '==', tenant.phone)
    .limit(1)
    .get();

  let erpUserId = '';
  if (!waSnap.empty) {
    erpUserId = String(waSnap.docs[0]!.data().erpUserId ?? '').trim();
  }

  if (erpUserId) {
    const user = await getStoredUser(tenant.businessId, erpUserId);
    if (user?.activo !== false) {
      return {
        role: user.rol,
        permisos: user.permisos,
        colaboradorId: user.colaboradorId,
      };
    }
  }

  if (role === 'admin') {
    return { role, permisos: [] };
  }

  const usersSnap = await db.collection(`negocios/${tenant.businessId}/usuarios`).get();
  for (const doc of usersSnap.docs) {
    const data = doc.data() as { phone?: string; activo?: boolean; rol?: UserRole; permisos?: unknown; colaboradorId?: string };
    if (data.activo === false) continue;
    if (String(data.phone ?? '').trim() !== tenant.phone) continue;
    return {
      role: data.rol === 'supervisor' || data.rol === 'admin' ? data.rol : 'staff',
      permisos: Array.isArray(data.permisos) ? (data.permisos as AssignablePermission[]) : [],
      colaboradorId: String(data.colaboradorId ?? '').trim() || undefined,
    };
  }

  return { role, permisos: [] };
}

export async function resolveWhatsappCollaboratorGate(
  tenant: WhatsappTenantContext
): Promise<WhatsappCollaboratorGate> {
  const subscription = await loadBusinessSubscription(tenant.businessId);
  const erpUser = await resolveWhatsappErpUser(tenant);
  const scope: CollaboratorAccessScope =
    isPrivilegedRole(erpUser.role) || !erpUser.colaboradorId
      ? { mode: 'all' }
      : { mode: 'own', colaboradorId: erpUser.colaboradorId };

  const moduleEnabled = businessHasModule(subscription, 'collaborators');
  const hasAccess = userHasPermission(erpUser.role, erpUser.permisos, 'collaborators.access');
  let canManageTeam = false;
  try {
    assertCanManageCollaboratorTeam(scope);
    canManageTeam = true;
  } catch {
    canManageTeam = false;
  }
  const canWriteHours = moduleEnabled && hasAccess && (canManageTeam || scope.mode === 'own');
  const canWritePayments = moduleEnabled && hasAccess && canManageTeam;

  return {
    subscription,
    scope,
    role: erpUser.role,
    permisos: erpUser.permisos,
    canRead: moduleEnabled && hasAccess,
    canWrite: moduleEnabled && hasAccess && canManageTeam,
    canWriteHours,
    canWritePayments,
  };
}

export async function businessCollaboratorsModuleEnabled(businessId: string): Promise<boolean> {
  const subscription = await loadBusinessSubscription(businessId);
  return businessHasModule(subscription, 'collaborators');
}

export async function assertCollaboratorModuleEnabled(ctx: ToolExecutionContext): Promise<WhatsappCollaboratorGate> {
  const gate = await resolveWhatsappCollaboratorGate(ctx.tenant);
  if (!businessHasModule(gate.subscription, 'collaborators')) {
    throw new AgentError(
      'CAPABILITY_NOT_ENABLED',
      'El módulo de colaboradores no está habilitado para esta empresa.'
    );
  }
  return gate;
}

export async function assertCollaboratorReadAccess(ctx: ToolExecutionContext): Promise<WhatsappCollaboratorGate> {
  const gate = await assertCollaboratorModuleEnabled(ctx);
  if (!userHasPermission(gate.role, gate.permisos, 'collaborators.access')) {
    console.info(
      '[v4:collaborator:resolved]',
      JSON.stringify({ businessId: ctx.tenant.businessId, permission: 'read', allowed: false })
    );
    throw new AgentError('PERMISSION_DENIED', 'No tenés permiso para ver colaboradores.');
  }
  return gate;
}

export async function assertCollaboratorWriteAccess(ctx: ToolExecutionContext): Promise<WhatsappCollaboratorGate> {
  const gate = await assertCollaboratorReadAccess(ctx);
  if (!gate.canWrite) {
    throw new AgentError('PERMISSION_DENIED', 'No tenés permiso para gestionar colaboradores.');
  }
  return gate;
}

export async function assertCollaboratorHoursWriteAccess(
  ctx: ToolExecutionContext
): Promise<WhatsappCollaboratorGate> {
  const gate = await assertCollaboratorReadAccess(ctx);
  if (!gate.canWriteHours) {
    throw new AgentError('PERMISSION_DENIED', 'No tenés permiso para registrar horas.');
  }
  return gate;
}

export async function assertCollaboratorPaymentWriteAccess(
  ctx: ToolExecutionContext
): Promise<WhatsappCollaboratorGate> {
  const gate = await assertCollaboratorReadAccess(ctx);
  if (!gate.canWritePayments) {
    throw new AgentError('PERMISSION_DENIED', 'No tenés permiso para registrar pagos a colaboradores.');
  }
  return gate;
}

export function logCollaboratorTool(tool: string, businessId: string, detail?: Record<string, unknown>): void {
  console.info('[v4:collaborator:tool]', JSON.stringify({ tool, businessId, ...detail }));
}
