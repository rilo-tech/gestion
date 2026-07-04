import { db } from '../firebase.ts';

export function slugifyBusinessId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export async function allocateUniqueBusinessId(baseName: string): Promise<string> {
  const base = slugifyBusinessId(baseName) || 'empresa';
  let candidate = base;
  let suffix = 0;

  while (suffix < 200) {
    const ref = db.collection('negocios').doc(candidate);
    const snap = await ref.get();
    if (!snap.exists) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  throw new Error('BUSINESS_ID_EXHAUSTED');
}
