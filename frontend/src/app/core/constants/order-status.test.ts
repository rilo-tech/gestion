import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countPendingOrdersByStatus,
  formatPendingOrderStatusSummary,
  getPendingOrdersTotal,
  isOrderPendingDelivery,
  normalizeOrderStatus,
} from './order-status.ts';

describe('normalizeOrderStatus', () => {
  it('prioriza entregado sobre listo en textos mixtos', () => {
    assert.equal(normalizeOrderStatus('entregado listo'), 'entregado');
    assert.equal(normalizeOrderStatus('listo entregado'), 'entregado');
  });

  it('clasifica estados operativos sin entregar', () => {
    assert.equal(normalizeOrderStatus('pendiente'), 'pendiente');
    assert.equal(normalizeOrderStatus('en_produccion'), 'en_produccion');
    assert.equal(normalizeOrderStatus('listo'), 'listo');
  });
});

describe('pending order counts', () => {
  it('suma solo pendiente, en_produccion y listo', () => {
    const counts = countPendingOrdersByStatus([
      { estado: 'pendiente' },
      { estado: 'en_produccion' },
      { estado: 'listo' },
      { estado: 'listo' },
      { estado: 'entregado' },
      { estado: 'borrador' },
    ]);

    assert.deepEqual(counts, { pendiente: 1, en_produccion: 1, listo: 2 });
    assert.equal(getPendingOrdersTotal(counts), 4);
  });

  it('resume estados con cantidades', () => {
    const summary = formatPendingOrderStatusSummary({
      pendiente: 0,
      en_produccion: 2,
      listo: 6,
    });
    assert.equal(summary, '2 en proceso · 6 listo');
  });

  it('isOrderPendingDelivery respeta entregado antes que listo', () => {
    assert.equal(isOrderPendingDelivery({ estado: 'entregado listo' }), false);
    assert.equal(isOrderPendingDelivery({ estado: 'listo' }), true);
  });
});
