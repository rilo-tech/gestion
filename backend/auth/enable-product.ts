import { getBusiness, updateBusiness, type BusinessRecord } from './business.ts';
import { isTrialActiveForBilling } from './trial-business.ts';
import { seedBusinessWhatsappAccess } from '../whatsapp/seed-access.ts';
import { getBillingProduct } from '../../shared/billing-catalog.ts';
import {
  mergePlatformAccessWithProduct,
  normalizePlatformAccess,
  productAlreadyEnabled,
  type TrialProductId,
} from '../../shared/platform-access.ts';

export type EnableProductOutcome = 'already_active' | 'module_added' | 'checkout_required';

export type EnableProductResult = {
  outcome: EnableProductOutcome;
  checkoutProduct?: TrialProductId;
  business: BusinessRecord;
};

function checkoutProductFor(
  currentWhatsapp: boolean,
  currentErp: boolean,
  incoming: TrialProductId
): TrialProductId {
  const whatsapp = currentWhatsapp || incoming === 'whatsapp' || incoming === 'completo';
  const erp = currentErp || incoming === 'erp' || incoming === 'completo';
  if (whatsapp && erp) return 'completo';
  if (whatsapp) return 'whatsapp';
  return 'erp';
}

/** Suma RiloBot o panel a una empresa existente. En prueba se habilita; si ya pagó, hay que pasar por checkout. */
export async function enableProductOnBusiness(params: {
  businessId: string;
  product: TrialProductId;
}): Promise<EnableProductResult> {
  const business = await getBusiness(params.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');

  const currentAccess = normalizePlatformAccess(business.platformAccess);
  if (productAlreadyEnabled(currentAccess, params.product)) {
    return { outcome: 'already_active', business };
  }

  if (
    (params.product === 'whatsapp' || params.product === 'completo') &&
    !currentAccess.whatsappEnabled
  ) {
    const phone = String(business.contactVerification?.phone ?? '').trim();
    const verified = business.contactVerification?.phoneVerified === true;
    if (!phone || !verified) throw new Error('WHATSAPP_PHONE_REQUIRED');
  }

  if (!isTrialActiveForBilling(business)) {
    return {
      outcome: 'checkout_required',
      checkoutProduct: checkoutProductFor(
        currentAccess.whatsappEnabled,
        currentAccess.erpWebEnabled,
        params.product
      ),
      business,
    };
  }

  const nextAccess = mergePlatformAccessWithProduct(currentAccess, params.product);
  const catalog = getBillingProduct(nextAccess.trialProduct ?? params.product);
  const planId = catalog?.erpPlanId ?? business.planId;

  const updated = await updateBusiness(
    params.businessId,
    {
      platformAccess: nextAccess,
      planId,
    },
    {
      allowSubscriptionFields: planId !== business.planId,
      changedBy: 'system',
      historyNote: `Se sumó ${params.product} a la prueba (misma empresa)`,
    }
  );

  if (nextAccess.whatsappEnabled) {
    await seedBusinessWhatsappAccess({
      businessId: params.businessId,
      phone: String(business.contactVerification?.phone ?? ''),
      ownerName: String(business.lifecycle?.ownerName ?? ''),
      trialProduct: nextAccess.trialProduct,
      forceLine: true,
      erpUserId: business.lifecycle?.ownerUserId ?? null,
      status: business.enPrueba ? 'trial' : 'active',
    });
  }

  return { outcome: 'module_added', business: updated };
}
