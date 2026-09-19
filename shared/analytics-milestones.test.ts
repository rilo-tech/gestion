import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyBusinessOperationMilestone,
  applyFirstBotMessageMilestone,
} from './analytics-milestones-logic.ts';
import { planCountsAsBusinessOperation } from './bot-operation-milestones.ts';
import {
  isBusinessProfileIncomplete,
  isCityUnset,
  normalizeOptionalCity,
} from './business-profile-completion.ts';

describe('analytics milestones (idempotent)', () => {
  it('first_bot_message emite una vez', () => {
    const at1 = '2026-01-01T10:00:00.000Z';
    const at2 = '2026-01-02T10:00:00.000Z';
    const first = applyFirstBotMessageMilestone({}, at1);
    assert.equal(first.emitted, true);
    assert.equal(first.next.firstBotMessageAt, at1);
    const second = applyFirstBotMessageMilestone(first.next, at2);
    assert.equal(second.emitted, false);
    assert.equal(second.next.firstBotMessageAt, at1);
  });

  it('first/third operation + no re-emisión en 4ta; retries no duplican', () => {
    let state = {};
    const t1 = applyBusinessOperationMilestone(state, 't1');
    assert.equal(t1.firstOperationEmitted, true);
    assert.equal(t1.thirdOperationEmitted, false);
    state = t1.next;

    const t2 = applyBusinessOperationMilestone(state, 't2');
    assert.equal(t2.firstOperationEmitted, false);
    assert.equal(t2.operationCount, 2);
    state = t2.next;

    const t3 = applyBusinessOperationMilestone(state, 't3');
    assert.equal(t3.thirdOperationEmitted, true);
    assert.equal(t3.operationCount, 3);
    state = t3.next;

    const t4 = applyBusinessOperationMilestone(state, 't4');
    assert.equal(t4.thirdOperationEmitted, false);
    assert.equal(t4.firstOperationEmitted, false);
    assert.equal(t4.operationCount, 4);

    // Retry simulando mismo estado previo a op 3 (idempotencia del flag)
    const retryThird = applyBusinessOperationMilestone(
      { ...t2.next, thirdOperationCompletedAt: t3.next.thirdOperationCompletedAt, botWriteOperationCount: 3 },
      't3-retry'
    );
    assert.equal(retryThird.thirdOperationEmitted, false);
  });

  it('solo writes de negocio cuentan', () => {
    assert.equal(planCountsAsBusinessOperation(['create_sale']), true);
    assert.equal(planCountsAsBusinessOperation(['get_client_balance']), false);
    assert.equal(planCountsAsBusinessOperation(['find_product', 'create_order']), true);
  });
});

describe('business profile completion', () => {
  it('trata "A completar" y vacío como ciudad pendiente', () => {
    assert.equal(isCityUnset(null), true);
    assert.equal(isCityUnset(''), true);
    assert.equal(isCityUnset('A completar'), true);
    assert.equal(isCityUnset('Montevideo'), false);
    assert.equal(normalizeOptionalCity('A completar'), null);
    assert.equal(normalizeOptionalCity('Montevideo'), 'Montevideo');
  });

  it('profileIncomplete sin ciudad o sin país/rubro', () => {
    assert.equal(isBusinessProfileIncomplete({ rubro: 'ropa', pais: 'Uruguay', ciudad: null }), true);
    assert.equal(
      isBusinessProfileIncomplete({ rubro: 'ropa', pais: 'Uruguay', ciudad: 'A completar' }),
      true
    );
    assert.equal(
      isBusinessProfileIncomplete({ rubro: 'ropa', pais: 'Uruguay', ciudad: 'Montevideo' }),
      false
    );
  });
});
