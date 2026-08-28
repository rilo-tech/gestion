import type {
  DocumentReference,
  QueryDocumentSnapshot,
  QuerySnapshot,
} from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import { resolvePlatformAccessForBusiness } from '../auth/platform-access.ts';
import { normalizePhone } from '../../shared/phone.ts';

export interface WhatsappTenantContext {
  businessId: string;
  phone: string;
  userName?: string;
  role?: string;
  /** Rubro del negocio (registro / config). Sin esto RILO Bot no inventa ejemplos de producto. */
  rubro?: string | null;
  platformAccess: ReturnType<typeof resolvePlatformAccessForBusiness>;
  /** Línea de WhatsApp deshabilitada (baja). */
  accessRevoked?: boolean;
}

type LookupOptions = { allowDisabled?: boolean; businessId?: string };

type LookupResult = {
  active: WhatsappTenantContext | null;
  revoked: WhatsappTenantContext | null;
  /** true si falló collectionGroup (p.ej. falta índice). */
  failed?: boolean;
};

const COLLECTION_GROUP_TIMEOUT_MS = 8000;
const CONTACT_LOOKUP_TIMEOUT_MS = 4000;
const SCAN_QUERY_TIMEOUT_MS = 8000;
const TENANT_CACHE_MS = 5 * 60 * 1000;

const tenantCache = new Map<string, { exp: number; tenant: WhatsappTenantContext }>();

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rubroFromBusinessData(data: Record<string, unknown> | undefined): string | null {
  const life = data?.lifecycle as { rubro?: unknown } | undefined;
  const fromLife = typeof life?.rubro === 'string' ? life.rubro.trim() : '';
  if (fromLife) return fromLife;
  return null;
}

async function resolveBusinessRubro(
  businessRef: DocumentReference,
  data: Record<string, unknown>
): Promise<string | null> {
  const fromLife = rubroFromBusinessData(data);
  if (fromLife) return fromLife;
  try {
    const cfg = await businessRef.collection('config').doc('app').get();
    const onboarding = cfg.data()?.onboarding as { rubro?: unknown } | undefined;
    const fromCfg = typeof onboarding?.rubro === 'string' ? onboarding.rubro.trim() : '';
    return fromCfg || null;
  } catch {
    return null;
  }
}

function phoneLookupKeys(phone: string): string[] {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, '');
  const withPlus = digits ? `+${digits}` : '';
  const normalized = normalizePhone(raw);
  return [...new Set([raw, withPlus, normalized].filter((value) => value.length > 0))];
}

async function tenantFromUserDoc(
  userDoc: QueryDocumentSnapshot,
  options?: { allowDisabled?: boolean }
): Promise<WhatsappTenantContext | null> {
  const businessRef = userDoc.ref.parent.parent;
  if (!businessRef) return null;
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) return null;
  const user = userDoc.data() as {
    phone?: string;
    previousPhone?: string;
    name?: string;
    role?: string;
    enabled?: boolean;
  };
  const disabled = user.enabled === false;
  if (disabled && !options?.allowDisabled) return null;
  const businessData = (businessSnap.data() ?? {}) as Record<string, unknown>;
  const activePhone = String(user.phone ?? '').trim() || String(user.previousPhone ?? '').trim();
  return {
    businessId: businessRef.id,
    phone: activePhone,
    userName: user.name,
    role: user.role,
    rubro: await resolveBusinessRubro(businessRef, businessData),
    platformAccess: resolvePlatformAccessForBusiness(businessData),
    accessRevoked: disabled,
  };
}

async function collectFromQuery(
  usersSnap: QuerySnapshot,
  options?: LookupOptions
): Promise<LookupResult> {
  let active: WhatsappTenantContext | null = null;
  let revoked: WhatsappTenantContext | null = null;
  for (const doc of usersSnap.docs) {
    const tenant = await tenantFromUserDoc(doc, options);
    if (!tenant) continue;
    if (!tenant.accessRevoked) {
      active = tenant;
      break;
    }
    if (options?.allowDisabled && !revoked) revoked = tenant;
  }
  return { active, revoked };
}

async function lookupByPhoneField(keys: string[], options?: LookupOptions): Promise<LookupResult> {
  let revoked: WhatsappTenantContext | null = null;
  const scoped = Boolean(options?.businessId);
  for (const key of keys) {
    try {
      const query = scoped
        ? db.collection(`negocios/${options!.businessId}/whatsapp_users`).where('phone', '==', key).limit(5)
        : db.collectionGroup('whatsapp_users').where('phone', '==', key).limit(8);
      const usersSnap = await withTimeout(query.get(), scoped ? 5000 : COLLECTION_GROUP_TIMEOUT_MS);
      if (usersSnap === 'timeout') {
        if (!scoped) {
          console.warn('[whatsapp] Collection group phone lookup timeout');
          return { active: null, revoked: null, failed: true };
        }
        continue;
      }
      const found = await collectFromQuery(usersSnap, options);
      if (found.active) return found;
      if (!revoked && found.revoked) revoked = found.revoked;
    } catch (error) {
      if (!scoped) {
        console.warn('[whatsapp] Collection group phone lookup omitida', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { active: null, revoked: null, failed: true };
      }
    }
  }
  return { active: null, revoked };
}

async function lookupByPreviousPhone(
  keys: string[],
  options?: { businessId?: string }
): Promise<LookupResult> {
  let revoked: WhatsappTenantContext | null = null;
  for (const key of keys) {
    try {
      const query = options?.businessId
        ? db
            .collection(`negocios/${options.businessId}/whatsapp_users`)
            .where('previousPhone', '==', key)
            .limit(5)
        : db.collectionGroup('whatsapp_users').where('previousPhone', '==', key).limit(8);
      const prevSnap = await withTimeout(
        query.get(),
        options?.businessId ? 5000 : COLLECTION_GROUP_TIMEOUT_MS
      );
      if (prevSnap === 'timeout') {
        if (!options?.businessId) {
          console.warn('[whatsapp] Collection group previousPhone lookup timeout');
          return { active: null, revoked: null, failed: true };
        }
        continue;
      }
      const found = await collectFromQuery(prevSnap, { allowDisabled: true });
      if (found.active) return found;
      if (!revoked && found.revoked) revoked = found.revoked;
    } catch (error) {
      if (!options?.businessId) {
        console.warn('[whatsapp] Collection group previousPhone lookup omitida', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { active: null, revoked: null, failed: true };
      }
    }
  }
  return { active: null, revoked };
}

/** Fallback si falta el índice collectionGroup: busca por negocio (contacto o scan). */
async function lookupUsersInBusinesses(
  businessIds: Iterable<string>,
  keys: string[],
  options?: { allowDisabled?: boolean }
): Promise<LookupResult> {
  let revoked: WhatsappTenantContext | null = null;
  for (const businessId of businessIds) {
    for (const key of keys) {
      const byPhone = await withTimeout(
        db.collection(`negocios/${businessId}/whatsapp_users`).where('phone', '==', key).limit(5).get(),
        SCAN_QUERY_TIMEOUT_MS
      );
      if (byPhone === 'timeout') {
        console.warn('[whatsapp] Scan phone lookup timeout', { businessId });
        continue;
      }
      const foundPhone = await collectFromQuery(byPhone, options);
      if (foundPhone.active) return foundPhone;
      if (!revoked && foundPhone.revoked) revoked = foundPhone.revoked;

      if (options?.allowDisabled) {
        const byPrev = await withTimeout(
          db
            .collection(`negocios/${businessId}/whatsapp_users`)
            .where('previousPhone', '==', key)
            .limit(5)
            .get(),
          SCAN_QUERY_TIMEOUT_MS
        );
        if (byPrev === 'timeout') continue;
        const foundPrev = await collectFromQuery(byPrev, { allowDisabled: true });
        if (foundPrev.active) return foundPrev;
        if (!revoked && foundPrev.revoked) revoked = foundPrev.revoked;
      }
    }
  }
  return { active: null, revoked };
}

async function lookupByScanningBusinesses(
  keys: string[],
  options?: { allowDisabled?: boolean }
): Promise<LookupResult> {
  const known = await lookupUsersInBusinesses(['rilo', 'prueba'], keys, options);
  if (known.active) return known;

  const extraIds = new Set<string>();
  for (const key of keys) {
    try {
      const snap = await withTimeout(
        db.collection('negocios').where('contactVerification.phone', '==', key).limit(10).get(),
        CONTACT_LOOKUP_TIMEOUT_MS
      );
      if (snap === 'timeout') continue;
      for (const doc of snap.docs) {
        if (doc.id !== 'rilo' && doc.id !== 'prueba') extraIds.add(doc.id);
      }
    } catch {
      /* índice de contacto opcional */
    }
  }

  if (!extraIds.size) return known;
  const extra = await lookupUsersInBusinesses(extraIds, keys, options);
  if (extra.active) return extra;
  return { active: null, revoked: extra.revoked ?? known.revoked };
}

/** Resuelve negocio y usuario autorizado por teléfono E.164. */
export async function resolveTenantByPhone(phone: string): Promise<WhatsappTenantContext | null> {
  const keys = phoneLookupKeys(phone);
  if (!keys.length) return null;
  const cacheKey = keys[0]!;
  const cached = tenantCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached.tenant;
  const started = Date.now();

  const remember = (tenant: WhatsappTenantContext) => {
    tenantCache.set(cacheKey, { exp: Date.now() + TENANT_CACHE_MS, tenant });
    return tenant;
  };

  // 1) Índice collectionGroup (rápido). Scan de rilo/prueba solo si falla o no hay match.
  const cgActive = await lookupByPhoneField(keys);
  if (cgActive.active) {
    console.log('[whatsapp] Tenant hallado', {
      businessId: cgActive.active.businessId,
      ms: Date.now() - started,
      via: 'collectionGroup',
    });
    return remember(cgActive.active);
  }

  const scannedActive = await lookupByScanningBusinesses(keys);
  if (scannedActive.active) {
    console.log('[whatsapp] Tenant hallado', {
      businessId: scannedActive.active.businessId,
      ms: Date.now() - started,
      via: 'scan',
    });
    return remember(scannedActive.active);
  }

  // 2) Solo si no hay línea activa: baja / previousPhone.
  const cgRevoked = await lookupByPhoneField(keys, { allowDisabled: true });
  const prevCg = await lookupByPreviousPhone(keys);
  const scannedRevoked = await lookupByScanningBusinesses(keys, { allowDisabled: true });

  const revoked =
    (cgRevoked.revoked && cgRevoked.revoked.accessRevoked ? cgRevoked.revoked : null) ??
    (prevCg.active && !prevCg.active.accessRevoked ? prevCg.active : null) ??
    (prevCg.revoked && prevCg.revoked.accessRevoked ? prevCg.revoked : null) ??
    scannedRevoked.revoked ??
    scannedActive.revoked;

  if (revoked) {
    if (!revoked.accessRevoked) {
      console.log('[whatsapp] Tenant hallado (reactivado)', {
        businessId: revoked.businessId,
        ms: Date.now() - started,
      });
      return remember(revoked);
    }
    console.log('[whatsapp] Tenant dado de baja', {
      businessId: revoked.businessId,
      ms: Date.now() - started,
    });
    return remember({ ...revoked, accessRevoked: true });
  }

  console.log('[whatsapp] Tenant no hallado', { ms: Date.now() - started });
  return null;
}

export async function resolveOwnerPhoneForBusiness(businessId: string): Promise<string | null> {
  const ownerSnap = await db
    .collection(`negocios/${businessId}/whatsapp_users`)
    .where('enabled', '==', true)
    .limit(1)
    .get();
  if (!ownerSnap.empty) {
    const phone = ownerSnap.docs[0]!.data().phone;
    if (typeof phone === 'string' && phone.trim()) return phone.trim();
  }
  return null;
}

/** Libera un teléfono de líneas deshabilitadas en otras empresas (queda solo previousPhone). */
export async function clearDisabledPhoneElsewhere(
  phone: string,
  keepBusinessId: string
): Promise<number> {
  const keys = phoneLookupKeys(phone);
  let cleared = 0;
  const businesses = await db.collection('negocios').limit(100).get();
  for (const biz of businesses.docs) {
    if (biz.id === keepBusinessId) continue;
    for (const key of keys) {
      const snap = await db
        .collection(`negocios/${biz.id}/whatsapp_users`)
        .where('phone', '==', key)
        .get();
      for (const doc of snap.docs) {
        if (doc.data()?.enabled === false) {
          await doc.ref.set(
            {
              phone: FieldValue.delete(),
              previousPhone: key,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
          cleared += 1;
        }
      }
    }
  }
  return cleared;
}
