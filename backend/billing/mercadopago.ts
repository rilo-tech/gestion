import type { BillingCountryCode, BillingCurrency } from '../../shared/billing-catalog.ts';

export function getMercadoPagoAccessToken(country: BillingCountryCode): string | null {
  const specific =
    country === 'AR'
      ? process.env.MERCADOPAGO_ACCESS_TOKEN_AR?.trim()
      : process.env.MERCADOPAGO_ACCESS_TOKEN_UY?.trim();
  const fallback = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  return specific || fallback || null;
}

export function isMercadoPagoConfigured(country: BillingCountryCode): boolean {
  return Boolean(getMercadoPagoAccessToken(country));
}

export interface CreatePreferenceInput {
  country: BillingCountryCode;
  currency: BillingCurrency;
  title: string;
  unitPrice: number;
  externalReference: string;
  metadata: Record<string, string>;
  payerEmail?: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  notificationUrl: string;
  itemDescription?: string;
}

export interface MercadoPagoPreferenceResult {
  id: string;
  initPoint: string;
  sandboxInitPoint?: string;
}

export async function createCheckoutPreference(
  input: CreatePreferenceInput
): Promise<MercadoPagoPreferenceResult> {
  const token = getMercadoPagoAccessToken(input.country);
  if (!token) {
    throw new Error(`Mercado Pago no configurado para ${input.country}`);
  }

  const body = {
    items: [
      {
        id: input.metadata.productId ?? 'rilo-plan',
        title: input.title,
        description: input.itemDescription ?? `Suscripción RILO · ${input.country}`,
        quantity: 1,
        currency_id: input.currency,
        unit_price: input.unitPrice,
      },
    ],
    payer: input.payerEmail ? { email: input.payerEmail } : undefined,
    external_reference: input.externalReference,
    metadata: input.metadata,
    back_urls: {
      success: input.successUrl,
      failure: input.failureUrl,
      pending: input.pendingUrl,
    },
    auto_return: 'approved',
    notification_url: input.notificationUrl,
    statement_descriptor: 'RILO',
  };

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[mercadopago] preference error', response.status, text);
    throw new Error('No se pudo crear el checkout de Mercado Pago.');
  }

  const data = (await response.json()) as {
    id?: string;
    init_point?: string;
    sandbox_init_point?: string;
  };

  if (!data.id || !data.init_point) {
    throw new Error('Respuesta inválida de Mercado Pago.');
  }

  return {
    id: data.id,
    initPoint: data.init_point,
    sandboxInitPoint: data.sandbox_init_point,
  };
}

export async function fetchMercadoPagoPayment(
  country: BillingCountryCode,
  paymentId: string
): Promise<{
  id: string;
  status: string;
  statusDetail?: string;
  transactionAmount: number;
  currencyId: string;
  feeAmount?: number;
  netAmount?: number;
  dateApproved?: string;
  dateCreated?: string;
  preapprovalId?: string;
  externalReference?: string;
  metadata?: Record<string, unknown>;
} | null> {
  const token = getMercadoPagoAccessToken(country);
  if (!token) return null;

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    console.error('[mercadopago] payment fetch error', paymentId, response.status);
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  const feeDetails = Array.isArray(data.fee_details) ? data.fee_details : [];
  const feeAmount = feeDetails.reduce((sum, row) => {
    const item = row as { amount?: unknown };
    return sum + (Number(item.amount) || 0);
  }, 0);
  const details = (data.transaction_details ?? {}) as Record<string, unknown>;
  const netFromDetails = Number(details.net_received_amount);
  const metadata = (data.metadata as Record<string, unknown>) ?? undefined;
  const preapprovalId =
    (metadata?.preapproval_id ? String(metadata.preapproval_id) : '') ||
    (data.preapproval_id ? String(data.preapproval_id) : '') ||
    undefined;

  return {
    id: String(data.id ?? paymentId),
    status: String(data.status ?? ''),
    statusDetail: data.status_detail ? String(data.status_detail) : undefined,
    transactionAmount: Number(data.transaction_amount) || 0,
    currencyId: String(data.currency_id ?? ''),
    feeAmount: feeAmount > 0 ? feeAmount : undefined,
    netAmount: Number.isFinite(netFromDetails)
      ? netFromDetails
      : feeAmount > 0
        ? (Number(data.transaction_amount) || 0) - feeAmount
        : undefined,
    dateApproved: data.date_approved ? String(data.date_approved) : undefined,
    dateCreated: data.date_created ? String(data.date_created) : undefined,
    preapprovalId,
    externalReference: data.external_reference ? String(data.external_reference) : undefined,
    metadata,
  };
}

/** Intenta UY y AR si no sabemos el país del pago. */
export async function fetchMercadoPagoPaymentAnyCountry(paymentId: string) {
  for (const country of ['UY', 'AR'] as BillingCountryCode[]) {
    if (!getMercadoPagoAccessToken(country)) continue;
    const payment = await fetchMercadoPagoPayment(country, paymentId);
    if (payment) return { country, payment };
  }
  return null;
}
