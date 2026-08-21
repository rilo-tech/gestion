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

export function addMonthsToDate(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function addMonthsToPeriodo(periodo: string, months: number): string {
  const normalized = normalizePeriodo(periodo);
  const [yearRaw, monthRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const date = new Date(year, month - 1 + months, 1);
  return currentPeriodo(date);
}

export function paidUntilIso(from: Date, coverageMonths: number): string {
  return addMonthsToDate(from, Math.max(1, coverageMonths)).toISOString();
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

/** Cantidad de períodos cubiertos (sirve para saber cuántos meses de promo ya usó). */
export async function countSubscriptionPaymentPeriods(businessId: string): Promise<number> {
  const snapshot = await paymentsCollection(businessId).get();
  return snapshot.size;
}

export async function registerSubscriptionPayment(
  businessId: string,
  payload: {
    periodo?: string;
    monto?: number;
    fechaPago?: string;
    notas?: string;
    mercadoPagoPaymentId?: string;
    currency?: string;
    productId?: string;
    country?: string;
    payerEmail?: string;
    allowUpdateExistingPeriod?: boolean;
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

  const record = {
    periodo,
    monto,
    fechaPago,
    notas: payload.notas?.trim() || undefined,
    mercadoPagoPaymentId: payload.mercadoPagoPaymentId ?? null,
    currency: payload.currency ?? null,
    productId: payload.productId ?? null,
    country: payload.country ?? null,
    payerEmail: payload.payerEmail ?? null,
    createdAt: new Date().toISOString(),
  };

  if (!existing.empty) {
    if (!payload.allowUpdateExistingPeriod) {
      throw new Error('PAYMENT_PERIOD_EXISTS');
    }
    const doc = existing.docs[0]!;
    await doc.ref.set(
      {
        ...record,
        createdAt: doc.data().createdAt ?? record.createdAt,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return mapPayment(doc.id, { ...doc.data(), ...record });
  }

  const docRef = await paymentsCollection(businessId).add(record);
  return mapPayment(docRef.id, record);
}

export function resolveSubscriptionPaymentStatus(
  payments: SubscriptionPaymentRecord[],
  precioMensual: number,
  referenceDate = new Date(),
  paidUntil?: string | null
): SubscriptionPaymentSummary {
  const periodoActual = currentPeriodo(referenceDate);
  const pagoActual = payments.find((payment) => payment.periodo === periodoActual);
  const ultimoPago = payments[0];

  const baseUltimo = {
    periodoActual,
    montoEsperado: precioMensual,
    ultimoPagoPeriodo: pagoActual?.periodo ?? ultimoPago?.periodo,
    ultimoPagoFecha: pagoActual?.fechaPago ?? ultimoPago?.fechaPago,
    ultimoPagoMonto: pagoActual?.monto ?? ultimoPago?.monto,
  };

  if (paidUntil) {
    const until = new Date(paidUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() > referenceDate.getTime()) {
      return { estadoPago: 'al_dia', ...baseUltimo };
    }
  }

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
    ...baseUltimo,
  };
}

/** Registra cobertura mensual o anual (marca períodos cubiertos + paidUntil). */
export async function registerSubscriptionCoverage(
  businessId: string,
  payload: {
    coverageMonths: number;
    montoTotal: number;
    startPeriodo?: string;
    fechaPago?: string;
    notas?: string;
    mercadoPagoPaymentId?: string;
    currency?: string;
    productId?: string;
    country?: string;
    payerEmail?: string;
  }
): Promise<{ payments: SubscriptionPaymentRecord[]; paidUntil: string; coverageMonths: number }> {
  const coverageMonths = Math.max(1, Math.min(24, Math.floor(Number(payload.coverageMonths) || 1)));
  const startPeriodo = normalizePeriodo(payload.startPeriodo ?? currentPeriodo());
  const fechaPago = payload.fechaPago
    ? new Date(payload.fechaPago).toISOString()
    : new Date().toISOString();
  const montoTotal = Math.max(0, Number(payload.montoTotal) || 0);
  const payments: SubscriptionPaymentRecord[] = [];

  for (let i = 0; i < coverageMonths; i++) {
    const periodo = addMonthsToPeriodo(startPeriodo, i);
    const isFirst = i === 0;
    const payment = await registerSubscriptionPayment(businessId, {
      periodo,
      monto: isFirst ? montoTotal : 0,
      fechaPago,
      notas: isFirst
        ? payload.notas?.trim() ||
          (coverageMonths > 1
            ? `Pago anual · ${coverageMonths} meses cubiertos`
            : undefined)
        : `Cubierto por pago ${coverageMonths > 1 ? 'anual' : 'anticipado'} (${startPeriodo})`,
      mercadoPagoPaymentId: isFirst ? payload.mercadoPagoPaymentId : undefined,
      currency: payload.currency,
      productId: payload.productId,
      country: payload.country,
      payerEmail: payload.payerEmail,
      allowUpdateExistingPeriod: true,
    });
    payments.push(payment);
  }

  return {
    payments,
    paidUntil: paidUntilIso(new Date(fechaPago), coverageMonths),
    coverageMonths,
  };
}

export async function getSubscriptionPaymentSummary(
  businessId: string,
  precioMensual: number,
  paidUntil?: string | null
): Promise<SubscriptionPaymentSummary> {
  const periodoActual = currentPeriodo();
  const query = Promise.all([
    paymentsCollection(businessId).where('periodo', '==', periodoActual).limit(1).get(),
    paymentsCollection(businessId).orderBy('periodo', 'desc').limit(1).get(),
  ]);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('PAYMENT_SUMMARY_TIMEOUT')), 8000);
  });
  const [currentSnap, latestSnap] = await Promise.race([query, timeout]);

  const pagoActual = currentSnap.empty
    ? undefined
    : mapPayment(currentSnap.docs[0].id, currentSnap.docs[0].data() as Record<string, unknown>);
  const ultimoPago = latestSnap.empty
    ? undefined
    : mapPayment(latestSnap.docs[0].id, latestSnap.docs[0].data() as Record<string, unknown>);

  const payments = [pagoActual, ultimoPago].filter(
    (payment): payment is SubscriptionPaymentRecord => !!payment
  );
  return resolveSubscriptionPaymentStatus(payments, precioMensual, new Date(), paidUntil);
}
