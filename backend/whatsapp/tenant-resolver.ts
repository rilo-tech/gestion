import type { DocumentReference, QueryDocumentSnapshot } from 'firebase-admin/firestore';
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
    // Solo baja real: enabled === false. Si está habilitado, nunca marcar offboarded.
    accessRevoked: disabled,
  };
}

async function lookupByPhoneField(
  keys: string[],
  options?: { allowDisabled?: boolean; businessId?: string }
): Promise<WhatsappTenantContext | null> {
  for (const key of keys) {
    try {
      const query = options?.businessId
        ? db.collection(`negocios/${options.businessId}/whatsapp_users`).where('phone', '==', key).limit(5)
        : db.collectionGroup('whatsapp_users').where('phone', '==', key).limit(8);
      const usersSnap = await query.get();
      let revokedFallback: WhatsappTenantContext | null = null;
      for (const doc of usersSnap.docs) {
        const tenant = await tenantFromUserDoc(doc, options);
        if (!tenant) continue;
        if (!tenant.accessRevoked) return tenant;
        if (options?.allowDisabled && !revokedFallback) revokedFallback = tenant;
      }
      if (options?.allowDisabled && revokedFallback) return revokedFallback;
    } catch (error) {
      if (!options?.businessId) {
        console.warn('[whatsapp] Collection group phone lookup omitida', {
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }
  return null;
}

async function lookupByPreviousPhone(
  keys: string[],
  options?: { businessId?: string }
): Promise<WhatsappTenantContext | null> {
  for (const key of keys) {
    try {
      const query = options?.businessId
        ? db
            .collection(`negocios/${options.businessId}/whatsapp_users`)
            .where('previousPhone', '==', key)
            .limit(5)
        : db.collectionGroup('whatsapp_users').where('previousPhone', '==', key).limit(8);
      const prevSnap = await query.get();
      let revokedFallback: WhatsappTenantContext | null = null;
      for (const doc of prevSnap.docs) {
        const tenant = await tenantFromUserDoc(doc, { allowDisabled: true });
        if (!tenant) continue;
        // Si reactivaron la línea (enabled) pero quedó previousPhone, es activa.
        if (!tenant.accessRevoked) return tenant;
        if (!revokedFallback) revokedFallback = { ...tenant, accessRevoked: true };
      }
      if (revokedFallback) return revokedFallback;
    } catch (error) {
      if (!options?.businessId) {
        console.warn('[whatsapp] Collection group previousPhone lookup omitida', {
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
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
    (await lookupByPhoneField(keys, { businessId: 'prueba' })) ??
    (await lookupByPhoneField(keys));
  if (enabled && !enabled.accessRevoked) {
    console.log('[whatsapp] Tenant hallado', { businessId: enabled.businessId, ms: Date.now() - started });
    return enabled;
  }

  const revoked =
    (await lookupByPhoneField(keys, { businessId: 'prueba', allowDisabled: true })) ??
    (await lookupByPhoneField(keys, { allowDisabled: true })) ??
    (await lookupByPreviousPhone(keys, { businessId: 'prueba' })) ??
    (await lookupByPreviousPhone(keys));
  if (revoked) {
    // Defensa: un doc reactivado nunca debe responder como baja.
    if (!revoked.accessRevoked) {
      console.log('[whatsapp] Tenant hallado (reactivado)', {
        businessId: revoked.businessId,
        ms: Date.now() - started,
      });
      return revoked;
    }
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
