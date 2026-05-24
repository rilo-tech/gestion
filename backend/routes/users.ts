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
  ensureDefaultSupervisor,
  listUsers,
  toPublicUser,
  getStoredUser,
} from '../auth/users.ts';
import {
  assertCompanyTenantAccess,
  requireAuth,
  requireSupervisor,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';

const router = express.Router();

router.use(requireAuth);
router.use('/:businessId', assertCompanyTenantAccess);

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
    permisos: rol === 'staff' ? sanitizeStaffPermissions(userData.permisos) : [],
    activo: userData.activo !== false,
  };
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
    return { status: 403, message: 'La suscripción está suspendida.' };
  }
  if (code === 'SUBSCRIPTION_EXPIRED') {
    return { status: 403, message: 'La suscripción está vencida.' };
  }
  if (code === 'PLAN_INACTIVE') {
    return { status: 403, message: 'El plan asignado no está activo.' };
  }
  return null;
}

router.get('/:businessId', requireSupervisor, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const users = await listUsers(businessId);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

router.get('/:businessId/:userId', requireSupervisor, async (req, res) => {
  try {
    const { businessId, userId } = req.params;
    const user = await getStoredUser(businessId, userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(toPublicUser(user));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user' });
  }
});

router.post('/:businessId', requireSupervisor, async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const { id, createdAt, password, passwordHash, googleId, rol, ...raw } = req.body ?? {};

    if (rol === 'supervisor') {
      return res.status(403).json({
        error: 'El administrador principal lo crea la plataforma. Solo podés crear administradores delegados u operadores.',
      });
    }

    const normalized = normalizeUserPayload({ ...raw, rol });
    await assertCanAddUser(businessId, normalized.rol);

    if (!normalized.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }

    const plainPassword = String(password ?? '').trim();
    let nextPasswordHash = passwordHash ? String(passwordHash) : undefined;
    if (plainPassword) {
      nextPasswordHash = await hashPassword(plainPassword);
    }

    const docRef = await db.collection(`negocios/${businessId}/usuarios`).add({
      ...normalized,
      passwordHash: nextPasswordHash ?? null,
      googleId: googleId ? String(googleId) : null,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    const mapped = mapUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    res.status(500).json({ error: 'Error creating user' });
  }
});

router.patch('/:businessId/:userId', requireSupervisor, async (req: AuthenticatedRequest, res) => {
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
    const activating = existingData.activo === false && merged.activo === true;
    const roleChanged = existingData.rol !== nextRol;

    if (activating || roleChanged) {
      await assertCanActivateUser(businessId, nextRol, userId);
    }

    const updatePayload: Record<string, unknown> = {
      ...merged,
      updatedAt: new Date().toISOString(),
    };

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
    res.json({ id: userId, rol: nextRol });
  } catch (error) {
    const mapped = mapUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    res.status(500).json({ error: 'Error updating user' });
  }
});

router.delete('/:businessId/:userId', requireSupervisor, async (req: AuthenticatedRequest, res) => {
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

    await docRef.delete();
    res.json({ id: userId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user' });
  }
});

export default router;
