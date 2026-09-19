import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRecurringPayableFirstDueDate } from './payables.ts';

describe('resolveRecurringPayableFirstDueDate', () => {
  it('keeps this month when due day is today or later', () => {
    assert.equal(resolveRecurringPayableFirstDueDate(15, '2026-09-03'), '2026-09-15');
    assert.equal(resolveRecurringPayableFirstDueDate(3, '2026-09-03'), '2026-09-03');
  });

  it('rolls to next month when due day already passed', () => {
    assert.equal(resolveRecurringPayableFirstDueDate(7, '2026-09-10'), '2026-10-07');
  });

  it('clamps day 31 in short months', () => {
    assert.equal(resolveRecurringPayableFirstDueDate(31, '2026-02-01'), '2026-02-28');
  });

  it('rolls year when needed', () => {
    assert.equal(resolveRecurringPayableFirstDueDate(5, '2026-12-20'), '2027-01-05');
  });
});
