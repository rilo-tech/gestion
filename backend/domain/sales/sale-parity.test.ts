import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveOrderStatusFromText } from '../../whatsapp/business-runtime-context.ts';
import { saleDomainEffectsSnapshot } from './create-mostrador-sale.ts';

describe('order status label resolver', () => {
  const states = [
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'en_produccion', label: 'Preparando' },
    { id: 'listo', label: 'Listo' },
    { id: 'entregado', label: 'Entregado' },
  ];

  it('resuelve label personalizado Preparando → en_produccion', () => {
    assert.equal(resolveOrderStatusFromText('preparando', states), 'en_produccion');
  });

  it('resuelve alias en proceso → en_produccion', () => {
    assert.equal(resolveOrderStatusFromText('en proceso', states), 'en_produccion');
  });

  it('resuelve listo', () => {
    assert.equal(resolveOrderStatusFromText('listo', states), 'listo');
  });
});

describe('sale domain effects parity shape', () => {
  it('misma venta parcial produce mismos efectos contables (snapshot)', () => {
    const erpLike = saleDomainEffectsSnapshot({
      ventaId: 'a',
      ventaLabel: '1',
      numeroVenta: 1,
      total: 1500,
      montoCobrado: 800,
      saldoPendiente: 700,
      medioPago: 'transferencia',
      movimientoCajaId: 'cash-1',
    });
    const waLike = saleDomainEffectsSnapshot({
      ventaId: 'b',
      ventaLabel: '2',
      numeroVenta: 2,
      total: 1500,
      montoCobrado: 800,
      saldoPendiente: 700,
      medioPago: 'transferencia',
      movimientoCajaId: 'cash-2',
    });
    assert.deepEqual(erpLike, waLike);
    assert.equal(erpLike.total, 1500);
    assert.equal(erpLike.montoCobrado, 800);
    assert.equal(erpLike.saldoPendiente, 700);
    assert.equal(erpLike.medioPago, 'transferencia');
    assert.equal(erpLike.hasCash, true);
  });

  it('venta a cuenta no genera caja', () => {
    const snap = saleDomainEffectsSnapshot({
      ventaId: 'c',
      ventaLabel: '3',
      numeroVenta: 3,
      total: 1500,
      montoCobrado: 0,
      saldoPendiente: 1500,
      medioPago: 'transferencia',
      movimientoCajaId: null,
    });
    assert.equal(snap.hasCash, false);
    assert.equal(snap.saldoPendiente, 1500);
  });
});
