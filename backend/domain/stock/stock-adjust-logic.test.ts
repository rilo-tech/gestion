import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyStockOpsInMemory,
  assertCanApplyStockDelta,
} from './stock-adjust-logic.ts';

describe('stock adjust atomic / idempotent logic', () => {
  it('dos +1 consecutivos desde 10 llegan a 12', () => {
    const result = applyStockOpsInMemory(10, [
      { quantity: 1, scanOperationId: 'a' },
      { quantity: 1, scanOperationId: 'b' },
    ]);
    assert.equal(result.stock, 12);
    assert.equal(result.appliedCount, 2);
  });

  it('misma scanOperationId se aplica una sola vez', () => {
    const result = applyStockOpsInMemory(10, [
      { quantity: 1, scanOperationId: 'same' },
      { quantity: 1, scanOperationId: 'same' },
    ]);
    assert.equal(result.stock, 11);
    assert.equal(result.appliedCount, 1);
  });

  it('salida sin stock y sin negativo no modifica', () => {
    assert.throws(
      () =>
        assertCanApplyStockDelta({
          exists: true,
          controlsStock: true,
          currentStock: 0,
          quantity: -1,
          permitsNegative: false,
        }),
      /No hay stock disponible/
    );
  });

  it('producto sin control de stock no modifica', () => {
    assert.throws(
      () =>
        assertCanApplyStockDelta({
          exists: true,
          controlsStock: false,
          currentStock: 5,
          quantity: 1,
          permitsNegative: false,
        }),
      /no controla stock físico/
    );
  });
});
