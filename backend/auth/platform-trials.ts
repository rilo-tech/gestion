import { db } from '../firebase.ts';
import { listBusinesses, toPublicBusinessInfo } from './business.ts';
import {
  listIncompleteTrialRegistrations,
  releaseTrialContactClaim,
} from './trial-registration-store.ts';
import { resolveTrialState, trialDaysForProduct } from '../../shared/trial-state.ts';
import { syncExpiredTrialStatus } from './trial-business.ts';
import { isTrialProductId } from '../../shared/platform-access.ts';

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
  trialProduct: string | null;
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

    const synced = await syncExpiredTrialStatus(business);
    const trial = resolveTrialState(synced);
    const statusFilter = filters?.status ?? 'all';
    if (statusFilter === 'active' && trial.trialStatus !== 'active') continue;
    if (statusFilter === 'expired' && trial.trialStatus !== 'expired') continue;
    if (statusFilter === 'expiring' && !trial.isExpiringSoon) continue;

    const publicInfo = await toPublicBusinessInfo(synced.id, { business: synced });
    const usage = synced.lifecycle?.usageSummary ?? {
      ordersCount: 0,
      salesCount: 0,
      productsCount: 0,
      cashMovementsCount: 0,
    };

    let ordersCount = usage.ordersCount;
    let salesCount = usage.salesCount;
    let productsCount = usage.productsCount;
    let cashMovementsCount = usage.cashMovementsCount;

    if (!synced.lifecycle?.usageSummary) {
      try {
        [ordersCount, salesCount, productsCount, cashMovementsCount] = await Promise.all([
          countCollection(`negocios/${synced.id}/pedidos`),
          countCollection(`negocios/${synced.id}/ventas`),
          countCollection(`negocios/${synced.id}/productos`),
          countCollection(`negocios/${synced.id}/caja_movimientos`),
        ]);
      } catch {
        // ignore count errors in emulator
      }
    }

    const trialProductRaw = synced.platformAccess?.trialProduct ?? null;
    const trialProduct =
      trialProductRaw && isTrialProductId(trialProductRaw) ? trialProductRaw : null;

    rows.push({
      businessId: synced.id,
      nombre: synced.nombre,
      ownerName: synced.lifecycle?.ownerName ?? synced.contactVerification?.email ?? null,
      phone: synced.contactVerification?.phone ?? null,
      phoneVerified: synced.contactVerification?.phoneVerified === true,
      email: synced.contactVerification?.email ?? null,
      emailVerified: synced.contactVerification?.emailVerified === true,
      whatsappOptIn: synced.contactVerification?.whatsappOptIn === true,
      planNombre: publicInfo.plan.nombre,
      trialProduct,
      trialStartDate: trial.trialStartDate,
      trialEndDate: trial.trialEndDate,
      trialDaysRemaining: trial.daysRemaining,
      source: synced.source ?? synced.lifecycle?.source ?? null,
      trialStatus: trial.trialStatus,
      lastLoginAt: synced.lifecycle?.lastLoginAt ?? null,
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

export type PlatformPendingTrialRegistration = {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  pais: string;
  ciudad: string;
  status: string;
  emailVerified: boolean;
  trialProduct: string | null;
  trialDays: number | null;
  createdAt: string;
  updatedAt: string;
};

export async function listPlatformPendingTrialRegistrations(): Promise<
  PlatformPendingTrialRegistration[]
> {
  const rows = await listIncompleteTrialRegistrations(80);
  return rows.map((row) => {
    const trialProduct =
      row.trialProduct && isTrialProductId(row.trialProduct) ? row.trialProduct : null;
    return {
      id: row.id,
      businessName: row.businessName,
      ownerName: row.ownerName,
      email: row.email,
      phone: row.phone,
      pais: row.pais,
      ciudad: row.ciudad,
      status: row.status,
      emailVerified: row.emailVerified,
      trialProduct,
      trialDays: trialProduct ? trialDaysForProduct(trialProduct) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function adminReleaseTrialContactClaim(
  type: 'email' | 'phone',
  value: string,
  options?: { force?: boolean }
): Promise<{
  released: boolean;
  wasBoundToBusinessId: string | null;
  businessName?: string | null;
}> {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return { released: false, wasBoundToBusinessId: null, businessName: null };
  }

  const claimRef = db.collection('trial_contact_claims').doc(`${type}_${normalized}`);
  const claimSnap = await claimRef.get();
  if (!claimSnap.exists) {
    return { released: false, wasBoundToBusinessId: null, businessName: null };
  }

  const claim = claimSnap.data() as { businessId?: string };
  const businessId = claim.businessId ? String(claim.businessId) : null;

  if (businessId) {
    const { getBusiness } = await import('./business.ts');
    const business = await getBusiness(businessId);
    if (business?.estadoSuscripcion === 'activa') {
      const err = new Error('ACTIVE_SUBSCRIPTION_BLOCKS_RELEASE');
      (err as Error & { businessId?: string; businessName?: string }).businessId = businessId;
      (err as Error & { businessId?: string; businessName?: string }).businessName =
        business.nombre;
      throw err;
    }
    if (!options?.force) {
      const err = new Error('CLAIM_BOUND_TO_BUSINESS');
      (err as Error & { businessId?: string; businessName?: string }).businessId = businessId;
      (err as Error & { businessId?: string; businessName?: string }).businessName =
        business?.nombre ?? null;
      throw err;
    }
  }

  const result = await releaseTrialContactClaim(type, value, { force: true });
  return {
    ...result,
    businessName: null,
  };
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
