import { db } from '../firebase.ts';

export interface ConversationState {
  businessId: string;
  phone: string;
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
  updatedAt: string;
}

function stateRef(businessId: string, phone: string) {
  const key = phone.replace(/[^0-9+]/g, '');
  return db.collection(`negocios/${businessId}/whatsapp_conversations`).doc(key);
}

export async function getConversationState(
  businessId: string,
  phone: string
): Promise<ConversationState | null> {
  const snap = await stateRef(businessId, phone).get();
  if (!snap.exists) return null;
  return snap.data() as ConversationState;
}

export async function saveConversationState(
  businessId: string,
  phone: string,
  patch: Partial<ConversationState>
): Promise<ConversationState> {
  const now = new Date().toISOString();
  const ref = stateRef(businessId, phone);
  const base = {
    businessId,
    phone,
    updatedAt: now,
    ...patch,
  };
  await ref.set(base, { merge: true });
  const snap = await ref.get();
  return snap.data() as ConversationState;
}

export async function clearConversationState(businessId: string, phone: string): Promise<void> {
  await stateRef(businessId, phone).delete();
}
