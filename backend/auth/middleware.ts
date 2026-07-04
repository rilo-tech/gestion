import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from './jwt.ts';
import { assertBusinessActive, getBusinessSubscription } from './business.ts';
import { getStoredUser, toPublicUser, type PublicUser } from './users.ts';
import { DEFAULT_BUSINESS_ID, userHasPermission, type AssignablePermission } from './constants.ts';
import {
  businessHasModule,
} from './subscription-entitlements.ts';
import type { SubscriptionModuleId } from '../../shared/subscription-modules.ts';
import {
  getPlatformAdmin,
  PLATFORM_SCOPE,
  toPublicPlatformAdmin,
  type PublicPlatformAdmin,
} from './platform.ts';

export interface CompanyAuthContext {
  scope: 'company';
  businessId: string;
  userId: string;
  user: PublicUser;
}

export interface PlatformAuthContext {
  scope: 'platform';
  businessId: typeof PLATFORM_SCOPE;
  userId: string;
  user: PublicPlatformAdmin;
}

export type AuthContext = CompanyAuthContext | PlatformAuthContext;

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }

  if (payload.scope === 'platform' || payload.rol === 'superadmin') {
    const admin = await getPlatformAdmin(payload.userId);
    if (!admin || !admin.activo) {
      return res.status(401).json({ error: 'Usuario inactivo o inexistente.' });
    }

    req.auth = {
      scope: 'platform',
      businessId: PLATFORM_SCOPE,
      userId: payload.userId,
      user: toPublicPlatformAdmin(admin),
    };
    return next();
  }

  const stored = await getStoredUser(payload.businessId, payload.userId);
  if (!stored || !stored.activo) {
    return res.status(401).json({ error: 'Usuario inactivo o inexistente.' });
  }

  try {
    await assertBusinessActive(payload.businessId);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SUBSCRIPTION_SUSPENDED') {
      return res.status(403).json({
        error: 'La suscripción de esta empresa está desactivada.',
      });
    }
    if (code === 'SUBSCRIPTION_EXPIRED') {
      return res.status(403).json({
        error: 'La suscripción de esta empresa está vencida.',
      });
    }
    if (code === 'PLAN_INACTIVE') {
      return res.status(403).json({
        error: 'El plan asignado a esta empresa no está activo.',
      });
    }
  }

  req.auth = {
    scope: 'company',
    businessId: payload.businessId,
    userId: payload.userId,
    user: toPublicUser(stored),
  };
  next();
}

export function requireSupervisor(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.auth?.scope !== 'company' || req.auth.user.rol !== 'supervisor') {
    return res.status(403).json({
      error: 'Solo el administrador de la empresa puede realizar esta acción.',
    });
  }
  next();
}

export function requireSuperadmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.auth?.scope !== 'platform' || req.auth.user.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el superadmin puede realizar esta acción.' });
  }
  next();
}

export function requireSettingsAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.auth?.scope !== 'company') {
    return res.status(403).json({ error: 'No tenés acceso a la configuración.' });
  }

  const rol = req.auth.user.rol;
  if (rol !== 'supervisor' && rol !== 'admin') {
    if (
      !userHasPermission(
        rol,
        req.auth.user.permisos,
        'settings.manage' as AssignablePermission
      )
    ) {
      return res.status(403).json({ error: 'No tenés acceso a la configuración.' });
    }
  }
  next();
}

export function requirePermission(permission: AssignablePermission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'No tenés permiso para esta acción.' });
    }

    const user = req.auth.user;
    if (!userHasPermission(user.rol, user.permisos, permission)) {
      return res.status(403).json({ error: 'No tenés permiso para acceder a este módulo.' });
    }

    next();
  };
}

export function requireBusinessModule(...moduleIds: SubscriptionModuleId[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.scope !== 'company') {
      return res.status(403).json({ error: 'No tenés acceso a este módulo.' });
    }

    try {
      const resolved = await getBusinessSubscription(req.auth.businessId);
      const allowed = moduleIds.some((moduleId) => businessHasModule(resolved, moduleId));
      if (!allowed) {
        return res.status(403).json({
          error: 'Este módulo no está incluido en la suscripción de tu empresa.',
        });
      }
      next();
    } catch (error) {
      console.error('Module entitlement check failed:', error);
      return res.status(500).json({ error: 'No se pudo validar la suscripción.' });
    }
  };
}

export function assertCompanyTenantAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const targetBusinessId = String(req.params.businessId ?? '');
  if (!targetBusinessId) {
    return res.status(400).json({ error: 'Empresa no especificada.' });
  }

  if (req.auth?.scope !== 'company') {
    return res.status(403).json({ error: 'No podés acceder a otra empresa.' });
  }

  if (req.auth.businessId === targetBusinessId) {
    return next();
  }

  return res.status(403).json({ error: 'No podés acceder a otra empresa.' });
}

export function getBusinessId(req: AuthenticatedRequest): string {
  if (req.auth?.scope === 'company') {
    return req.auth.businessId;
  }
  return String(req.params.businessId ?? DEFAULT_BUSINESS_ID);
}

export function isPlatformAuth(req: AuthenticatedRequest): boolean {
  return req.auth?.scope === 'platform';
}
