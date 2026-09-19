import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BILLING_PRODUCTS,
  getBillingProduct,
  getErpPlanTemplatePrices,
  getProductPriceForCountry,
} from './billing-catalog.ts';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  amountMonthlyFor,
  extraErpUserPriceFor,
} from './commercial-catalog.ts';
import {
  platformAccessForTrialProduct,
  productAlreadyEnabled,
  productIdFromAccess,
} from './platform-access.ts';
import {
  addTrialDays,
  dateOnlyIso,
  defaultTrialRange,
  resolveTrialState,
  trialDaysForProduct,
} from './trial-state.ts';
import {
  extraSeatCount,
  quoteAddErpUser,
  quoteCommercialMonthly,
} from './commercial-pricing.ts';
import {
  LANDING_PRODUCT_ORDER,
  pricingTiersFromCatalog,
} from './ritotech-marketing.ts';

describe('SSOT comercial billing ↔ commercial catalog', () => {
  for (const id of ['cash', 'whatsapp', 'erp', 'completo'] as const) {
    it(`precios ${id} coinciden`, () => {
      const uy = getProductPriceForCountry(id, 'UY');
      const ar = getProductPriceForCountry(id, 'AR');
      assert.equal(uy?.amountMonthly, amountMonthlyFor(DEFAULT_COMMERCIAL_CATALOG, id, 'UY'));
      assert.equal(ar?.amountMonthly, amountMonthlyFor(DEFAULT_COMMERCIAL_CATALOG, id, 'AR'));
      assert.equal(uy?.extraUserMonthly, extraErpUserPriceFor(DEFAULT_COMMERCIAL_CATALOG, id, 'UY'));
      assert.equal(ar?.extraUserMonthly, extraErpUserPriceFor(DEFAULT_COMMERCIAL_CATALOG, id, 'AR'));
    });
  }

  it('BILLING_PRODUCTS tiene 4 productos y Completo featured', () => {
    assert.equal(BILLING_PRODUCTS.length, 4);
    assert.equal(getBillingProduct('completo')?.featured, true);
    assert.equal(getBillingProduct('whatsapp')?.featured, undefined);
    assert.equal(getBillingProduct('whatsapp')?.erpPlanId, 'plan_basico');
    assert.equal(getBillingProduct('erp')?.erpPlanId, 'plan_intermedio');
    assert.equal(getBillingProduct('completo')?.erpPlanId, 'plan_profesional');
  });

  it('plantillas ERP leen el mismo catálogo', () => {
    assert.equal(getErpPlanTemplatePrices('plan_basico')?.precioBaseMensual, 690);
    assert.equal(getErpPlanTemplatePrices('plan_intermedio')?.precioBaseMensual, 490);
    assert.equal(getErpPlanTemplatePrices('plan_profesional')?.precioBaseMensual, 890);
  });
});

describe('Landing → Bot funnel comercial', () => {
  it('orden público Bot → Gestión → Completo', () => {
    assert.deepEqual(LANDING_PRODUCT_ORDER, ['whatsapp', 'erp', 'completo']);
    const tiers = pricingTiersFromCatalog(DEFAULT_COMMERCIAL_CATALOG);
    assert.deepEqual(
      tiers.map((t) => t.id),
      ['whatsapp', 'erp', 'completo']
    );
    assert.equal(tiers[0].badgeLabel, undefined);
    assert.equal(tiers[2].badgeLabel, 'Mejor valor');
    assert.equal(tiers[2].featured, true);
    assert.equal(tiers[0].featured, false);
  });

  it('trial default 20 días desde catálogo y por producto', () => {
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.trialDays, 20);
    assert.equal(trialDaysForProduct('whatsapp'), 20);
    const range = defaultTrialRange(new Date('2026-09-08T15:00:00-03:00'), 20);
    assert.equal(range.trialStartDate, '2026-09-08');
    assert.equal(range.trialEndDate, addTrialDays(new Date('2026-09-08T15:00:00-03:00'), 20));
  });
});

describe('Permisos por plan (platformAccess)', () => {
  it('RILO Bot: WhatsApp+IA + Resumen RILO (summary), no Gestión full', () => {
    const access = platformAccessForTrialProduct('whatsapp');
    assert.equal(access.whatsappEnabled, true);
    assert.equal(access.aiEnabled, true);
    assert.equal(access.erpWebEnabled, true);
    assert.equal(access.webExperience, 'summary');
    assert.equal(productIdFromAccess(access), 'whatsapp');
    assert.equal(productAlreadyEnabled(access, 'whatsapp'), true);
    assert.equal(productAlreadyEnabled(access, 'erp'), false);
  });

  it('RILO Gestión: panel web, sin WhatsApp', () => {
    const access = platformAccessForTrialProduct('erp');
    assert.equal(access.erpWebEnabled, true);
    assert.equal(access.whatsappEnabled, false);
    assert.equal(access.aiEnabled, false);
    assert.equal(productIdFromAccess(access), 'erp');
  });

  it('RILO Completo: ambos canales', () => {
    const access = platformAccessForTrialProduct('completo');
    assert.equal(access.erpWebEnabled, true);
    assert.equal(access.whatsappEnabled, true);
    assert.equal(access.aiEnabled, true);
    assert.equal(productIdFromAccess(access), 'completo');
  });

  it('RILO Caja: WA + panel mínimo sin confundirse con Completo', () => {
    const access = platformAccessForTrialProduct('cash');
    assert.equal(access.whatsappEnabled, true);
    assert.equal(access.erpWebEnabled, true);
    assert.equal(access.aiEnabled, true);
    assert.equal(productIdFromAccess(access), 'cash');
    assert.equal(productAlreadyEnabled(access, 'cash'), true);
    assert.equal(productAlreadyEnabled(access, 'completo'), false);
  });
});

describe('Vencimiento de trial', () => {
  it('trial activo dentro de la ventana', () => {
    const today = dateOnlyIso(new Date('2026-09-08T12:00:00-03:00'));
    const state = resolveTrialState(
      {
        enPrueba: true,
        trialStatus: 'active',
        trialStartDate: today,
        trialEndDate: addTrialDays(new Date('2026-09-08T12:00:00-03:00'), 20),
      },
      new Date('2026-09-08T12:00:00-03:00')
    );
    assert.equal(state.isTrialBillingActive, true);
    assert.equal(state.daysRemaining, 20);
  });

  it('trial vencido deja de ser billing-active y marca expired', () => {
    const state = resolveTrialState(
      {
        enPrueba: true,
        trialStatus: 'active',
        trialStartDate: '2026-08-01',
        trialEndDate: '2026-08-21',
      },
      new Date('2026-09-08T12:00:00-03:00')
    );
    assert.equal(state.trialStatus, 'expired');
    assert.equal(state.isTrialBillingActive, false);
    assert.ok((state.daysRemaining ?? 0) < 0);
  });
});

describe('Usuarios adicionales', () => {
  it('en Bot no suma usuario ERP; el extra comercial es el número WA', () => {
    assert.equal(extraSeatCount(1, 1), 0);
    assert.equal(extraSeatCount(3, 1), 2);

    const base = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'whatsapp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    const withExtraUsers = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'whatsapp',
      country: 'UY',
      activeErpUsers: 3,
      billableWhatsappNumbers: 1,
    });
    assert.equal(base.total, 690);
    assert.equal(withExtraUsers.total, 690);

    const previewUser = quoteAddErpUser({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'whatsapp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(previewUser.extraUnit, 0);
    assert.equal(previewUser.delta, 0);

    const withExtraWa = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'whatsapp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 2,
    });
    assert.equal(withExtraWa.total, 690 + 290);
  });

  it('en Gestión sí suma usuario adicional al total', () => {
    const base = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 0,
    });
    const withExtras = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 3,
      billableWhatsappNumbers: 0,
    });
    assert.equal(withExtras.total, base.total + 190 * 2);
  });
});
