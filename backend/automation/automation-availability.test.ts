import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAutomationCategoryMenus,
  listAvailableAutomationActions,
} from './automation-availability.ts';
import { listAutomationActions } from './automation-action-registry.ts';
import {
  defaultProfileForMode,
  legacyFullProfile,
  initialProfileForTrialProduct,
} from '../../shared/business-profile.ts';
import { CAJA_PLAN_MODULES, TRIAL_DEFAULT_MODULES } from '../../shared/subscription-modules.ts';

describe('automation availability by tenant', () => {
  it('cash product only exposes cash automations', () => {
    const ctx = {
      productId: 'cash' as const,
      entitlements: { ...CAJA_PLAN_MODULES },
      profile: initialProfileForTrialProduct('cash'),
      permission: true,
    };
    const actions = listAvailableAutomationActions(ctx);
    const ids = actions.map((row) => row.id);
    assert.ok(ids.includes('cash_daily_summary'));
    assert.ok(!ids.includes('low_stock_summary'));
    assert.ok(!ids.includes('pending_orders_summary'));
    assert.ok(!ids.includes('daily_business_summary'));
  });

  it('legacy full tenant exposes business, orders and stock categories', () => {
    const ctx = {
      productId: 'erp' as const,
      entitlements: { ...TRIAL_DEFAULT_MODULES, reports: true },
      profile: legacyFullProfile(),
      permission: true,
    };
    const menus = buildAutomationCategoryMenus(ctx);
    const categoryIds = menus.map((row) => row.id);
    assert.ok(categoryIds.includes('business'));
    assert.ok(categoryIds.includes('orders'));
    assert.ok(categoryIds.includes('stock'));
    assert.ok(categoryIds.includes('cash'));
  });

  it('services profile without stock hides stock actions', () => {
    const ctx = {
      productId: 'erp' as const,
      entitlements: { ...TRIAL_DEFAULT_MODULES },
      profile: defaultProfileForMode('services'),
      permission: true,
    };
    const actions = listAvailableAutomationActions(ctx);
    assert.ok(!actions.some((row) => row.category === 'stock'));
  });

  it('pending actions never appear as available', () => {
    const ctx = {
      productId: 'erp' as const,
      entitlements: { ...TRIAL_DEFAULT_MODULES, payables: true },
      profile: legacyFullProfile(),
      permission: true,
    };
    const actions = listAvailableAutomationActions(ctx);
    assert.ok(!actions.some((row) => row.id === 'card_payment_reminder'));
    assert.ok(!actions.some((row) => row.id === 'supplier_balance_summary'));
  });

  it('hides all actions when automations entitlement is off', () => {
    const ctx = {
      productId: 'erp' as const,
      entitlements: { ...TRIAL_DEFAULT_MODULES, automations: false },
      profile: legacyFullProfile(),
      permission: true,
    };
    assert.equal(listAvailableAutomationActions(ctx).length, 0);
  });
});

describe('automation action registry', () => {
  it('registers all proposed action ids', () => {
    const ids = listAutomationActions().map((row) => row.id);
    assert.equal(ids.length, 24);
    assert.ok(ids.includes('daily_business_summary'));
    assert.ok(ids.includes('daily_attention_digest'));
    assert.ok(ids.includes('orders_status_review'));
    assert.ok(ids.includes('payables_due_reminder'));
    assert.ok(ids.includes('customer_payment_promises_due'));
    assert.ok(ids.includes('product_stock_threshold_watch'));
    assert.ok(ids.includes('cash_wallet_period_summary'));
    assert.ok(ids.includes('cash_no_movements_soft'));
    const implemented = listAutomationActions().filter((row) =>
      [
        'daily_attention_digest',
        'payables_due_reminder',
        'orders_status_review',
        'customer_payment_promises_due',
      ].includes(row.id)
    );
    assert.equal(implemented.length, 4);
    assert.ok(implemented.every((row) => row.status === 'implemented'));
  });
});
