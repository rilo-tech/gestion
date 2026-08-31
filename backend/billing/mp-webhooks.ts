import { db } from '../firebase.ts';
import { webhookIdempotencyKey } from '../../shared/subscription-lifecycle.ts';
import { parseMercadoPagoWebhook } from './mp-webhook-parse.ts';

export type { MercadoPagoWebhookTopic } from './mp-webhook-parse.ts';
export { parseMercadoPagoWebhook } from './mp-webhook-parse.ts';

export type StoredMpPayment = {
  paymentId: string;
  preapprovalId?: string | null;
  status: string;
  grossAmount: number;
  feeAmount?: number | null;
  netAmount?: number | null;
  currency?: string | null;
  date: string;
  businessId: string;
  topic: string;
  country?: string;
};

function eventRef(key: string) {
  return db.doc(`plataforma/mp_webhook_events/items/${key}`);
}

function paymentRef(businessId: string, paymentId: string) {
  return db.doc(`negocios/${businessId}/mp_payments/${paymentId}`);
}

export async function claimWebhookEvent(topic: string, dataId: string): Promise<{
  key: string;
  duplicate: boolean;
}> {
  const key = webhookIdempotencyKey(topic, dataId);
  const ref = eventRef(key);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.processed === true) {
    return { key, duplicate: true };
  }
  await ref.set(
    {
      key,
      topic,
      dataId,
      processed: false,
      receivedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return { key, duplicate: false };
}

export async function markWebhookProcessed(
  key: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await eventRef(key).set(
    {
      processed: true,
      processedAt: new Date().toISOString(),
      ...extra,
    },
    { merge: true }
  );
}

export async function saveMpPayment(row: StoredMpPayment): Promise<boolean> {
  const id = String(row.paymentId || '').trim();
  const businessId = String(row.businessId || '').trim();
  if (!id || !businessId) return false;
  const ref = paymentRef(businessId, id);
  const existing = await ref.get();
  if (existing.exists) return false;
  await ref.set({
    paymentId: id,
    preapprovalId: row.preapprovalId ?? null,
    status: row.status,
    grossAmount: row.grossAmount,
    feeAmount: row.feeAmount ?? null,
    netAmount: row.netAmount ?? null,
    currency: row.currency ?? null,
    date: row.date,
    businessId,
    topic: row.topic,
    country: row.country ?? null,
    createdAt: new Date().toISOString(),
  });
  return true;
}

export async function listMpPaymentsInPeriod(
  businessId: string,
  period: string
): Promise<StoredMpPayment[]> {
  const start = `${period}-01`;
  const [year, month] = period.split('-').map(Number);
  const endDate = new Date(Date.UTC(year, month, 1));
  const end = endDate.toISOString().slice(0, 10);
  const snap = await db
    .collection(`negocios/${businessId}/mp_payments`)
    .where('date', '>=', start)
    .where('date', '<', end)
    .get();
  return snap.docs.map((doc) => doc.data() as StoredMpPayment);
}
