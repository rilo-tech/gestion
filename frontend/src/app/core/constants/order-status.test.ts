import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countOrdersByStatusCard,
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

describe('order status card counts', () => {
  const cardValues = ['borrador', 'pendiente', 'en_produccion', 'listo', 'entregado'];

  it('pendiente cuenta solo pedidos en estado pendiente', () => {
    const counts = countOrdersByStatusCard(
      [
        { estado: 'pendiente' },
        { estado: 'listo' },
        { estado: 'listo' },
        { estado: 'en_produccion' },
        { estado: 'entregado' },
        { estado: 'borrador' },
      ],
      cardValues
    );

    assert.equal(counts.pendiente, 1);
    assert.equal(counts.listo, 2);
    assert.equal(counts.en_produccion, 1);
    assert.equal(counts.entregado, 1);
    assert.equal(counts.borrador, 1);
  });

  it('no cambia si la lista visible está filtrada: se cuenta el universo que se le pasa', () => {
    const allOrders = [
      { estado: 'pendiente' },
      { estado: 'listo' },
      { estado: 'entregado' },
      { estado: 'entregado' },
    ];
    const filteredToSearch = allOrders.filter((order) => order.estado === 'entregado');

    const globalCounts = countOrdersByStatusCard(allOrders, cardValues);
    const filteredCounts = countOrdersByStatusCard(filteredToSearch, cardValues);

    assert.equal(globalCounts.pendiente, 1);
    assert.equal(globalCounts.entregado, 2);
    assert.equal(filteredCounts.pendiente, 0);
    assert.equal(filteredCounts.entregado, 2);
  });
});
