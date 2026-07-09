import { db } from '../firebase.ts';
import { resolvePlatformAccessForBusiness } from '../auth/platform-access.ts';

export interface WhatsappTenantContext {
  businessId: string;
  phone: string;
  userName?: string;
  role?: string;
  platformAccess: ReturnType<typeof resolvePlatformAccessForBusiness>;
}

/** Resuelve negocio y usuario autorizado por teléfono E.164. */
export async function resolveTenantByPhone(phone: string): Promise<WhatsappTenantContext | null> {
  const normalized = phone.trim();
  if (!normalized) return null;

  const businesses = await db.collection('negocios').get();
  for (const doc of businesses.docs) {
    const usersSnap = await db
      .collection(`negocios/${doc.id}/whatsapp_users`)
      .where('phone', '==', normalized)
      .where('enabled', '==', true)
      .limit(1)
      .get();
    if (usersSnap.empty) continue;

    const user = usersSnap.docs[0]!.data() as {
      phone?: string;
      name?: string;
      role?: string;
    };
    const businessData = doc.data() as Record<string, unknown>;
    return {
      businessId: doc.id,
      phone: normalized,
      userName: user.name,
      role: user.role,
      platformAccess: resolvePlatformAccessForBusiness(businessData),
    };
  }
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
