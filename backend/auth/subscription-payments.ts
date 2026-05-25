import { db } from '../firebase.ts';

export type SubscriptionPaymentStatus = 'al_dia' | 'pendiente' | 'vencido';

export interface SubscriptionPaymentRecord {
  id: string;
  periodo: string;
  monto: number;
  fechaPago: string;
  notas?: string;
  createdAt?: string;
}

export interface SubscriptionPaymentSummary {
  estadoPago: SubscriptionPaymentStatus;
  periodoActual: string;
  montoEsperado: number;
  ultimoPagoPeriodo?: string;
  ultimoPagoFecha?: string;
  ultimoPagoMonto?: number;
}

const PAYMENT_GRACE_DAY = 10;

function paymentsCollection(businessId: string) {
  return db.collection(`negocios/${businessId}/pagos_suscripcion`);
}

function normalizePeriodo(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return currentPeriodo();
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function currentPeriodo(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function mapPayment(id: string, data: Record<string, unknown>): SubscriptionPaymentRecord {
  return {
    id,
    periodo: normalizePeriodo(data.periodo),
    monto: Math.max(0, Number(data.monto) || 0),
    fechaPago: String(data.fechaPago ?? new Date().toISOString()),
    notas: data.notas ? String(data.notas).trim() : undefined,
    createdAt: data.createdAt ? String(data.createdAt) : undefined,
  };
}

export async function listSubscriptionPayments(
  businessId: string
): Promise<SubscriptionPaymentRecord[]> {
  const snapshot = await paymentsCollection(businessId)
    .orderBy('periodo', 'desc')
    .get();
  return snapshot.docs.map((doc) => mapPayment(doc.id, doc.data() as Record<string, unknown>));
}

export async function registerSubscriptionPayment(
  businessId: string,
  payload: {
    periodo?: string;
    monto?: number;
    fechaPago?: string;
    notas?: string;
  }
): Promise<SubscriptionPaymentRecord> {
  const periodo = normalizePeriodo(payload.periodo ?? currentPeriodo());
  const monto = Math.max(0, Number(payload.monto) || 0);
  const fechaPago = payload.fechaPago
    ? new Date(payload.fechaPago).toISOString()
    : new Date().toISOString();

  const existing = await paymentsCollection(businessId)
    .where('periodo', '==', periodo)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error('PAYMENT_PERIOD_EXISTS');
  }

  const record = {
    periodo,
    monto,
    fechaPago,
    notas: payload.notas?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  const docRef = await paymentsCollection(businessId).add(record);
  return mapPayment(docRef.id, record);
}

export function resolveSubscriptionPaymentStatus(
  payments: SubscriptionPaymentRecord[],
  precioMensual: number,
  referenceDate = new Date()
): SubscriptionPaymentSummary {
  const periodoActual = currentPeriodo(referenceDate);
  const pagoActual = payments.find((payment) => payment.periodo === periodoActual);
  const ultimoPago = payments[0];

  if (pagoActual) {
    return {
      estadoPago: 'al_dia',
      periodoActual,
      montoEsperado: precioMensual,
      ultimoPagoPeriodo: pagoActual.periodo,
      ultimoPagoFecha: pagoActual.fechaPago,
      ultimoPagoMonto: pagoActual.monto,
    };
  }

  const day = referenceDate.getDate();
  const estadoPago: SubscriptionPaymentStatus =
    day > PAYMENT_GRACE_DAY ? 'vencido' : 'pendiente';

  return {
    estadoPago,
    periodoActual,
    montoEsperado: precioMensual,
    ultimoPagoPeriodo: ultimoPago?.periodo,
    ultimoPagoFecha: ultimoPago?.fechaPago,
    ultimoPagoMonto: ultimoPago?.monto,
  };
}

export async function getSubscriptionPaymentSummary(
  businessId: string,
  precioMensual: number
): Promise<SubscriptionPaymentSummary> {
  const payments = await listSubscriptionPayments(businessId);
  return resolveSubscriptionPaymentStatus(payments, precioMensual);
}
