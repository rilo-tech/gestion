import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateConditionWatchState } from './automation-condition-state.ts';

describe('automation condition watch anti-spam', () => {
  it('does not notify when stock stays below threshold after first alert', () => {
    const first = evaluateConditionWatchState({
      conditionMet: true,
      conditionValue: 4,
      state: { armed: true },
    });
    assert.equal(first.shouldNotify, true);
    assert.equal(first.nextState.armed, false);

    const second = evaluateConditionWatchState({
      conditionMet: true,
      conditionValue: 4,
      state: first.nextState,
    });
    assert.equal(second.shouldNotify, false);
  });

  it('rearms when condition clears and can notify again', () => {
    let state = { armed: true, lastTriggeredAt: null as string | null };

    const fire = evaluateConditionWatchState({ conditionMet: true, conditionValue: 4, state });
    assert.equal(fire.shouldNotify, true);
    state = fire.nextState;

    const rearm = evaluateConditionWatchState({ conditionMet: false, conditionValue: 10, state });
    assert.equal(rearm.shouldNotify, false);
    assert.equal(rearm.nextState.armed, true);

    const fireAgain = evaluateConditionWatchState({
      conditionMet: true,
      conditionValue: 4,
      state: rearm.nextState,
    });
    assert.equal(fireAgain.shouldNotify, true);
  });

  it('does not notify when condition never met', () => {
    const result = evaluateConditionWatchState({
      conditionMet: false,
      conditionValue: 10,
      state: { armed: true },
    });
    assert.equal(result.shouldNotify, false);
    assert.equal(result.nextState.armed, true);
  });
});
