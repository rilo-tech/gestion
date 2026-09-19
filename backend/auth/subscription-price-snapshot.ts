import { getCommercialCatalog } from './commercial-catalog.ts';
import { countActiveUsers } from './users.ts';
import { listWhatsappUsers } from '../whatsapp/whatsapp-users.ts';
import { billableWhatsappCount, buildCommercialPriceSnapshot, quoteCommercialMonthly } from '../../shared/commercial-pricing.ts';
import type { BillingCountryCode } from '../../shared/billing-catalog.ts';
import { productIdFromAccess, type TrialProductId } from '../../shared/platform-access.ts';
import type { BusinessRecord } from './business.ts';
import type { CommercialPriceSnapshot } from '../../shared/commercial-pricing.ts';

export async function buildPriceSnapshotForBusiness(
  business: BusinessRecord,
  productId?: TrialProductId | null,
  country?: BillingCountryCode
): Promise<CommercialPriceSnapshot> {
  const catalog = await getCommercialCatalog();
  const resolvedProduct =
    productId ??
    productIdFromAccess(business.platformAccess ?? {}) ??
    'completo';
  const billingCountry =
    country ?? (business.lifecycle?.pais === 'AR' ? 'AR' : 'UY');
  const [activeErpUsers, waUsers] = await Promise.all([
    countActiveUsers(business.id),
    listWhatsappUsers(business.id),
  ]);
  const quote = quoteCommercialMonthly({
    catalog,
    productId: resolvedProduct,
    country: billingCountry,
    activeErpUsers,
    billableWhatsappNumbers: billableWhatsappCount(waUsers),
  });
  return buildCommercialPriceSnapshot({
    catalog,
    quote,
    productId: resolvedProduct,
  });
}
