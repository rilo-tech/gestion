import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Mismo criterio que addOrIncrementProductFromSearch en venta/pedido/compra. */
function addOrIncrement(
  lines: Array<{ productId: string; quantity: number }>,
  productId: string,
  qty = 1
): Array<{ productId: string; quantity: number }> {
  const existing = lines.find((l) => l.productId === productId);
  if (existing) {
    existing.quantity += qty;
    return lines;
  }
  lines.push({ productId, quantity: qty });
  return lines;
}

describe('venta/pedido/compra scan increment', () => {
  it('primer scan agrega cantidad 1', () => {
    const lines = addOrIncrement([], 'p1', 1);
    assert.deepEqual(lines, [{ productId: 'p1', quantity: 1 }]);
  });

  it('segundo scan del mismo producto incrementa a 2', () => {
    const lines = addOrIncrement([{ productId: 'p1', quantity: 1 }], 'p1', 1);
    assert.deepEqual(lines, [{ productId: 'p1', quantity: 2 }]);
  });

  it('producto distinto no duplica líneas del primero', () => {
    let lines = addOrIncrement([], 'p1', 1);
    lines = addOrIncrement(lines, 'p2', 1);
    assert.equal(lines.length, 2);
    assert.equal(lines.find((l) => l.productId === 'p1')?.quantity, 1);
  });
});
