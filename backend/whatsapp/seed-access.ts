import { db } from '../firebase.ts';
import { isValidE164Phone, normalizePhone } from '../../shared/phone.ts';
import { isTrialProductId, type TrialProductId } from '../../shared/platform-access.ts';

function resolveE164Phone(raw: string): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (isValidE164Phone(trimmed)) return trimmed;
  const normalized = normalizePhone(trimmed);
  return normalized && isValidE164Phone(normalized) ? normalized : null;
}

/**
 * Habilita WhatsApp del negocio con el teléfono del responsable
 * (alta landing Bot/Completo o alta manual con producto WhatsApp).
 */
export async function seedBusinessWhatsappAccess(params: {
  businessId: string;
  phone: string;
  ownerName: string;
  trialProduct?: TrialProductId | string | null;
  /** Si true, crea la línea aunque el producto no sea Bot (solo opt-in). */
  forceLine?: boolean;
  erpUserId?: string | null;
  status?: 'trial' | 'active';
}): Promise<{ seeded: boolean; phone: string | null }> {
  const phone = resolveE164Phone(params.phone);
  if (!phone) return { seeded: false, phone: null };

  const product =
    params.trialProduct && isTrialProductId(params.trialProduct) ? params.trialProduct : null;
  const productWantsWhatsapp = product === 'whatsapp' || product === 'completo';
  if (!productWantsWhatsapp && !params.forceLine) {
    return { seeded: false, phone };
  }

  const now = new Date().toISOString();
  await db.collection(`negocios/${params.businessId}/whatsapp_users`).doc('owner').set(
    {
      phone,
      name: params.ownerName.trim() || 'Responsable',
      role: 'supervisor',
      enabled: true,
      erpUserId: params.erpUserId ?? null,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection(`negocios/${params.businessId}/whatsapp_config`).doc('default').set(
    {
      enabled: productWantsWhatsapp || params.forceLine === true,
      mode: 'central',
      status: params.status ?? (productWantsWhatsapp ? 'trial' : 'active'),
      requireConfirmation: true,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('negocios').doc(params.businessId).set(
    {
      suscripcion: {
        limiteWhatsapp: 1,
      },
      updatedAt: now,
    },
    { merge: true }
  );

  return { seeded: true, phone };
}

/** Al dar de baja: el celular deja de resolver a esta empresa para que otro alta pueda usarlo. */
export async function releaseBusinessWhatsappPhone(businessId: string): Promise<number> {
  const now = new Date().toISOString();
  const usersSnap = await db.collection(`negocios/${businessId}/whatsapp_users`).get();
  let released = 0;
  for (const doc of usersSnap.docs) {
    const phone = String(doc.data()?.phone ?? '').trim();
    if (!phone && doc.data()?.enabled === false) continue;
    await doc.ref.set(
      {
        enabled: false,
        previousPhone: phone || doc.data()?.previousPhone || null,
        releasedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    released += 1;
  }
  await db.collection(`negocios/${businessId}/whatsapp_config`).doc('default').set(
    {
      enabled: false,
      updatedAt: now,
    },
    { merge: true }
  );
  return released;
}
