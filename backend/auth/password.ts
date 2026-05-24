import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  passwordHash: string | undefined
): Promise<boolean> {
  if (!passwordHash?.trim()) return false;
  return bcrypt.compare(plain, passwordHash);
}
