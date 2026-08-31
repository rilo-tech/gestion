import { db } from '../firebase.ts';
import type { CommercialHistoryEvent, CommercialHistoryEventType } from '../../shared/commercial-pricing.ts';
import { appendSubscriptionHistory } from './subscription-history.ts';

function eventsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/commercial_events`);
}

export async function recordCommercialEvent(input: {
  businessId: string;
  type: CommercialHistoryEventType;
  actor: string;
  oldValue?: unknown;
  newValue?: unknown;
  billingImpact: CommercialHistoryEvent['billingImpact'];
  note?: string;
}): Promise<void> {
  const date = new Date().toISOString();
  const event: Omit<CommercialHistoryEvent, 'date'> & { date: string; note?: string } = {
    type: input.type,
    businessId: input.businessId,
    actor: input.actor,
    date,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    billingImpact: input.billingImpact,
    note: input.note,
  };
  await eventsCollection(input.businessId).add(event);
  await appendSubscriptionHistory(input.businessId, {
    changedBy: input.actor,
    changeType:
      input.type === 'plan_changed'
        ? 'plan'
        : input.type === 'price_changed'
          ? 'pricing'
          : 'limits',
    note: input.note ?? input.type,
  });
}

export async function listCommercialEvents(
  businessId: string,
  limit = 80
): Promise<CommercialHistoryEvent[]> {
  const snap = await eventsCollection(businessId).orderBy('date', 'desc').limit(limit).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as CommercialHistoryEvent;
    return { ...data, businessId };
  });
}
