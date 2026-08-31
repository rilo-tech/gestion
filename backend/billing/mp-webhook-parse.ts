export type MercadoPagoWebhookTopic =
  | 'payment'
  | 'subscription_preapproval'
  | 'subscription_authorized_payment'
  | 'merchant_order'
  | 'unknown';

export function parseMercadoPagoWebhook(input: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): { topic: MercadoPagoWebhookTopic; dataId: string } {
  const query = input.query ?? {};
  const body = input.body ?? {};
  const rawTopic = String(
    query.topic ?? query.type ?? body.type ?? body.topic ?? ''
  )
    .trim()
    .toLowerCase();
  const topic: MercadoPagoWebhookTopic =
    rawTopic === 'payment' ||
    rawTopic === 'subscription_preapproval' ||
    rawTopic === 'preapproval' ||
    rawTopic === 'subscription_authorized_payment' ||
    rawTopic === 'authorized_payment' ||
    rawTopic === 'merchant_order'
      ? rawTopic === 'preapproval'
        ? 'subscription_preapproval'
        : rawTopic === 'authorized_payment'
          ? 'subscription_authorized_payment'
          : (rawTopic as MercadoPagoWebhookTopic)
      : rawTopic
        ? 'unknown'
        : 'payment';

  const data = (body.data ?? {}) as Record<string, unknown>;
  const dataId = String(
    query['data.id'] ?? query.id ?? data.id ?? body.id ?? ''
  ).trim();

  return { topic, dataId };
}
