import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BARCODE_LOCK_ABSENCE_MS,
  createContinuousScanLock,
  observeContinuousScan,
  releaseContinuousScanIfAbsent,
} from './barcode-scan-lock.ts';

describe('continuous barcode scan lock', () => {
  it('emite una sola vez mientras el mismo código permanece visible', () => {
    const state = createContinuousScanLock();
    assert.equal(observeContinuousScan(state, '779', 1000), true);
    assert.equal(observeContinuousScan(state, '779', 1100), false);
    assert.equal(observeContinuousScan(state, '779', 1500), false);
    assert.equal(observeContinuousScan(state, '779', 1000 + BARCODE_LOCK_ABSENCE_MS - 1), false);
  });

  it('permite recontar tras ausencia del código', () => {
    const state = createContinuousScanLock();
    assert.equal(observeContinuousScan(state, '779', 1000), true);
    assert.equal(releaseContinuousScanIfAbsent(state, 1000 + BARCODE_LOCK_ABSENCE_MS), true);
    assert.equal(state.lockedCode, null);
    assert.equal(observeContinuousScan(state, '779', 1000 + BARCODE_LOCK_ABSENCE_MS + 10), true);
  });

  it('no cambia a otro código hasta liberar el anterior', () => {
    const state = createContinuousScanLock();
    assert.equal(observeContinuousScan(state, 'AAA', 1000), true);
    assert.equal(observeContinuousScan(state, 'BBB', 1100), false);
    releaseContinuousScanIfAbsent(state, 1000 + BARCODE_LOCK_ABSENCE_MS);
    assert.equal(observeContinuousScan(state, 'BBB', 2000), true);
  });
});
