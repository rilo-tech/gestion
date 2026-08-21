import { getBusiness, updateBusiness, type BusinessRecord } from './business.ts';
import { resolveBillingMode } from './usage-gates.ts';
import { seedBusinessWhatsappAccess } from '../whatsapp/seed-access.ts';
import { getBillingProduct } from '../../shared/billing-catalog.ts';
import { platformAccessPayload } from './platform-access.ts';
import {
  mergePlatformAccessWithProduct,
  normalizePlatformAccess,
  productAlreadyEnabled,
  withErpWebPaused,
  withWhatsappPaused,
  type TrialProductId,
} from '../../shared/platform-access.ts';

export type EnableProductOutcome =
  | 'already_active'
  | 'module_added'
  | 'resumed'
  | 'checkout_required';

export type EnableProductResult = {
  outcome: EnableProductOutcome;
  checkoutProduct?: TrialProductId;
  business: BusinessRecord;
};

export type DisableProductOutcome = 'already_paused' | 'paused' | 'not_enabled';

export type DisableProductResult = {
  outcome: DisableProductOutcome;
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

async function seedWhatsappLine(business: BusinessRecord, trialProduct?: TrialProductId | null) {
  await seedBusinessWhatsappAccess({
    businessId: business.id,
    phone: String(business.contactVerification?.phone ?? ''),
    ownerName: String(business.lifecycle?.ownerName ?? ''),
    trialProduct,
    forceLine: true,
    erpUserId: business.lifecycle?.ownerUserId ?? null,
    status: business.enPrueba ? 'trial' : 'active',
  });
}

async function persistAccess(
  business: BusinessRecord,
  nextAccess: ReturnType<typeof normalizePlatformAccess>,
  historyNote: string,
  options?: { syncPlanId?: boolean; product?: TrialProductId }
): Promise<BusinessRecord> {
  const patch: { platformAccess: ReturnType<typeof platformAccessPayload>; planId?: string } = {
    platformAccess: platformAccessPayload(nextAccess),
  };
  if (options?.syncPlanId) {
    const catalog = getBillingProduct(nextAccess.trialProduct ?? options.product ?? '');
    if (catalog?.erpPlanId) patch.planId = catalog.erpPlanId;
  }
  return updateBusiness(business.id, patch, {
    allowSubscriptionFields: Boolean(patch.planId && patch.planId !== business.planId),
    changedBy: 'system',
    historyNote,
  });
}

/** Suma RILO Bot o panel a una empresa existente. En prueba se habilita; si ya pagó, hay que pasar por checkout. */
export async function enableProductOnBusiness(params: {
  businessId: string;
  product: TrialProductId;
}): Promise<EnableProductResult> {
  const business = await getBusiness(params.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');

  const currentAccess = normalizePlatformAccess(business.platformAccess);
  const wantsWhatsapp = params.product === 'whatsapp' || params.product === 'completo';
  const wantsErp = params.product === 'erp' || params.product === 'completo';

  if (productAlreadyEnabled(currentAccess, params.product)) {
    let nextAccess = currentAccess;
    let resumed = false;
    if (wantsWhatsapp && currentAccess.whatsappPaused) {
      nextAccess = withWhatsappPaused(nextAccess, false);
      resumed = true;
    }
    if (wantsErp && currentAccess.erpWebPaused) {
      nextAccess = withErpWebPaused(nextAccess, false);
      resumed = true;
    }
    if (resumed) {
      const updated = await persistAccess(business, nextAccess, 'Se reactivó el servicio desde Planes');
      if (wantsWhatsapp) {
        await seedWhatsappLine(updated, nextAccess.trialProduct);
      }
      return { outcome: 'resumed', business: updated };
    }
    // Producto ya activo: igual re-siembra la línea WA por si quedó liberada/offboarded.
    if (wantsWhatsapp) {
      await seedWhatsappLine(business, currentAccess.trialProduct);
    }
    return { outcome: 'already_active', business };
  }

  if (wantsWhatsapp && !currentAccess.whatsappEnabled) {
    const phone = String(business.contactVerification?.phone ?? '').trim();
    const verified = business.contactVerification?.phoneVerified === true;
    if (!phone || !verified) throw new Error('WHATSAPP_PHONE_REQUIRED');
  }

  const billingMode = resolveBillingMode(business);
  if (billingMode === 'blocked') {
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
  const updated = await persistAccess(
    business,
    nextAccess,
    `Se sumó ${params.product} a la prueba (misma empresa)`,
    { syncPlanId: true, product: params.product }
  );

  if (nextAccess.whatsappEnabled) {
    await seedWhatsappLine(updated, nextAccess.trialProduct);
  }

  return { outcome: 'module_added', business: updated };
}

/** Baja operativa: el canal queda inactivo y se reactiva desde Planes. */
export async function disableProductOnBusiness(params: {
  businessId: string;
  product: TrialProductId;
}): Promise<DisableProductResult> {
  const business = await getBusiness(params.businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');
  if (params.product !== 'whatsapp' && params.product !== 'erp') {
    throw new Error('DISABLE_NOT_SUPPORTED');
  }

  const currentAccess = normalizePlatformAccess(business.platformAccess);
  if (params.product === 'whatsapp') {
    if (!currentAccess.whatsappEnabled) return { outcome: 'not_enabled', business };
    if (currentAccess.whatsappPaused) return { outcome: 'already_paused', business };
    const nextAccess = withWhatsappPaused(currentAccess, true);
    const updated = await persistAccess(business, nextAccess, 'Se dio de baja RILO Bot');
    return { outcome: 'paused', business: updated };
  }

  if (!currentAccess.erpWebEnabled) return { outcome: 'not_enabled', business };
  if (currentAccess.erpWebPaused) return { outcome: 'already_paused', business };
  const nextAccess = withErpWebPaused(currentAccess, true);
  const updated = await persistAccess(business, nextAccess, 'Se dio de baja RILO Gestión');
  return { outcome: 'paused', business: updated };
}
