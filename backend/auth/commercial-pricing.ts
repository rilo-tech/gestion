import { getBusiness, resolveForBusiness, updateBusiness } from './business.ts';
import { getCommercialCatalog } from './commercial-catalog.ts';
import { countActiveUsers } from './users.ts';
import { listWhatsappUsers } from '../whatsapp/whatsapp-users.ts';
import { resolveBillingCountry, type BillingCountryCode } from '../../shared/billing-catalog.ts';
import { productIdFromAccess, type TrialProductId } from '../../shared/platform-access.ts';
import {
  billableWhatsappCount,
  quoteAddErpUser,
  quoteAddWhatsappNumber,
  quoteCommercialMonthly,
  quoteReleaseWhatsappNumber,
  quoteRemoveErpUser,
  resolveCommercialRates,
  type AddonChangeQuote,
  type CommercialMonthlyQuote,
  type CommercialOverrides,
} from '../../shared/commercial-pricing.ts';
import type { BusinessSubscriptionRecord } from './subscription-entitlements.ts';

export function overridesFromSubscription(
  suscripcion?: BusinessSubscriptionRecord | null
): CommercialOverrides {
  const sub = suscripcion ?? {};
  return {
    includedErpUsers: sub.includedErpUsersOverride,
    extraErpUserPrice: sub.extraErpUserPriceOverride,
    includedWhatsappNumbers: sub.includedWhatsappNumbersOverride,
    extraWhatsappNumberPrice: sub.extraWhatsappNumberPriceOverride,
    monthlyActionLimit: sub.includedAiOverride,
    usageMode: sub.usageModeOverride,
    maxWhatsappNumbers: sub.maxWhatsappNumbersOverride,
    precioFinal: sub.precioFinalOverride,
  };
}

function productForBusiness(business: Awaited<ReturnType<typeof getBusiness>>): TrialProductId {
  if (!business) return 'completo';
  return (
    productIdFromAccess(
      business.platformAccess ?? {
        erpCoreEnabled: true,
        erpWebEnabled: false,
        whatsappEnabled: false,
        aiEnabled: false,
      }
    ) ?? 'completo'
  );
}

function countryForBusiness(business: Awaited<ReturnType<typeof getBusiness>>): BillingCountryCode {
  return resolveBillingCountry(business?.lifecycle?.pais ?? null);
}

function moduleAddonTotal(cuota: { lineas?: Array<{ codigo?: string; monto?: number }> }): number {
  return (cuota.lineas ?? [])
    .filter((line) => String(line.codigo ?? '').startsWith('MOD:'))
    .reduce((sum, line) => sum + (Number(line.monto) || 0), 0);
}

export async function loadCommercialContext(businessId: string) {
  const business = await getBusiness(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  const [catalog, activeErpUsers, waUsers, resolvedBundle] = await Promise.all([
    getCommercialCatalog(),
    countActiveUsers(businessId),
    listWhatsappUsers(businessId),
    resolveForBusiness(business),
  ]);
  const productId = productForBusiness(business);
  const country = countryForBusiness(business);
  const overrides = overridesFromSubscription(business.suscripcion);
  const billableWhatsappNumbers = billableWhatsappCount(
    waUsers.map((row) => ({
      businessId,
      enabled: row.enabled,
      phone: row.phone,
      status: row.status,
    }))
  );
  const addonTotal = moduleAddonTotal(resolvedBundle.resolved.cuota);
  const discount = resolvedBundle.resolved.descuentoMensual;
  const rates = resolveCommercialRates({ catalog, productId, country, overrides });
  const quote = quoteCommercialMonthly({
    catalog,
    productId,
    country,
    overrides,
    activeErpUsers,
    billableWhatsappNumbers,
    addonTotal,
    discount,
  });
  return {
    business,
    catalog,
    productId,
    country,
    overrides,
    activeErpUsers,
    waUsers,
    billableWhatsappNumbers,
    addonTotal,
    discount,
    rates,
    quote,
    resolved: resolvedBundle.resolved,
    plan: resolvedBundle.plan,
    paidUntil: business.billing?.paidUntil ?? null,
  };
}

export async function quoteBusinessMonthly(businessId: string): Promise<CommercialMonthlyQuote> {
  const ctx = await loadCommercialContext(businessId);
  return ctx.quote;
}

export async function quoteBusinessAddErpUser(businessId: string): Promise<AddonChangeQuote> {
  const ctx = await loadCommercialContext(businessId);
  return quoteAddErpUser({
    catalog: ctx.catalog,
    productId: ctx.productId,
    country: ctx.country,
    overrides: ctx.overrides,
    activeErpUsers: ctx.activeErpUsers,
    billableWhatsappNumbers: ctx.billableWhatsappNumbers,
    addonTotal: ctx.addonTotal,
    discount: ctx.discount,
    paidUntil: ctx.paidUntil,
  });
}

export async function quoteBusinessAddWhatsappNumber(businessId: string): Promise<AddonChangeQuote> {
  const ctx = await loadCommercialContext(businessId);
  return quoteAddWhatsappNumber({
    catalog: ctx.catalog,
    productId: ctx.productId,
    country: ctx.country,
    overrides: ctx.overrides,
    activeErpUsers: ctx.activeErpUsers,
    billableWhatsappNumbers: ctx.billableWhatsappNumbers,
    addonTotal: ctx.addonTotal,
    discount: ctx.discount,
    paidUntil: ctx.paidUntil,
  });
}

export async function quoteBusinessRemoveErpUser(businessId: string) {
  const ctx = await loadCommercialContext(businessId);
  return quoteRemoveErpUser({
    catalog: ctx.catalog,
    productId: ctx.productId,
    country: ctx.country,
    overrides: ctx.overrides,
    activeErpUsers: ctx.activeErpUsers,
    billableWhatsappNumbers: ctx.billableWhatsappNumbers,
    addonTotal: ctx.addonTotal,
    discount: ctx.discount,
  });
}

export async function quoteBusinessReleaseWhatsappNumber(businessId: string) {
  const ctx = await loadCommercialContext(businessId);
  return quoteReleaseWhatsappNumber({
    catalog: ctx.catalog,
    productId: ctx.productId,
    country: ctx.country,
    overrides: ctx.overrides,
    activeErpUsers: ctx.activeErpUsers,
    billableWhatsappNumbers: ctx.billableWhatsappNumbers,
    addonTotal: ctx.addonTotal,
    discount: ctx.discount,
  });
}

export async function expandErpSeatsForAdd(params: {
  businessId: string;
  rol: 'admin' | 'staff';
  actor: string;
}): Promise<void> {
  const ctx = await loadCommercialContext(params.businessId);
  const limits = ctx.resolved.limits;
  const extraPrice = ctx.rates.extraErpUserPrice;
  const patch =
    params.rol === 'staff'
      ? {
          limiteOperadores: limits.limiteOperadores + 1,
          limiteUsuariosTotal: limits.limiteUsuariosTotal + 1,
          ...(ctx.business.suscripcion?.precioPorOperadorOverride == null
            ? { precioPorOperadorOverride: extraPrice }
            : {}),
        }
      : {
          limiteAdministradores: limits.limiteAdministradores + 1,
          limiteUsuariosTotal: limits.limiteUsuariosTotal + 1,
          ...(ctx.business.suscripcion?.precioPorAdministradorOverride == null
            ? { precioPorAdministradorOverride: extraPrice }
            : {}),
        };
  await updateBusiness(
    params.businessId,
    { suscripcion: patch },
    {
      allowSubscriptionFields: true,
      changedBy: params.actor,
      historyNote: 'Usuario ERP adicional contratado',
    }
  );
}

export async function shrinkErpSeatsToActive(params: {
  businessId: string;
  actor: string;
}): Promise<void> {
  const { getActiveUserCounts } = await import('./users.ts');
  const ctx = await loadCommercialContext(params.businessId);
  const counts = await getActiveUserCounts(params.businessId);
  const included = ctx.rates.includedErpUsers;
  const admins = Math.max(1, counts.administradoresActivos);
  const ops = Math.max(0, counts.operadoresActivos);
  const total = Math.max(included, admins + ops);
  await updateBusiness(
    params.businessId,
    {
      suscripcion: {
        limiteAdministradores: admins,
        limiteOperadores: ops,
        limiteUsuariosTotal: total,
      },
    },
    {
      allowSubscriptionFields: true,
      changedBy: params.actor,
      historyNote: 'Cupo de usuarios ERP ajustado tras baja',
    }
  );
}

export async function syncBillableWhatsappSeats(params: {
  businessId: string;
  actor: string;
}): Promise<number> {
  const ctx = await loadCommercialContext(params.businessId);
  const billable = ctx.billableWhatsappNumbers;
  await updateBusiness(
    params.businessId,
    {
      suscripcion: {
        limiteWhatsapp: billable,
        ...(ctx.business.suscripcion?.precioPorWhatsappOverride == null
          ? { precioPorWhatsappOverride: ctx.rates.extraWhatsappNumberPrice }
          : {}),
      },
    },
    {
      allowSubscriptionFields: true,
      changedBy: params.actor,
      historyNote: 'Cupo WhatsApp sincronizado',
    }
  );
  const { db } = await import('../firebase.ts');
  await db.collection(`negocios/${params.businessId}/whatsapp_config`).doc('default').set(
    {
      enabled: billable > 0,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return billable;
}
