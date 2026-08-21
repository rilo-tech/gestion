import { getStoredUser } from './users.ts';
import { verifyPassword } from './password.ts';
import { getBusiness } from './business.ts';

export async function assertSupervisorActionSecret(params: {
  businessId: string;
  userId: string;
  password?: string;
  confirmNombre?: string;
}): Promise<void> {
  const user = await getStoredUser(params.businessId, params.userId);
  if (!user || user.activo === false) {
    throw new Error('USER_NOT_FOUND');
  }

  if (user.passwordHash) {
    const password = String(params.password ?? '');
    if (!password) throw new Error('PASSWORD_REQUIRED');
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new Error('PASSWORD_INVALID');
    return;
  }

  const business = await getBusiness(params.businessId);
  const expected = String(business?.nombre ?? '').trim().toLowerCase();
  const got = String(params.confirmNombre ?? '').trim().toLowerCase();
  if (!expected || got !== expected) throw new Error('CONFIRM_NAME_REQUIRED');
}
