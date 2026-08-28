import { db } from '../firebase.ts';

export type LastWhatsappOperation = {
  kind: 'order' | 'sale' | 'purchase' | 'payment' | 'cash' | 'client';
  id: string;
  label?: string;
  clientName?: string;
  amount?: number;
  at: string;
};

export interface ConversationState {
  businessId: string;
  phone: string;
  pendingIntent?: string | null;
  pendingPayload?: Record<string, unknown> | null;
  /** Última pregunta que hicimos, para retomarla si el dueño se va de tema. */
  pendingPrompt?: string | null;
  /** Última operación guardada, para preguntas («¿en qué estado lo registraste?»). */
  lastOperation?: LastWhatsappOperation | null;
  /** Configuración inicial (caja/productos/proveedores) ofrecida al arrancar. */
  setupStatus?: 'offered' | 'done' | null;
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

function omitUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(omitUndefined).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = omitUndefined(nested);
  }
  return out;
}

export async function saveConversationState(
  businessId: string,
  phone: string,
  patch: Partial<ConversationState>
): Promise<ConversationState> {
  const now = new Date().toISOString();
  const ref = stateRef(businessId, phone);
  const base = omitUndefined({
    businessId,
    phone,
    updatedAt: now,
    ...patch,
  }) as Record<string, unknown>;
  await ref.set(base, { merge: true });
  const snap = await ref.get();
  return snap.data() as ConversationState;
}

export async function clearConversationState(businessId: string, phone: string): Promise<void> {
  const now = new Date().toISOString();
  await stateRef(businessId, phone).set(
    {
      businessId,
      phone,
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
      updatedAt: now,
    },
    { merge: true }
  );
}

export async function rememberLastOperation(
  businessId: string,
  phone: string,
  operation: LastWhatsappOperation
): Promise<void> {
  await saveConversationState(businessId, phone, {
    pendingIntent: null,
    pendingPayload: null,
    lastOperation: operation,
  });
}
