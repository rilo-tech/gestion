import { db } from '../firebase.ts';
import type { TrialRubroId } from '../../shared/trial-registration.ts';

export type TrialRegistrationRecord = {
  id: string;
  businessName: string;
  rubro: TrialRubroId | string;
  pais: string;
  ciudad: string;
  ownerName: string;
  email: string;
  phone: string;
  passwordHash?: string;
  googleId?: string;
  loginUsername: string;
  whatsappOptIn: boolean;
  marketingEmailOptIn: boolean;
  termsVersion: string;
  termsAcceptedAt: string;
  privacyAcceptedAt: string;
  consentIp?: string;
  utmSource?: string | null;
  utmCampaign?: string | null;
  campaignSource?: string | null;
  trialProduct?: string | null;
  phoneVerified: boolean;
  phoneVerifiedAt?: string | null;
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  phoneOtpHash?: string | null;
  phoneOtpExpiresAt?: string | null;
  phoneOtpAttempts: number;
  lastOtpSentAt?: string | null;
  emailVerifyTokenHash?: string | null;
  emailVerifyExpiresAt?: string | null;
  status: 'lead_created' | 'verification_pending' | 'ready' | 'completed' | 'abandoned';
  completedBusinessId?: string | null;
  createdAt: string;
  updatedAt: string;
};

function collection() {
  return db.collection('trial_registrations');
}

export async function createTrialRegistration(
  payload: Omit<TrialRegistrationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'phoneOtpAttempts' | 'phoneVerified' | 'emailVerified'>
): Promise<TrialRegistrationRecord> {
  const now = new Date().toISOString();
  const doc = {
    ...payload,
    phoneVerified: false,
    emailVerified: false,
    phoneOtpAttempts: 0,
    status: 'verification_pending' as const,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await collection().add(doc);
  return { id: ref.id, ...doc };
}

export async function getTrialRegistration(id: string): Promise<TrialRegistrationRecord | null> {
  const snap = await collection().doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<TrialRegistrationRecord, 'id'>) };
}

export async function updateTrialRegistration(
  id: string,
  patch: Partial<TrialRegistrationRecord>
): Promise<TrialRegistrationRecord> {
  const ref = collection().doc(id);
  const updatedAt = new Date().toISOString();
  await ref.update({ ...patch, updatedAt });
  const snap = await ref.get();
  return { id: snap.id, ...(snap.data() as Omit<TrialRegistrationRecord, 'id'>) };
}

export async function claimContactUnique(
  type: 'email' | 'phone',
  value: string,
  registrationId: string
): Promise<void> {
  const normalized = value.trim().toLowerCase();
  const ref = db.collection('trial_contact_claims').doc(`${type}_${normalized}`);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as { registrationId?: string; businessId?: string };
    if (data.businessId) {
      throw new Error(type === 'email' ? 'EMAIL_ALREADY_USED' : 'PHONE_ALREADY_USED');
    }
    if (data.registrationId && data.registrationId !== registrationId) {
      const existing = await getTrialRegistration(data.registrationId);
      if (existing?.status === 'completed' && existing.completedBusinessId) {
        throw new Error(type === 'email' ? 'EMAIL_ALREADY_USED' : 'PHONE_ALREADY_USED');
      }
    }
  }
  await ref.set({
    type,
    value: normalized,
    registrationId,
    updatedAt: new Date().toISOString(),
  });
}

export async function releaseTrialContactClaim(
  type: 'email' | 'phone',
  value: string
): Promise<void> {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  const ref = db.collection('trial_contact_claims').doc(`${type}_${normalized}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as { businessId?: string };
  if (data.businessId) {
    throw new Error('CLAIM_BOUND_TO_BUSINESS');
  }
  await ref.delete();
}

export async function listIncompleteTrialRegistrations(limit = 100): Promise<TrialRegistrationRecord[]> {
  const snap = await collection().orderBy('updatedAt', 'desc').limit(Math.min(limit, 200)).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<TrialRegistrationRecord, 'id'>) }))
    .filter((row) => row.status !== 'completed')
    .slice(0, limit);
}

export async function bindContactClaimToBusiness(
  type: 'email' | 'phone',
  value: string,
  businessId: string
): Promise<void> {
  const normalized = value.trim().toLowerCase();
  await db.collection('trial_contact_claims').doc(`${type}_${normalized}`).set(
    {
      type,
      value: normalized,
      businessId,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function findRegistrationByEmailTokenHash(
  tokenHash: string
): Promise<TrialRegistrationRecord | null> {
  const snap = await collection()
    .where('emailVerifyTokenHash', '==', tokenHash)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<TrialRegistrationRecord, 'id'>) };
}
