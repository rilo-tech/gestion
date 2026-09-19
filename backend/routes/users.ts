import express from 'express';
import { db } from '../firebase.ts';
import { hashPassword } from '../auth/password.ts';
import {
  sanitizeStaffPermissions,
  type UserRole,
} from '../auth/constants.ts';
import { assertCanActivateUser, assertCanAddUser } from '../auth/business.ts';
import {
  countActiveSupervisors,
  listUsers,
  listUsersPage,
  toPublicUser,
  getStoredUser,
  assertColaboradorLinkAvailable,
} from '../auth/users.ts';
import { getCollaborator } from '../utils/collaborators.ts';
import {
  assertCompanyTenantAccess,
  requireAuth,
  requireCompanyUserManager,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';
import { createCompanyRouter } from './create-company-router.ts';
import {
  expandErpSeatsForAdd,
  loadCommercialContext,
  quoteBusinessAddErpUser,
  shrinkErpSeatsToActive,
} from '../auth/commercial-pricing.ts';
import { extraSeatCount } from '../../shared/commercial-pricing.ts';
import { productSellsErpUserAddons } from '../../shared/commercial-seat-policy.ts';
import { recordCommercialEvent } from '../auth/commercial-events.ts';
import { safeSyncRecurringAmount } from '../billing/recurring.ts';
import { isErpWebOperational } from '../../shared/platform-access.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';

const router = createCompanyRouter();

router.patch('/:businessId/me/preferences', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'Preferencia no disponible para este acceso.' });
    }
    if (req.auth.businessId !== req.params.businessId) {
      return res.status(403).json({ error: 'No podés modificar otra empresa.' });
    }

    const tema = req.body.tema === 'dark' ? 'dark' : 'light';
    await db
      .collection(`negocios/${req.params.businessId}/usuarios`)
      .doc(req.auth.userId)
      .update({
        tema,
        updatedAt: new Date().toISOString(),
      });

    res.json({ tema });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'No se pudo guardar la preferencia.' });
  }
});

function normalizeColaboradorId(value: unknown, rol: UserRole): string | null {
  if (rol !== 'staff') return null;
  const id = String(value ?? '').trim();
  return id || null;
}

function normalizeUserPayload(userData: Record<string, unknown>) {
  const rol: UserRole =
    userData.rol === 'admin' ? 'admin' : 'staff';

  return {
    nombre: String(userData.nombre ?? '').trim(),
    email: String(userData.email ?? '')
      .trim()
      .toLowerCase(),
    loginUsername: String(userData.loginUsername ?? userData.email ?? '')
      .trim()
      .toLowerCase(),
    rol,
    permisos:
      rol === 'staff' || rol === 'admin'
        ? sanitizeStaffPermissions(userData.permisos)
        : [],
    activo: userData.activo !== false,
    colaboradorId: normalizeColaboradorId(userData.colaboradorId, rol),
  };
}

async function assertColaboradorLinkPayload(
  businessId: string,
  colaboradorId: string | null,
  excludeUserId?: string
): Promise<string | null> {
  if (!colaboradorId) return null;
  const collaborator = await getCollaborator(businessId, colaboradorId);
  if (!collaborator) {
    throw new Error('COLABORADOR_NOT_FOUND');
  }
  await assertColaboradorLinkAvailable(businessId, colaboradorId, excludeUserId);
  return colaboradorId;
}

function mapUserMutationError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ADMIN_LIMIT_REACHED') {
    return {
      status: 400,
      message: 'Tu plan no permite más administradores. Contactá a soporte para ampliarlo.',
    };
  }
  if (code === 'OPERATOR_LIMIT_REACHED') {
    return {
      status: 400,
      message: 'Tu plan no permite más operadores. Contactá a soporte para ampliarlo.',
    };
  }
  if (code === 'USER_LIMIT_REACHED') {
    return {
      status: 400,
      message: 'Se alcanzó el límite total de usuarios del plan.',
    };
  }
  if (code === 'SUBSCRIPTION_SUSPENDED') {
    return { status: 403, message: 'La suscripción de esta empresa está desactivada.' };
  }
  if (code === 'SUBSCRIPTION_EXPIRED') {
    return { status: 403, message: 'La suscripción está vencida.' };
  }
  if (code === 'PLAN_INACTIVE') {
    return { status: 403, message: 'El plan asignado no está activo.' };
  }
  if (code === 'COLABORADOR_NOT_FOUND') {
    return { status: 400, message: 'El colaborador seleccionado no existe.' };
  }
  if (code === 'COLABORADOR_ALREADY_LINKED') {
    return {
      status: 400,
      message: 'Ese colaborador ya está vinculado a otro operador activo.',
    };
  }
  return null;
}

router.get('/:businessId', requireCompanyUserManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : 120;
      const cursor = String(req.query.cursor ?? '').trim();
      const page = await listUsersPage(businessId, limit, cursor || undefined);
      return res.json(page);
    }

    const users = await listUsers(businessId);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

router.get('/:businessId/:userId', requireCompanyUserManager, async (req, res) => {
  try {
    const { businessId, userId } = req.params;
    const user = await getStoredUser(businessId, userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(toPublicUser(user));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  }
});

router.post('/:businessId', requireCompanyUserManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const { id, createdAt, password, passwordHash, googleId, rol, ...raw } = req.body ?? {};

    if (rol === 'supervisor') {
      return res.status(403).json({
        error: 'El administrador principal lo crea la plataforma. Solo podés crear administradores delegados u operadores.',
      });
    }

    const normalized = normalizeUserPayload({ ...raw, rol });
    const ctx = await loadCommercialContext(businessId);
    if (!productSellsErpUserAddons(ctx.productId) || !isErpWebOperational(normalizePlatformAccess(ctx.business.platformAccess))) {
      const extras = extraSeatCount(ctx.activeErpUsers + 1, ctx.rates.includedErpUsers);
      if (extras > 0) {
        return res.status(400).json({
          code: 'ERP_USER_ADDON_NOT_IN_PLAN',
          error:
            'En RILO Bot el acceso extra es un número de WhatsApp, no un usuario de panel. Sumá RILO Gestión o Completo para usuarios adicionales.',
        });
      }
    }
    const extraBefore = extraSeatCount(ctx.activeErpUsers, ctx.rates.includedErpUsers);
    const extraAfter = extraSeatCount(ctx.activeErpUsers + 1, ctx.rates.includedErpUsers);
    if (extraAfter > extraBefore) {
      if (req.body?.confirmBilling !== true) {
        const quote = await quoteBusinessAddErpUser(businessId);
        return res.status(409).json({
          code: 'BILLING_CONFIRMATION_REQUIRED',
          error: 'Este usuario adicional cambia tu cuota mensual. Confirmá el costo para continuar.',
          quote: {
            ...quote,
            appliedAt: ctx.paidUntil || ctx.business.billing?.nextPaymentDate || 'próxima renovación',
          },
        });
      }
      const actor =
        req.auth?.scope === 'platform'
          ? `platform:${req.auth.userId}`
          : `company:${req.auth?.userId ?? 'unknown'}`;
      await expandErpSeatsForAdd({
        businessId,
        rol: normalized.rol === 'admin' ? 'admin' : 'staff',
        actor,
      });
    }
    await assertCanAddUser(businessId, normalized.rol);
    normalized.colaboradorId = await assertColaboradorLinkPayload(
      businessId,
      normalized.colaboradorId
    );

    if (!normalized.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }

    const plainPassword = String(password ?? '').trim();
    let nextPasswordHash = passwordHash ? String(passwordHash) : undefined;
    if (plainPassword) {
      nextPasswordHash = await hashPassword(plainPassword);
    }

    const actor =
      req.auth?.scope === 'platform'
        ? `platform:${req.auth.userId}`
        : `company:${req.auth?.userId ?? 'unknown'}`;
    const now = new Date().toISOString();
    const docRef = await db.collection(`negocios/${businessId}/usuarios`).add({
      ...normalized,
      passwordHash: nextPasswordHash ?? null,
      googleId: googleId ? String(googleId) : null,
      addedAt: now,
      addedBy: actor,
      createdAt: now,
    });
    if (extraAfter > extraBefore) {
      const after = await loadCommercialContext(businessId);
      const preapprovalSync = await safeSyncRecurringAmount(businessId);
      await recordCommercialEvent({
        businessId,
        type: 'user_added',
        actor,
        oldValue: { active: ctx.activeErpUsers },
        newValue: { userId: docRef.id, active: ctx.activeErpUsers + 1 },
        billingImpact: {
          oldTotal: ctx.quote.total,
          newTotal: after.quote.total,
          delta: after.quote.total - ctx.quote.total,
          effectiveAt: after.quote.effectiveAt,
        },
        note: 'Usuario ERP adicional',
      });
    }
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    const mapped = mapUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    res.status(500).json({ error: 'Error creating user' });
  }
});

router.patch('/:businessId/:userId', requireCompanyUserManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId, userId } = req.params;
    const { id, createdAt, password, passwordHash, googleId, rol, ...raw } = req.body ?? {};

    if (rol === 'supervisor') {
      return res.status(403).json({ error: 'No podés promover usuarios a administrador principal.' });
    }

    const docRef = db.collection(`negocios/${businessId}/usuarios`).doc(userId);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ error: 'User not found' });

    const existingData = existing.data() as Record<string, unknown>;
    if (existingData.rol === 'supervisor') {
      return res.status(403).json({ error: 'No podés modificar al administrador principal.' });
    }

    const merged = normalizeUserPayload({ ...existingData, ...raw, rol });
    const nextRol = merged.rol;
    merged.colaboradorId = await assertColaboradorLinkPayload(
      businessId,
      merged.colaboradorId,
      userId
    );
    const activating = existingData.activo === false && merged.activo === true;
    const deactivating = existingData.activo !== false && merged.activo === false;
    const roleChanged = existingData.rol !== nextRol;

    if (activating || roleChanged) {
      const ctx = await loadCommercialContext(businessId);
      const extraBefore = extraSeatCount(ctx.activeErpUsers, ctx.rates.includedErpUsers);
      const extraAfter = extraSeatCount(ctx.activeErpUsers + 1, ctx.rates.includedErpUsers);
      if (activating && extraAfter > extraBefore) {
        if (req.body?.confirmBilling !== true) {
          const quote = await quoteBusinessAddErpUser(businessId);
          return res.status(409).json({
            code: 'BILLING_CONFIRMATION_REQUIRED',
            error: 'Reactivar este usuario cambia tu cuota mensual. Confirmá el costo para continuar.',
            quote: {
              ...quote,
              appliedAt: ctx.paidUntil || ctx.business.billing?.nextPaymentDate || 'próxima renovación',
            },
          });
        }
        await expandErpSeatsForAdd({
          businessId,
          rol: nextRol === 'admin' ? 'admin' : 'staff',
          actor:
            req.auth?.scope === 'platform'
              ? `platform:${req.auth.userId}`
              : `company:${req.auth?.userId ?? 'unknown'}`,
        });
      }
      await assertCanActivateUser(businessId, nextRol, userId);
    }

    const actor =
      req.auth?.scope === 'platform'
        ? `platform:${req.auth.userId}`
        : `company:${req.auth?.userId ?? 'unknown'}`;
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      ...merged,
      updatedAt: now,
    };
    if (deactivating) {
      updatePayload.removedAt = now;
      updatePayload.removedBy = actor;
    }
    if (activating) {
      updatePayload.removedAt = null;
      updatePayload.removedBy = null;
    }

    const beforeDeactivate = deactivating ? await loadCommercialContext(businessId) : null;

    const plainPassword = String(password ?? '').trim();
    if (plainPassword) {
      updatePayload.passwordHash = await hashPassword(plainPassword);
    } else if (passwordHash === null) {
      updatePayload.passwordHash = null;
    }

    if (googleId !== undefined) {
      updatePayload.googleId = googleId ? String(googleId) : null;
    }

    await docRef.update(updatePayload);
    if (activating) {
      await safeSyncRecurringAmount(businessId);
    }
    if (deactivating) {
      await shrinkErpSeatsToActive({ businessId, actor });
      const after = await loadCommercialContext(businessId);
      await safeSyncRecurringAmount(businessId);
      await recordCommercialEvent({
        businessId,
        type: 'user_removed',
        actor,
        oldValue: { userId, active: true },
        newValue: { userId, active: false },
        billingImpact: {
          oldTotal: beforeDeactivate?.quote.total ?? after.quote.total,
          newTotal: after.quote.total,
          delta: after.quote.total - (beforeDeactivate?.quote.total ?? after.quote.total),
          effectiveAt: after.quote.effectiveAt,
        },
        note: 'Usuario ERP desactivado',
      });
    }
    res.json({ id: userId, rol: nextRol });
  } catch (error) {
    const mapped = mapUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    res.status(500).json({ error: 'Error updating user' });
  }
});

router.delete('/:businessId/:userId', requireCompanyUserManager, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId, userId } = req.params;

    if (req.auth?.scope === 'company' && req.auth.userId === userId) {
      return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
    }

    const docRef = db.collection(`negocios/${businessId}/usuarios`).doc(userId);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ error: 'User not found' });

    if (existing.data()?.rol === 'supervisor') {
      const supervisors = await countActiveSupervisors(businessId);
      if (supervisors <= 1) {
        return res.status(400).json({ error: 'No se puede eliminar el único administrador activo.' });
      }
    }

    const actor =
      req.auth?.scope === 'platform'
        ? `platform:${req.auth.userId}`
        : `company:${req.auth?.userId ?? 'unknown'}`;
    const before = await loadCommercialContext(businessId);
    const now = new Date().toISOString();
    await docRef.set(
      {
        activo: false,
        removedAt: now,
        removedBy: actor,
        updatedAt: now,
      },
      { merge: true }
    );
    await shrinkErpSeatsToActive({ businessId, actor });
    const after = await loadCommercialContext(businessId);
    await safeSyncRecurringAmount(businessId);
    await recordCommercialEvent({
      businessId,
      type: 'user_removed',
      actor,
      oldValue: { userId, active: true },
      newValue: { userId, active: false },
      billingImpact: {
        oldTotal: before.quote.total,
        newTotal: after.quote.total,
        delta: after.quote.total - before.quote.total,
        effectiveAt: after.quote.effectiveAt,
      },
      note: 'Usuario ERP desactivado',
    });
    res.json({ id: userId, deactivated: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user' });
  }
});

export default router;
