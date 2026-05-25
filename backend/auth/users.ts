import { db } from '../firebase.ts';
import { hashPassword } from './password.ts';
import {
  DEFAULT_BUSINESS_ID,
  sanitizeStaffPermissions,
  type ThemePreference,
  type UserRole,
} from './constants.ts';

export interface StoredUser {
  id: string;
  nombre: string;
  email: string;
  loginUsername: string;
  passwordHash?: string;
  googleId?: string;
  rol: UserRole;
  permisos: string[];
  activo: boolean;
  tema?: ThemePreference;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicUser {
  id: string;
  nombre: string;
  email: string;
  loginUsername: string;
  rol: UserRole;
  permisos: string[];
  activo: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
  tema?: ThemePreference;
  createdAt?: string;
  updatedAt?: string;
}

function usersCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/usuarios`);
}

function normalizeEmail(email: unknown): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}

function normalizeLogin(login: unknown): string {
  return String(login ?? '')
    .trim()
    .toLowerCase();
}

function normalizeTheme(value: unknown): ThemePreference {
  return value === 'dark' ? 'dark' : 'light';
}

function mapStoredUser(id: string, data: Record<string, unknown>): StoredUser {
  const rol: UserRole =
    data.rol === 'supervisor' || data.rol === 'admin' ? data.rol : 'staff';

  return {
    id,
    nombre: String(data.nombre ?? '').trim(),
    email: normalizeEmail(data.email),
    loginUsername: normalizeLogin(data.loginUsername),
    passwordHash: data.passwordHash ? String(data.passwordHash) : undefined,
    googleId: data.googleId ? String(data.googleId) : undefined,
    rol,
    permisos: rol === 'staff' ? sanitizeStaffPermissions(data.permisos) : [],
    activo: data.activo !== false,
    tema: normalizeTheme(data.tema),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    loginUsername: user.loginUsername,
    rol: user.rol,
    permisos: user.permisos,
    activo: user.activo,
    hasPassword: !!user.passwordHash,
    hasGoogle: !!user.googleId,
    tema: user.tema ?? 'light',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function ensureDefaultSupervisor(
  businessId = DEFAULT_BUSINESS_ID
): Promise<void> {
  const col = usersCollection(businessId);
  const snapshot = await col.get();
  if (!snapshot.empty) return;

  const passwordHash = await hashPassword('admin');
  await col.add({
    nombre: 'Supervisor',
    loginUsername: 'admin',
    email: '',
    passwordHash,
    rol: 'supervisor',
    permisos: [],
    activo: true,
    createdAt: new Date().toISOString(),
  });
}

export async function listUsers(businessId: string): Promise<PublicUser[]> {
  await ensureDefaultSupervisor(businessId);
  const snapshot = await usersCollection(businessId).get();
  return snapshot.docs
    .map((doc) => toPublicUser(mapStoredUser(doc.id, doc.data())))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function getStoredUser(
  businessId: string,
  userId: string
): Promise<StoredUser | null> {
  const doc = await usersCollection(businessId).doc(userId).get();
  if (!doc.exists) return null;
  return mapStoredUser(doc.id, doc.data()!);
}

export async function findUserByLoginOrEmail(
  businessId: string,
  login: string
): Promise<StoredUser | null> {
  await ensureDefaultSupervisor(businessId);
  const normalized = normalizeLogin(login);
  if (!normalized) return null;

  const snapshot = await usersCollection(businessId).get();
  for (const doc of snapshot.docs) {
    const user = mapStoredUser(doc.id, doc.data());
    if (
      user.loginUsername === normalized ||
      (user.email && user.email === normalized)
    ) {
      return user;
    }
  }
  return null;
}

export async function findUserByEmail(
  businessId: string,
  email: string
): Promise<StoredUser | null> {
  await ensureDefaultSupervisor(businessId);
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const snapshot = await usersCollection(businessId).get();
  for (const doc of snapshot.docs) {
    const user = mapStoredUser(doc.id, doc.data());
    if (user.email === normalized) return user;
  }
  return null;
}

export async function linkGoogleId(
  businessId: string,
  userId: string,
  googleId: string
): Promise<void> {
  await usersCollection(businessId).doc(userId).update({
    googleId,
    updatedAt: new Date().toISOString(),
  });
}

export async function assertUserLoginAndEmailAvailable(
  businessId: string,
  params: { loginUsername: string; email?: string; excludeUserId: string }
): Promise<void> {
  const snapshot = await usersCollection(businessId).get();
  for (const doc of snapshot.docs) {
    if (doc.id === params.excludeUserId) continue;
    const user = mapStoredUser(doc.id, doc.data());
    if (user.loginUsername === params.loginUsername) {
      throw new Error('LOGIN_USERNAME_TAKEN');
    }
    if (params.email && user.email && user.email === params.email) {
      throw new Error('EMAIL_TAKEN');
    }
  }
}

export async function updateUserProfile(
  businessId: string,
  userId: string,
  payload: { nombre: string; email: string; loginUsername: string }
): Promise<StoredUser> {
  const nombre = String(payload.nombre ?? '').trim();
  const email = normalizeEmail(payload.email);
  const loginUsername = normalizeLogin(payload.loginUsername);

  if (!nombre) {
    throw new Error('NAME_REQUIRED');
  }
  if (!loginUsername) {
    throw new Error('LOGIN_REQUIRED');
  }

  await assertUserLoginAndEmailAvailable(businessId, {
    loginUsername,
    email: email || undefined,
    excludeUserId: userId,
  });

  await usersCollection(businessId).doc(userId).update({
    nombre,
    email,
    loginUsername,
    updatedAt: new Date().toISOString(),
  });

  const updated = await getStoredUser(businessId, userId);
  if (!updated) {
    throw new Error('USER_NOT_FOUND');
  }
  return updated;
}

export async function countActiveSupervisors(businessId: string): Promise<number> {
  const snapshot = await usersCollection(businessId)
    .where('rol', '==', 'supervisor')
    .where('activo', '==', true)
    .get();
  return snapshot.size;
}

export async function countActiveAdministrators(businessId: string): Promise<number> {
  const snapshot = await usersCollection(businessId).where('activo', '==', true).get();
  return snapshot.docs.filter((doc) => {
    const rol = doc.data().rol;
    return rol === 'supervisor' || rol === 'admin';
  }).length;
}

export async function countActiveOperators(businessId: string): Promise<number> {
  const snapshot = await usersCollection(businessId)
    .where('rol', '==', 'staff')
    .where('activo', '==', true)
    .get();
  return snapshot.size;
}

export async function countActiveUsers(businessId: string): Promise<number> {
  const snapshot = await usersCollection(businessId)
    .where('activo', '==', true)
    .get();
  return snapshot.size;
}
