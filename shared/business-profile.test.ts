import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canUseBusinessFeature,
  entitlementAllowsFeature,
  productAllowsFeature,
} from './business-capability.ts';
import {
  defaultProfileForMode,
  hasStoredBusinessProfile,
  initialProfileForTrialProduct,
  legacyFullProfile,
  normalizeBusinessProfile,
  resolveBusinessProfile,
} from './business-profile.ts';
import { emptyModulesMap } from './subscription-modules.ts';

describe('legacyFullProfile', () => {
  it('empresa sin BusinessProfile recibe perfil completo', () => {
    const profile = resolveBusinessProfile(undefined);
    assert.equal(profile.onboarding.completed, true);
    assert.equal(profile.enabledFeatures.stock, true);
    assert.equal(profile.enabledFeatures.orders, true);
    assert.equal(profile.enabledFeatures.cash, true);
  });

  it('null y objeto vacío son legacy', () => {
    assert.equal(hasStoredBusinessProfile(undefined), false);
    assert.equal(hasStoredBusinessProfile(null), false);
    assert.equal(hasStoredBusinessProfile({}), false);
    assert.deepEqual(resolveBusinessProfile(null).mode, legacyFullProfile().mode);
  });
});

describe('cash_only profile', () => {
  it('solo habilita caja', () => {
    const profile = defaultProfileForMode('cash_only');
    assert.equal(profile.mode, 'cash_only');
    assert.equal(profile.enabledFeatures.cash, true);
    assert.equal(profile.enabledFeatures.stock, false);
    assert.equal(profile.enabledFeatures.orders, false);
  });
});

describe('productAllowsFeature', () => {
  it('RILO Caja solo permite caja', () => {
    assert.equal(productAllowsFeature('cash', 'cash'), true);
    assert.equal(productAllowsFeature('cash', 'stock'), false);
    assert.equal(productAllowsFeature('cash', 'orders'), false);
  });

  it('RILO Bot permite features operativas', () => {
    assert.equal(productAllowsFeature('whatsapp', 'stock'), true);
    assert.equal(productAllowsFeature('whatsapp', 'cash'), true);
  });
});

describe('initialProfileForTrialProduct', () => {
  it('asigna modo según producto comercial', () => {
    assert.equal(initialProfileForTrialProduct('cash').mode, 'cash_only');
    assert.equal(initialProfileForTrialProduct('erp').mode, 'products');
    // Bot: mixed genérico hasta onboarding (no asumir services).
    assert.equal(initialProfileForTrialProduct('whatsapp').mode, 'mixed');
    assert.equal(initialProfileForTrialProduct('whatsapp').onboarding.completed, false);
    assert.equal(initialProfileForTrialProduct('completo').mode, 'mixed');
    assert.equal(initialProfileForTrialProduct('cash').onboarding.completed, false);
  });
});

describe('BusinessProfile defaults', () => {
  it('normaliza defaultCashAccountId', () => {
    const profile = normalizeBusinessProfile({
      version: 1,
      mode: 'mixed',
      defaults: { defaultCashAccountId: 'Negocio' },
      onboarding: { completed: false, step: 'welcome' },
    });
    assert.equal(profile.defaults?.defaultCashAccountId, 'negocio');
  });
});

describe('canUseBusinessFeature', () => {
  it('deniega feature no incluida en producto Caja', () => {
    const profile = defaultProfileForMode('cash_only');
    profile.enabledFeatures.stock = true;
    const entitlements = emptyModulesMap(true);
    assert.equal(
      canUseBusinessFeature({
        productId: 'cash',
        entitlements,
        profile,
        feature: 'stock',
        permission: true,
      }),
      false
    );
  });

  it('deniega feature apagada aunque el producto la permita', () => {
    const profile = legacyFullProfile();
    profile.enabledFeatures.stock = false;
    const entitlements = emptyModulesMap(true);
    assert.equal(
      canUseBusinessFeature({
        productId: 'whatsapp',
        entitlements,
        profile,
        feature: 'stock',
        permission: true,
      }),
      false
    );
  });

  it('requiere permiso de usuario', () => {
    const profile = legacyFullProfile();
    const entitlements = emptyModulesMap(true);
    assert.equal(
      canUseBusinessFeature({
        productId: 'whatsapp',
        entitlements,
        profile,
        feature: 'cash',
        permission: false,
      }),
      false
    );
  });

  it('entitlement de módulo caja', () => {
    const entitlements = emptyModulesMap(false);
    entitlements.caja = true;
    assert.equal(entitlementAllowsFeature(entitlements, 'cash'), true);
    assert.equal(entitlementAllowsFeature(entitlements, 'orders'), false);
  });
});
