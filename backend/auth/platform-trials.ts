import { db } from '../firebase.ts';
import { listBusinesses, toPublicBusinessInfo } from './business.ts';
import { resolveTrialState } from '../../shared/trial-state.ts';

export type PlatformTrialRow = {
  businessId: string;
  nombre: string;
  ownerName: string | null;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  whatsappOptIn: boolean;
  planNombre: string;
  trialStartDate: string | null;
  trialEndDate: string | null;
  trialDaysRemaining: number | null;
  trialStatus: string | null;
  source: string | null;
  lastLoginAt: string | null;
  usage: {
    ordersCount: number;
    salesCount: number;
    productsCount: number;
    cashMovementsCount: number;
  };
};

async function countCollection(path: string): Promise<number> {
  const snap = await db.collection(path).count().get();
  return snap.data().count;
}

export async function listPlatformTrials(filters?: {
  source?: string;
  status?: 'active' | 'expiring' | 'expired' | 'all';
}): Promise<PlatformTrialRow[]> {
  const businesses = await listBusinesses();
  const rows: PlatformTrialRow[] = [];

  for (const business of businesses) {
    if (!business.enPrueba && business.lifecycle?.source !== 'self_service_trial') {
      continue;
    }
    if (filters?.source && business.source !== filters.source && business.lifecycle?.source !== filters.source) {
      continue;
    }

    const trial = resolveTrialState(business);
    const statusFilter = filters?.status ?? 'all';
    if (statusFilter === 'active' && trial.trialStatus !== 'active') continue;
    if (statusFilter === 'expired' && trial.trialStatus !== 'expired') continue;
    if (statusFilter === 'expiring' && !trial.isExpiringSoon) continue;

    const publicInfo = await toPublicBusinessInfo(business.id, { business });
    const usage = business.lifecycle?.usageSummary ?? {
      ordersCount: 0,
      salesCount: 0,
      productsCount: 0,
      cashMovementsCount: 0,
    };

    let ordersCount = usage.ordersCount;
    let salesCount = usage.salesCount;
    let productsCount = usage.productsCount;
    let cashMovementsCount = usage.cashMovementsCount;

    if (!business.lifecycle?.usageSummary) {
      try {
        [ordersCount, salesCount, productsCount, cashMovementsCount] = await Promise.all([
          countCollection(`negocios/${business.id}/pedidos`),
          countCollection(`negocios/${business.id}/ventas`),
          countCollection(`negocios/${business.id}/productos`),
          countCollection(`negocios/${business.id}/caja_movimientos`),
        ]);
      } catch {
        // ignore count errors in emulator
      }
    }

    rows.push({
      businessId: business.id,
      nombre: business.nombre,
      ownerName: business.lifecycle?.ownerName ?? business.contactVerification?.email ?? null,
      phone: business.contactVerification?.phone ?? null,
      phoneVerified: business.contactVerification?.phoneVerified === true,
      email: business.contactVerification?.email ?? null,
      emailVerified: business.contactVerification?.emailVerified === true,
      whatsappOptIn: business.contactVerification?.whatsappOptIn === true,
      planNombre: publicInfo.plan.nombre,
      trialStartDate: trial.trialStartDate,
      trialEndDate: trial.trialEndDate,
      trialDaysRemaining: trial.daysRemaining,
      trialStatus: trial.trialStatus,
      source: business.source ?? business.lifecycle?.source ?? null,
      lastLoginAt: business.lifecycle?.lastLoginAt ?? null,
      usage: {
        ordersCount,
        salesCount,
        productsCount,
        cashMovementsCount,
      },
    });
  }

  return rows.sort((a, b) => {
    const aDays = a.trialDaysRemaining ?? 999;
    const bDays = b.trialDaysRemaining ?? 999;
    return aDays - bDays;
  });
}

export async function touchBusinessLogin(businessId: string): Promise<void> {
  const ref = db.collection('negocios').doc(businessId);
  const now = new Date().toISOString();
  const snap = await ref.get();
  if (!snap.exists) return;
  const lifecycle = (snap.data()?.lifecycle as Record<string, unknown>) ?? {};
  await ref.update({
    lifecycle: {
      ...lifecycle,
      lastLoginAt: now,
      firstLoginAt: lifecycle.firstLoginAt ?? now,
    },
    updatedAt: now,
  });
}
