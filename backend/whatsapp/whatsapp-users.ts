import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import { isValidE164Phone, normalizePhone } from '../../shared/phone.ts';

export type WhatsappUserRole = 'supervisor' | 'admin' | 'operador';

export type WhatsappLineKind = 'primary' | 'extra';
export type WhatsappLineStatus = 'active' | 'pending' | 'disconnected';

export interface WhatsappUserRecord {
  id: string;
  phone: string;
  name: string;
  role: WhatsappUserRole;
  enabled: boolean;
  erpUserId: string | null;
  kind?: WhatsappLineKind;
  status?: WhatsappLineStatus;
  addedAt?: string;
  addedBy?: string;
  releasedAt?: string;
  releasedBy?: string;
  previousPhone?: string;
  createdAt?: string;
  updatedAt?: string;
}

function collection(businessId: string) {
  return db.collection(`negocios/${businessId}/whatsapp_users`);
}

function normalizeRole(value: unknown): WhatsappUserRole {
  if (value === 'admin' || value === 'supervisor') return value;
  if (value === 'staff' || value === 'operador') return 'operador';
  return 'operador';
}

function normalizeKind(value: unknown, id: string): WhatsappLineKind {
  if (value === 'extra') return 'extra';
  if (value === 'primary' || id === 'owner') return 'primary';
  return 'extra';
}

function normalizeStatus(value: unknown, enabled: boolean, phone: string): WhatsappLineStatus {
  if (value === 'pending' || value === 'disconnected' || value === 'active') return value;
  if (!enabled) return 'disconnected';
  if (!phone.trim()) return 'pending';
  return 'active';
}

function mapWhatsappUser(id: string, data: Record<string, unknown>): WhatsappUserRecord {
  const phone = String(data.phone ?? '').trim();
  const enabled = data.enabled !== false;
  return {
    id,
    phone,
    name: String(data.name ?? '').trim(),
    role: normalizeRole(data.role),
    enabled,
    erpUserId:
      typeof data.erpUserId === 'string' && data.erpUserId.trim()
        ? data.erpUserId.trim()
        : null,
    kind: normalizeKind(data.kind, id),
    status: normalizeStatus(data.status, enabled, phone),
    addedAt: data.addedAt ? String(data.addedAt) : data.createdAt ? String(data.createdAt) : undefined,
    addedBy: data.addedBy ? String(data.addedBy) : undefined,
    releasedAt: data.releasedAt ? String(data.releasedAt) : undefined,
    releasedBy: data.releasedBy ? String(data.releasedBy) : undefined,
    previousPhone: data.previousPhone ? String(data.previousPhone) : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
}

export function normalizeWhatsappPhoneInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isValidE164Phone(trimmed)) return trimmed;
  const normalized = normalizePhone(trimmed);
  if (normalized && isValidE164Phone(normalized)) return normalized;
  return null;
}

export async function listWhatsappUsers(businessId: string): Promise<WhatsappUserRecord[]> {
  const snap = await collection(businessId).get();
  return snap.docs
    .map((doc) => mapWhatsappUser(doc.id, doc.data() as Record<string, unknown>))
    .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.phone.localeCompare(b.phone));
}

export async function countEnabledWhatsappUsers(businessId: string): Promise<number> {
  const snap = await collection(businessId).where('enabled', '==', true).get();
  return snap.size;
}

/** Busca si el teléfono ya está autorizado (activo) en otra (o la misma) empresa. */
export async function findWhatsappPhoneOwner(
  phone: string,
  exceptBusinessId?: string
): Promise<{ businessId: string; userId: string } | null> {
  const normalized = phone.trim();
  if (!normalized) return null;
  const businesses = await db.collection('negocios').get();
  for (const doc of businesses.docs) {
    if (exceptBusinessId && doc.id === exceptBusinessId) continue;
    const usersSnap = await db
      .collection(`negocios/${doc.id}/whatsapp_users`)
      .where('phone', '==', normalized)
      .limit(5)
      .get();
    for (const userDoc of usersSnap.docs) {
      // Líneas dadas de baja no bloquean reutilizar el número.
      if (userDoc.data()?.enabled === false) continue;
      return { businessId: doc.id, userId: userDoc.id };
    }
  }
  return null;
}

export async function upsertWhatsappUser(
  businessId: string,
  payload: {
    id?: string;
    phone: string;
    name: string;
    role?: WhatsappUserRole | string;
    enabled?: boolean;
    erpUserId?: string | null;
  }
): Promise<WhatsappUserRecord> {
  const phone = normalizeWhatsappPhoneInput(payload.phone);
  if (!phone) {
    throw new Error('INVALID_PHONE');
  }
  const name = String(payload.name ?? '').trim() || phone;
  const role = normalizeRole(payload.role);
  const enabled = payload.enabled !== false;
  const erpUserId =
    typeof payload.erpUserId === 'string' && payload.erpUserId.trim()
      ? payload.erpUserId.trim()
      : null;

  const owner = await findWhatsappPhoneOwner(phone, businessId);
  if (owner) {
    throw new Error('PHONE_IN_USE');
  }

  const sameInBusiness = await collection(businessId).where('phone', '==', phone).limit(2).get();
  let otherDoc = sameInBusiness.docs.find((doc) => doc.id !== payload.id);

  // Reutiliza la línea liberada (phone borrado, previousPhone = este número).
  if (!otherDoc && !payload.id) {
    const prevSnap = await collection(businessId).where('previousPhone', '==', phone).limit(1).get();
    otherDoc = prevSnap.docs[0];
  }

  if (payload.id && otherDoc) {
    throw new Error('PHONE_IN_USE');
  }

  const now = new Date().toISOString();
  const ref = payload.id
    ? collection(businessId).doc(payload.id)
    : otherDoc
      ? otherDoc.ref
      : collection(businessId).doc();

  const clearRelease =
    enabled === true
      ? { previousPhone: FieldValue.delete(), releasedAt: FieldValue.delete() }
      : {};

  if (payload.id) {
    const existing = await ref.get();
    if (!existing.exists) throw new Error('WHATSAPP_USER_NOT_FOUND');
    const prev = existing.data() as Record<string, unknown>;
    await ref.set(
      {
        phone,
        name,
        role,
        enabled,
        erpUserId,
        ...clearRelease,
        createdAt: prev.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    const existing = await ref.get();
    await ref.set(
      {
        phone,
        name,
        role,
        enabled,
        erpUserId,
        ...clearRelease,
        createdAt: existing.exists
          ? ((existing.data() as Record<string, unknown>).createdAt ?? now)
          : now,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  const saved = await ref.get();
  return mapWhatsappUser(saved.id, saved.data() as Record<string, unknown>);
}

export async function setWhatsappUserEnabled(
  businessId: string,
  userId: string,
  enabled: boolean
): Promise<WhatsappUserRecord> {
  const ref = collection(businessId).doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('WHATSAPP_USER_NOT_FOUND');
  const data = snap.data() as Record<string, unknown>;
  const now = new Date().toISOString();
  if (enabled === true) {
    const currentPhone = String(data.phone ?? '').trim();
    const previousPhone = String(data.previousPhone ?? '').trim();
    const restorePhone = currentPhone || previousPhone;
    await ref.set(
      {
        enabled: true,
        status: 'active',
        ...(restorePhone ? { phone: restorePhone } : {}),
        previousPhone: FieldValue.delete(),
        releasedAt: FieldValue.delete(),
        releasedBy: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    const phone = String(data.phone ?? '').trim();
    await ref.set(
      {
        enabled: false,
        status: 'disconnected',
        ...(phone
          ? { phone: FieldValue.delete(), previousPhone: phone }
          : {}),
        releasedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }
  const updated = await ref.get();
  return mapWhatsappUser(updated.id, updated.data() as Record<string, unknown>);
}

export async function deleteWhatsappUser(businessId: string, userId: string): Promise<void> {
  const ref = collection(businessId).doc(userId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('WHATSAPP_USER_NOT_FOUND');
  await ref.delete();
}

export async function createPendingWhatsappLine(params: {
  businessId: string;
  name?: string;
  addedBy: string;
}): Promise<WhatsappUserRecord> {
  const now = new Date().toISOString();
  const ref = collection(params.businessId).doc();
  await ref.set({
    phone: '',
    name: params.name?.trim() || 'Número adicional',
    role: 'operador',
    enabled: false,
    erpUserId: null,
    kind: 'extra',
    status: 'pending',
    addedAt: now,
    addedBy: params.addedBy,
    createdAt: now,
    updatedAt: now,
  });
  const saved = await ref.get();
  return mapWhatsappUser(saved.id, saved.data() as Record<string, unknown>);
}

export async function countPrimaryWhatsappLines(businessId: string): Promise<number> {
  const users = await listWhatsappUsers(businessId);
  return users.filter(
    (row) => row.kind === 'primary' && row.enabled && row.status === 'active' && row.phone
  ).length;
}
