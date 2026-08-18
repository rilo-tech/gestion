import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import { resolvePlatformAccessForBusiness } from '../auth/platform-access.ts';
import { normalizePhone } from '../../shared/phone.ts';

export interface WhatsappTenantContext {
  businessId: string;
  phone: string;
  userName?: string;
  role?: string;
  /** Rubro del negocio (registro / config). Sin esto RiloBot no inventa ejemplos de producto. */
  rubro?: string | null;
  platformAccess: ReturnType<typeof resolvePlatformAccessForBusiness>;
  /** Línea de WhatsApp deshabilitada (baja). */
  accessRevoked?: boolean;
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
  const user = userDoc.data() as { phone?: string; name?: string; role?: string; enabled?: boolean };
  const disabled = user.enabled === false;
  if (disabled && !options?.allowDisabled) return null;
  const businessData = (businessSnap.data() ?? {}) as Record<string, unknown>;
  return {
    businessId: businessRef.id,
    phone: String(user.phone ?? ''),
    userName: user.name,
    role: user.role,
    rubro: await resolveBusinessRubro(businessRef, businessData),
    platformAccess: resolvePlatformAccessForBusiness(businessData),
    accessRevoked: disabled,
  };
}

async function lookupInBusiness(
  businessId: string,
  keys: string[],
  options?: { allowDisabled?: boolean }
): Promise<WhatsappTenantContext | null> {
  for (const key of keys) {
    const usersSnap = await db
      .collection(`negocios/${businessId}/whatsapp_users`)
      .where('phone', '==', key)
      .limit(5)
      .get();
    for (const doc of usersSnap.docs) {
      const tenant = await tenantFromUserDoc(doc, options);
      if (tenant) return tenant;
    }
    if (options?.allowDisabled) {
      const prevSnap = await db
        .collection(`negocios/${businessId}/whatsapp_users`)
        .where('previousPhone', '==', key)
        .limit(5)
        .get();
      for (const doc of prevSnap.docs) {
        const tenant = await tenantFromUserDoc(doc, { allowDisabled: true });
        if (tenant) return { ...tenant, accessRevoked: true };
      }
    }
  }
  return null;
}

async function lookupCollectionGroup(
  keys: string[],
  options?: { allowDisabled?: boolean }
): Promise<WhatsappTenantContext | null> {
  for (const key of keys) {
    try {
      const usersSnap = await db
        .collectionGroup('whatsapp_users')
        .where('phone', '==', key)
        .limit(8)
        .get();
      for (const doc of usersSnap.docs) {
        const tenant = await tenantFromUserDoc(doc, options);
        if (tenant && (options?.allowDisabled || !tenant.accessRevoked)) {
          return tenant;
        }
        if (options?.allowDisabled && tenant?.accessRevoked) {
          return tenant;
        }
      }
    } catch (error) {
      console.warn('[whatsapp] Collection group phone lookup omitida', {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  return null;
}

/** Resuelve negocio y usuario autorizado por teléfono E.164. */
export async function resolveTenantByPhone(phone: string): Promise<WhatsappTenantContext | null> {
  const keys = phoneLookupKeys(phone);
  if (!keys.length) return null;
  const started = Date.now();

  const enabled =
    (await lookupInBusiness('prueba', keys)) ?? (await lookupCollectionGroup(keys));
  if (enabled && !enabled.accessRevoked) {
    console.log('[whatsapp] Tenant hallado', { businessId: enabled.businessId, ms: Date.now() - started });
    return enabled;
  }

  const revoked =
    (await lookupInBusiness('prueba', keys, { allowDisabled: true })) ??
    (await lookupCollectionGroup(keys, { allowDisabled: true }));
  if (revoked) {
    console.log('[whatsapp] Tenant dado de baja', {
      businessId: revoked.businessId,
      ms: Date.now() - started,
    });
    return { ...revoked, accessRevoked: true };
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
