import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRODUCT_CAPABILITY_CONTRACT,
  assertLandingCapabilitiesOperational,
  webExperienceForProduct,
  RILO_STANDARD_CONFIG_VERSION,
} from './product-capability-contract.ts';
import { STANDARD_CATEGORIAS_GASTO } from './rilo-standard-config.ts';
import { platformAccessForTrialProduct, productIdFromAccess } from './platform-access.ts';
import { initialProfileForTrialProduct } from './business-profile.ts';

describe('product capability contract', () => {
  it('landing claims only reference known operational capabilities', () => {
    const claims = PRODUCT_CAPABILITY_CONTRACT.filter((c) => c.visibleLanding).map((c) => ({
      id: c.id,
      text: c.commercialDescription,
    }));
    const failures = assertLandingCapabilitiesOperational(claims);
    assert.deepEqual(failures, []);
    for (const cap of PRODUCT_CAPABILITY_CONTRACT.filter((c) => c.visibleLanding)) {
      assert.equal(cap.status, 'operational', `${cap.id} must be operational on landing`);
    }
  });

  it('Bot webExperience is summary', () => {
    assert.equal(webExperienceForProduct('whatsapp'), 'summary');
    const access = platformAccessForTrialProduct('whatsapp');
    assert.equal(access.webExperience, 'summary');
    assert.equal(productIdFromAccess(access), 'whatsapp');
  });

  it('Bot initial profile is mixed pending onboarding (not services-only)', () => {
    const profile = initialProfileForTrialProduct('whatsapp');
    assert.equal(profile.mode, 'mixed');
    assert.equal(profile.enabledFeatures.orders, true);
    assert.equal(profile.enabledFeatures.purchases, true);
    assert.equal(profile.onboarding.completed, false);
  });

  it('standard categorias are generic (no DTF/Sublimación)', () => {
    assert.equal(RILO_STANDARD_CONFIG_VERSION, 'standard_v1');
    const labels = STANDARD_CATEGORIAS_GASTO.map((c) => c.label.toLowerCase()).join(' ');
    assert.equal(labels.includes('dtf'), false);
    assert.equal(labels.includes('sublim'), false);
    assert.equal(labels.includes('vps'), false);
  });
});
