import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertNoUndefinedDeep,
  findUndefinedPaths,
  stripUndefinedDeep,
  toFirestoreOrderItem,
} from '../../whatsapp/firestore-mappers.ts';

describe('pedido persist sanitization', () => {
  it('toFirestoreOrderItem nunca deja undefined', () => {
    const item = toFirestoreOrderItem({
      stockItemId: undefined,
      nombre: 'Concepto libre',
      cantidad: 1,
      precioVenta: 500,
      controlaStock: undefined,
      costosExtra: undefined,
    });
    assert.equal(item.stockItemId, '');
    assert.equal(item.nombre, 'Concepto libre');
    assert.deepEqual(item.costosExtra, []);
    assert.equal(findUndefinedPaths(item).length, 0);
  });

  it('stripUndefinedDeep limpia ítems anidados del body ERP', () => {
    const dirty = {
      clienteId: 'c1',
      stockItemId: undefined,
      items: [
        {
          stockItemId: undefined,
          nombre: 'Remera',
          cantidad: 1,
          precioVenta: 100,
          controlaStock: undefined,
          costosExtra: [{ nombre: 'DTF', costo: 50 }, undefined],
        },
      ],
    };
    const clean = stripUndefinedDeep(dirty) as typeof dirty;
    assert.equal('stockItemId' in clean, false);
    assert.equal('controlaStock' in (clean.items[0] as object), false);
    assert.equal((clean.items[0] as { costosExtra: unknown[] }).costosExtra.length, 1);
    assertNoUndefinedDeep(clean, 'pedido.test');
  });
});
