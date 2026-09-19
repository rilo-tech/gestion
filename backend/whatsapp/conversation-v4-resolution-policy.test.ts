import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveCashAccountFromCaja } from './resolve-cash-account.ts';
import { resolveCandidatesWithPolicy } from './resolution-policy.ts';
import { normalizeBusinessProfile } from '../../shared/business-profile.ts';

function cajaFixture(labels: string[]): Record<string, unknown> {
  const extras = labels.slice(1).map((label, index) => ({
    id: `caja_${index + 2}`,
    label,
  }));
  return {
    ambitos: [{ id: 'negocio', label: labels[0] }, ...extras],
  };
}

describe('ResolutionPolicy — cash account', () => {
  const threeCajas = cajaFixture(['Negocio', 'Personal', 'Sucursal']);

  it('single caja auto-resolves without asking', () => {
    const single = cajaFixture(['Negocio']);
    const result = resolveCashAccountFromCaja(single, {});
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.source, 'single_candidate');
    }
  });

  it('uses business default when configured', () => {
    const result = resolveCashAccountFromCaja(threeCajas, {
      businessDefaultId: 'negocio',
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'negocio');
      assert.equal(result.source, 'business_default');
    }
  });

  it('explicit hint overrides business default', () => {
    const result = resolveCashAccountFromCaja(threeCajas, {
      hint: 'Personal',
      explicit: true,
      businessDefaultId: 'negocio',
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.id, 'caja_2');
      assert.equal(result.source, 'explicit');
    }
  });

  it('asks only when multiple cajas and no default nor explicit', () => {
    const result = resolveCashAccountFromCaja(threeCajas, {});
    assert.equal(result.status, 'needs_selection');
    if (result.status === 'needs_selection') {
      assert.equal(result.candidates.length, 3);
    }
  });

  it('context id resolves without asking', () => {
    const result = resolveCashAccountFromCaja(threeCajas, {
      contextId: 'caja_3',
    });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.account.name, 'Sucursal');
      assert.equal(result.source, 'context');
    }
  });
});

describe('ResolutionPolicy — candidate rule', () => {
  it('auto-resolves single candidate', () => {
    const outcome = resolveCandidatesWithPolicy({
      field: 'payment_card',
      candidates: [{ id: 'card1', name: 'Visa' }],
      getId: (row) => row.id,
    });
    assert.equal(outcome.action, 'resolved');
    if (outcome.action === 'resolved') {
      assert.equal(outcome.source, 'single_candidate');
    }
  });

  it('asks on ambiguous candidates', () => {
    const outcome = resolveCandidatesWithPolicy({
      field: 'payment_card',
      candidates: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      getId: (row) => row.id,
    });
    assert.equal(outcome.action, 'ask');
  });
});

describe('BusinessProfile defaults', () => {
  it('persists defaultCashAccountId in profile', () => {
    const profile = normalizeBusinessProfile({
      version: 1,
      mode: 'mixed',
      defaults: { defaultCashAccountId: 'negocio' },
      onboarding: { completed: true, step: 'done' },
    });
    assert.equal(profile.defaults?.defaultCashAccountId, 'negocio');
  });
});
