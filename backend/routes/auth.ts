import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import { db } from '../firebase.ts';
import { DEFAULT_BUSINESS_ID } from '../auth/constants.ts';
import { assertBusinessActive, getBusiness } from '../auth/business.ts';
import { signAuthToken } from '../auth/jwt.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import {
  findPlatformAdminByEmail,
  findPlatformAdminByLogin,
  getPlatformAdmin,
  linkPlatformGoogleId,
  PLATFORM_SCOPE,
  toPublicPlatformAdmin,
  updatePlatformAdminProfile,
} from '../auth/platform.ts';
import {
  findUserByEmail,
  findUserByLoginOrEmail,
  getStoredUser,
  linkGoogleId,
  toPublicUser,
  updateUserProfile,
} from '../auth/users.ts';
import { toPublicBusinessInfo } from '../auth/business.ts';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.ts';

const router = express.Router();

function mapAuthError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'SUBSCRIPTION_SUSPENDED') {
    return { status: 403, message: 'La suscripción de esta empresa está desactivada.' };
  }
  if (code === 'SUBSCRIPTION_EXPIRED') {
    return { status: 403, message: 'La suscripción de esta empresa está vencida.' };
  }
  if (code === 'PLAN_INACTIVE') {
    return { status: 403, message: 'El plan asignado a esta empresa no está activo.' };
  }
  return null;
}

function companySessionResponse(
  user: ReturnType<typeof toPublicUser>,
  businessId: string
) {
  const token = signAuthToken({
    userId: user.id,
    businessId,
    rol: user.rol,
    scope: 'company',
  });
  return { token, user, businessId, scope: 'company' as const };
}

function platformSessionResponse(admin: ReturnType<typeof toPublicPlatformAdmin>) {
  const token = signAuthToken({
    userId: admin.id,
    businessId: PLATFORM_SCOPE,
    rol: 'superadmin',
    scope: 'platform',
  });
  return { token, user: admin, businessId: PLATFORM_SCOPE, scope: 'platform' as const };
}

function isValidEmail(email: string): boolean {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidLoginUsername(login: string): boolean {
  return /^[a-z0-9._-]{2,40}$/.test(login);
}

function mapProfileUpdateError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'NAME_REQUIRED') {
    return { status: 400, message: 'El nombre es obligatorio.' };
  }
  if (code === 'LOGIN_REQUIRED') {
    return { status: 400, message: 'El usuario de acceso es obligatorio.' };
  }
  if (code === 'LOGIN_USERNAME_TAKEN') {
    return { status: 400, message: 'Ese usuario de acceso ya está en uso.' };
  }
  if (code === 'EMAIL_TAKEN') {
    return { status: 400, message: 'Ese email ya está registrado en la empresa.' };
  }
  if (code === 'USER_NOT_FOUND') {
    return { status: 404, message: 'Usuario no encontrado.' };
  }
  return null;
}

router.post('/login', async (req, res) => {
  try {
    const login = String(req.body.login ?? req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    const requestedScope = String(req.body.scope ?? 'company');
    const businessId = String(req.body.businessId ?? DEFAULT_BUSINESS_ID);

    if (!login || !password) {
      return res.status(400).json({ error: 'Ingresá usuario y contraseña.' });
    }

    if (requestedScope === 'platform') {
      const admin = await findPlatformAdminByLogin(login);
      if (!admin || !admin.activo) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
      }

      const valid = await verifyPassword(password, admin.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
      }

      return res.json(platformSessionResponse(toPublicPlatformAdmin(admin)));
    }

    await assertBusinessActive(businessId);

    const businessRecord = await getBusiness(businessId);
    if (!businessRecord) {
      return res.status(404).json({ error: 'Empresa no encontrada. Verificá el código.' });
    }

    const user = await findUserByLoginOrEmail(businessId, login);
    if (!user || !user.activo) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const business = await toPublicBusinessInfo(businessId);
    res.json({
      ...companySessionResponse(toPublicUser(user), businessId),
      business,
    });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const requestedScope = String(req.body.scope ?? 'company');
    const businessId = String(req.body.businessId ?? DEFAULT_BUSINESS_ID);
    const idToken = String(req.body.idToken ?? '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Token de Google requerido.' });
    }

    const decoded = await getAuth().verifyIdToken(idToken);
    const email = String(decoded.email ?? '')
      .trim()
      .toLowerCase();
    const googleId = decoded.uid;

    if (!email) {
      return res.status(400).json({ error: 'La cuenta de Google no tiene email.' });
    }

    if (requestedScope === 'platform') {
      let admin = await findPlatformAdminByEmail(email);
      if (!admin) {
        return res.status(403).json({
          error:
            'Tu email no está registrado como administrador de plataforma. Cargalo en Mi cuenta o pedí que te lo den de alta.',
        });
      }

      if (!admin.activo) {
        return res.status(403).json({ error: 'Tu usuario está inactivo.' });
      }

      if (!admin.googleId) {
        await linkPlatformGoogleId(admin.id, googleId);
        admin = (await getPlatformAdmin(admin.id)) ?? admin;
      } else if (admin.googleId !== googleId) {
        return res.status(403).json({
          error: 'Esta cuenta de Google no coincide con el administrador registrado.',
        });
      }

      return res.json(platformSessionResponse(toPublicPlatformAdmin(admin)));
    }

    await assertBusinessActive(businessId);

    const businessDoc = await getBusiness(businessId);
    if (!businessDoc) {
      return res.status(404).json({ error: 'Empresa no encontrada. Verificá el código.' });
    }

    let user = await findUserByEmail(businessId, email);
    if (!user) {
      return res.status(403).json({
        error:
          'Tu email no está registrado en el sistema. Pedile al administrador que te dé acceso.',
      });
    }

    if (!user.activo) {
      return res.status(403).json({ error: 'Tu usuario está inactivo.' });
    }

    if (!user.googleId) {
      await linkGoogleId(businessId, user.id, googleId);
      user = (await getStoredUser(businessId, user.id)) ?? user;
    } else if (user.googleId !== googleId) {
      return res.status(403).json({
        error: 'Esta cuenta de Google no coincide con el usuario registrado.',
      });
    }

    const business = await toPublicBusinessInfo(businessId);
    res.json({
      ...companySessionResponse(toPublicUser(user), businessId),
      business,
    });
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'No se pudo validar la cuenta de Google.' });
  }
});

router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.auth?.scope === 'platform') {
    return res.json({
      scope: 'platform',
      businessId: PLATFORM_SCOPE,
      user: req.auth.user,
    });
  }

  const business = await toPublicBusinessInfo(req.auth!.businessId);
  res.json({
    scope: 'company',
    businessId: req.auth!.businessId,
    user: req.auth!.user,
    business,
  });
});

router.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

router.patch('/me/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const nombre = String(req.body.nombre ?? '').trim();
    const email = String(req.body.email ?? '')
      .trim()
      .toLowerCase();
    const loginUsername = String(req.body.loginUsername ?? '')
      .trim()
      .toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Ingresá un email válido.' });
    }

    if (!isValidLoginUsername(loginUsername)) {
      return res.status(400).json({
        error: 'El usuario de acceso debe tener entre 2 y 40 caracteres (letras, números, ., -, _).',
      });
    }

    if (req.auth?.scope === 'platform') {
      const updated = await updatePlatformAdminProfile(req.auth.userId, {
        nombre,
        email,
        loginUsername,
      });
      return res.json({ user: toPublicPlatformAdmin(updated) });
    }

    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'No autorizado.' });
    }

    const updated = await updateUserProfile(req.auth.businessId, req.auth.userId, {
      nombre,
      email,
      loginUsername,
    });

    res.json({ user: toPublicUser(updated) });
  } catch (error) {
    const mapped = mapProfileUpdateError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'No se pudo actualizar el perfil.' });
  }
});

router.patch('/me/password', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const newPassword = String(req.body.newPassword ?? '').trim();
    const currentPassword = String(req.body.currentPassword ?? '');

    if (!newPassword) {
      return res.status(400).json({ error: 'Ingresá la nueva contraseña.' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
    }

    if (req.auth?.scope === 'platform') {
      const admin = await getPlatformAdmin(req.auth.userId);
      if (!admin || !admin.activo) {
        return res.status(401).json({ error: 'Usuario inactivo o inexistente.' });
      }

      if (admin.passwordHash) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Ingresá tu contraseña actual.' });
        }
        const valid = await verifyPassword(currentPassword, admin.passwordHash);
        if (!valid) {
          return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
        }
      }

      await db.collection('platform_admins').doc(admin.id).update({
        passwordHash: await hashPassword(newPassword),
        updatedAt: new Date().toISOString(),
      });

      return res.json({ ok: true });
    }

    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'No autorizado.' });
    }

    const user = await getStoredUser(req.auth.businessId, req.auth.userId);
    if (!user || !user.activo) {
      return res.status(401).json({ error: 'Usuario inactivo o inexistente.' });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Ingresá tu contraseña actual.' });
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
      }
    }

    await db
      .collection(`negocios/${req.auth.businessId}/usuarios`)
      .doc(req.auth.userId)
      .update({
        passwordHash: await hashPassword(newPassword),
        updatedAt: new Date().toISOString(),
      });

    res.json({ ok: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
  }
});

export default router;
