import type { BillingCountryCode, BillingCurrency } from '../../shared/billing-catalog.ts';
import { getMercadoPagoAccessToken } from './mercadopago.ts';

const MP_API = 'https://api.mercadopago.com';

export type MercadoPagoPreapproval = {
  id: string;
  status: string;
  initPoint?: string;
  sandboxInitPoint?: string;
  nextPaymentDate?: string;
  reason?: string;
  externalReference?: string;
  payerEmail?: string;
  autoRecurring?: {
    frequency?: number;
    frequencyType?: string;
    transactionAmount?: number;
    currencyId?: string;
    startDate?: string;
    endDate?: string;
  };
  raw: Record<string, unknown>;
};

export function buildPreapprovalPayload(input: {
  reason: string;
  payerEmail: string;
  externalReference: string;
  amount: number;
  currency: BillingCurrency;
  backUrl: string;
  notificationUrl?: string;
  remainingTrialDays?: number;
}): Record<string, unknown> {
  const amount = Math.round(Number(input.amount) || 0);
  const autoRecurring: Record<string, unknown> = {
    frequency: 1,
    frequency_type: 'months',
    transaction_amount: amount,
    currency_id: input.currency,
  };
  const trialDays = Math.max(0, Math.floor(Number(input.remainingTrialDays) || 0));
  if (trialDays > 0) {
    autoRecurring.free_trial = {
      frequency: trialDays,
      frequency_type: 'days',
    };
  }
  const body: Record<string, unknown> = {
    reason: input.reason.slice(0, 250),
    external_reference: input.externalReference.slice(0, 256),
    payer_email: input.payerEmail.trim().toLowerCase(),
    auto_recurring: autoRecurring,
    back_url: input.backUrl,
    status: 'pending',
  };
  if (input.notificationUrl) {
    body.notification_url = input.notificationUrl;
  }
  return body;
}

function mapPreapproval(data: Record<string, unknown>, fallbackId?: string): MercadoPagoPreapproval {
  const auto = (data.auto_recurring ?? {}) as Record<string, unknown>;
  return {
    id: String(data.id ?? fallbackId ?? ''),
    status: String(data.status ?? ''),
    initPoint: data.init_point ? String(data.init_point) : undefined,
    sandboxInitPoint: data.sandbox_init_point ? String(data.sandbox_init_point) : undefined,
    nextPaymentDate: data.next_payment_date ? String(data.next_payment_date) : undefined,
    reason: data.reason ? String(data.reason) : undefined,
    externalReference: data.external_reference ? String(data.external_reference) : undefined,
    payerEmail: data.payer_email ? String(data.payer_email) : undefined,
    autoRecurring: {
      frequency: Number(auto.frequency) || undefined,
      frequencyType: auto.frequency_type ? String(auto.frequency_type) : undefined,
      transactionAmount: Number(auto.transaction_amount) || undefined,
      currencyId: auto.currency_id ? String(auto.currency_id) : undefined,
      startDate: auto.start_date ? String(auto.start_date) : undefined,
      endDate: auto.end_date ? String(auto.end_date) : undefined,
    },
    raw: data,
  };
}

async function mpRequest(
  country: BillingCountryCode,
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; text: string }> {
  const token = getMercadoPagoAccessToken(country);
  if (!token) {
    throw new Error(`Mercado Pago no configurado para ${country}`);
  }
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, text };
}

export async function createPreapproval(
  country: BillingCountryCode,
  payload: Record<string, unknown>
): Promise<MercadoPagoPreapproval> {
  const result = await mpRequest(country, '/preapproval', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!result.ok || !result.data.id) {
    console.error('[mercadopago] preapproval create error', result.status, result.text);
    throw new Error('No se pudo crear la suscripción de Mercado Pago.');
  }
  return mapPreapproval(result.data);
}

export async function fetchPreapproval(
  country: BillingCountryCode,
  preapprovalId: string
): Promise<MercadoPagoPreapproval | null> {
  const result = await mpRequest(country, `/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'GET',
  });
  if (!result.ok) {
    console.error('[mercadopago] preapproval fetch error', preapprovalId, result.status);
    return null;
  }
  return mapPreapproval(result.data, preapprovalId);
}

export async function fetchPreapprovalAnyCountry(preapprovalId: string) {
  for (const country of ['UY', 'AR'] as BillingCountryCode[]) {
    if (!getMercadoPagoAccessToken(country)) continue;
    const preapproval = await fetchPreapproval(country, preapprovalId);
    if (preapproval) return { country, preapproval };
  }
  return null;
}

export async function updatePreapprovalAmount(
  country: BillingCountryCode,
  preapprovalId: string,
  amount: number,
  currency: BillingCurrency
): Promise<MercadoPagoPreapproval> {
  const result = await mpRequest(country, `/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      auto_recurring: {
        transaction_amount: Math.round(Number(amount) || 0),
        currency_id: currency,
      },
    }),
  });
  if (!result.ok) {
    const message = String(result.data.message ?? result.data.error ?? result.text).slice(0, 400);
    const error = new Error(message || 'No se pudo actualizar el importe en Mercado Pago.');
    (error as Error & { status?: number; mpBody?: Record<string, unknown> }).status = result.status;
    (error as Error & { status?: number; mpBody?: Record<string, unknown> }).mpBody = result.data;
    throw error;
  }
  return mapPreapproval(result.data, preapprovalId);
}

export async function updatePreapprovalStatus(
  country: BillingCountryCode,
  preapprovalId: string,
  status: 'paused' | 'cancelled' | 'authorized'
): Promise<MercadoPagoPreapproval> {
  const result = await mpRequest(country, `/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
  if (!result.ok) {
    console.error('[mercadopago] preapproval status error', preapprovalId, result.status, result.text);
    throw new Error('No se pudo actualizar el estado de la suscripción en Mercado Pago.');
  }
  return mapPreapproval(result.data, preapprovalId);
}

export type MercadoPagoAuthorizedPayment = {
  id: string;
  preapprovalId?: string;
  status: string;
  transactionAmount: number;
  currencyId?: string;
  paymentId?: string;
  paymentStatus?: string;
  date?: string;
  raw: Record<string, unknown>;
};

export async function fetchAuthorizedPayment(
  country: BillingCountryCode,
  authorizedPaymentId: string
): Promise<MercadoPagoAuthorizedPayment | null> {
  const result = await mpRequest(
    country,
    `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`,
    { method: 'GET' }
  );
  if (!result.ok) {
    console.error('[mercadopago] authorized payment fetch error', authorizedPaymentId, result.status);
    return null;
  }
  const payment = (result.data.payment ?? {}) as Record<string, unknown>;
  return {
    id: String(result.data.id ?? authorizedPaymentId),
    preapprovalId: result.data.preapproval_id ? String(result.data.preapproval_id) : undefined,
    status: String(result.data.status ?? ''),
    transactionAmount: Number(result.data.transaction_amount) || Number(payment.transaction_amount) || 0,
    currencyId: result.data.currency_id
      ? String(result.data.currency_id)
      : payment.currency_id
        ? String(payment.currency_id)
        : undefined,
    paymentId: payment.id != null ? String(payment.id) : undefined,
    paymentStatus: payment.status ? String(payment.status) : undefined,
    date: result.data.last_modified
      ? String(result.data.last_modified)
      : result.data.date_created
        ? String(result.data.date_created)
        : undefined,
    raw: result.data,
  };
}

export async function fetchAuthorizedPaymentAnyCountry(authorizedPaymentId: string) {
  for (const country of ['UY', 'AR'] as BillingCountryCode[]) {
    if (!getMercadoPagoAccessToken(country)) continue;
    const payment = await fetchAuthorizedPayment(country, authorizedPaymentId);
    if (payment) return { country, payment };
  }
  return null;
}
