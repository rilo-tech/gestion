import { db } from '../firebase.ts';
import {
  resolveBusinessProfile,
  type BusinessProfileDefaults,
} from '../../shared/business-profile.ts';

export type OperationalDefaults = BusinessProfileDefaults;

const cache = new Map<string, { exp: number; defaults: OperationalDefaults }>();
const CACHE_MS = 60_000;

export async function loadBusinessOperationalDefaults(businessId: string): Promise<OperationalDefaults> {
  const key = businessId.trim();
  if (!key) return {};
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.defaults;

  const snap = await db.doc(`negocios/${key}`).get();
  const profile = resolveBusinessProfile(
    (snap.data()?.businessProfile as Partial<import('../../shared/business-profile.ts').BusinessProfile>) ??
      undefined
  );
  const defaults = profile.defaults ?? {};
  cache.set(key, { exp: Date.now() + CACHE_MS, defaults });
  return defaults;
}

export function effectiveDefaultCashAccountId(defaults: OperationalDefaults): string | undefined {
  const id = String(defaults.defaultCashAccountId ?? '').trim().toLowerCase();
  return id || undefined;
}

export function invalidateBusinessDefaultsCache(businessId?: string): void {
  if (businessId) {
    cache.delete(businessId.trim());
    return;
  }
  cache.clear();
}
