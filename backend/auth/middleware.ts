import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from './jwt.ts';
import { getStoredUser, toPublicUser, type PublicUser } from './users.ts';
import { DEFAULT_BUSINESS_ID } from './constants.ts';
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
    return res.status(403).json({ error: 'No tenés acceso a la configuración.' });
  }
  next();
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

  if (req.auth?.scope === 'platform') {
    return next();
  }

  if (req.auth?.scope === 'company' && req.auth.businessId === targetBusinessId) {
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
