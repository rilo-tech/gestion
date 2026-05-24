import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import { DEFAULT_BUSINESS_ID } from '../auth/constants.ts';
import { assertBusinessActive, getBusiness } from '../auth/business.ts';
import { signAuthToken } from '../auth/jwt.ts';
import { verifyPassword } from '../auth/password.ts';
import {
  findPlatformAdminByLogin,
  PLATFORM_SCOPE,
  toPublicPlatformAdmin,
} from '../auth/platform.ts';
import {
  findUserByEmail,
  findUserByLoginOrEmail,
  getStoredUser,
  linkGoogleId,
  toPublicUser,
} from '../auth/users.ts';
import { toPublicBusinessInfo } from '../auth/business.ts';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware.ts';

const router = express.Router();

function mapAuthError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'SUBSCRIPTION_SUSPENDED') {
    return { status: 403, message: 'La suscripción de esta empresa está suspendida.' };
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
    const businessId = String(req.body.businessId ?? DEFAULT_BUSINESS_ID);
    const idToken = String(req.body.idToken ?? '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'Token de Google requerido.' });
    }

    await assertBusinessActive(businessId);

    const businessDoc = await getBusiness(businessId);
    if (!businessDoc) {
      return res.status(404).json({ error: 'Empresa no encontrada. Verificá el código.' });
    }

    const decoded = await getAuth().verifyIdToken(idToken);
    const email = String(decoded.email ?? '')
      .trim()
      .toLowerCase();
    const googleId = decoded.uid;

    if (!email) {
      return res.status(400).json({ error: 'La cuenta de Google no tiene email.' });
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

export default router;
