import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './constants.ts';
import type { UserRole } from './constants.ts';

export type AuthScope = 'company' | 'platform';

export interface AuthTokenPayload {
  userId: string;
  businessId: string;
  rol: UserRole | 'superadmin';
  scope: AuthScope;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
  } catch {
    return null;
  }
}
