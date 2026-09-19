import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSalePaymentMethodId } from '../backend/domain/sales/create-mostrador-sale.ts';

describe('sale payment method resolution (unit shape)', () => {
  it('exports resolveSalePaymentMethodId', () => {
    assert.equal(typeof resolveSalePaymentMethodId, 'function');
  });
});
