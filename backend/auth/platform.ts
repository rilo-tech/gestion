import { db } from '../firebase.ts';
import { hashPassword } from './password.ts';

export const PLATFORM_SCOPE = '_platform';

export interface PlatformAdmin {
  id: string;
  nombre: string;
  email: string;
  loginUsername: string;
  passwordHash?: string;
  rol: 'superadmin';
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicPlatformAdmin {
  id: string;
  nombre: string;
  email: string;
  loginUsername: string;
  rol: 'superadmin';
  activo: boolean;
}

function platformAdminsCollection() {
  return db.collection('platform_admins');
}

function mapPlatformAdmin(id: string, data: Record<string, unknown>): PlatformAdmin {
  return {
    id,
    nombre: String(data.nombre ?? '').trim(),
    email: String(data.email ?? '')
      .trim()
      .toLowerCase(),
    loginUsername: String(data.loginUsername ?? '')
      .trim()
      .toLowerCase(),
    passwordHash: data.passwordHash ? String(data.passwordHash) : undefined,
    rol: 'superadmin',
    activo: data.activo !== false,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
}

export function toPublicPlatformAdmin(admin: PlatformAdmin): PublicPlatformAdmin {
  return {
    id: admin.id,
    nombre: admin.nombre,
    email: admin.email,
    loginUsername: admin.loginUsername,
    rol: 'superadmin',
    activo: admin.activo,
  };
}

export async function ensureDefaultPlatformAdmin(): Promise<void> {
  const col = platformAdminsCollection();
  const snapshot = await col.get();
  if (!snapshot.empty) return;

  const loginUsername = String(process.env.PLATFORM_ADMIN_USER ?? 'rilo')
    .trim()
    .toLowerCase();
  const password = String(process.env.PLATFORM_ADMIN_PASSWORD ?? 'superadmin');
  const passwordHash = await hashPassword(password);

  await col.add({
    nombre: 'RILO Plataforma',
    email: '',
    loginUsername,
    passwordHash,
    rol: 'superadmin',
    activo: true,
    createdAt: new Date().toISOString(),
  });
}

export async function findPlatformAdminByLogin(
  login: string
): Promise<PlatformAdmin | null> {
  const normalized = login.trim().toLowerCase();
  if (!normalized) return null;

  const snapshot = await platformAdminsCollection().get();
  for (const doc of snapshot.docs) {
    const admin = mapPlatformAdmin(doc.id, doc.data());
    if (
      admin.loginUsername === normalized ||
      (admin.email && admin.email === normalized)
    ) {
      return admin;
    }
  }
  return null;
}

export async function getPlatformAdmin(
  adminId: string
): Promise<PlatformAdmin | null> {
  const doc = await platformAdminsCollection().doc(adminId).get();
  if (!doc.exists) return null;
  return mapPlatformAdmin(doc.id, doc.data()!);
}
