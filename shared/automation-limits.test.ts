import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveAutomationLimits } from './automation-limits.ts';
import { emptyModulesMap } from './subscription-modules.ts';

describe('automation limits', () => {
  it('disables when module is off', () => {
    const limits = resolveAutomationLimits({ ...emptyModulesMap(true), automations: false });
    assert.equal(limits.enabled, false);
    assert.equal(limits.maxActiveAutomations, 0);
    assert.equal(limits.conditionWatchesAllowed, false);
  });

  it('defaults to unlimited when module is on', () => {
    const limits = resolveAutomationLimits({ ...emptyModulesMap(true), automations: true });
    assert.equal(limits.enabled, true);
    assert.equal(limits.maxActiveAutomations, null);
    assert.equal(limits.conditionWatchesAllowed, true);
  });

  it('applies commercial overrides', () => {
    const limits = resolveAutomationLimits(
      { ...emptyModulesMap(true), automations: true },
      { maxActiveAutomations: 3, conditionWatchesAllowed: false }
    );
    assert.equal(limits.maxActiveAutomations, 3);
    assert.equal(limits.conditionWatchesAllowed, false);
  });
});
