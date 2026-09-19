import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CashDomainError } from './cash-errors.ts';
import {
  buildCashMovementUpdate,
  isManualCashMovement,
  resolveCashUpdateAmbito,
} from './cash-update.ts';

const RILO_CAJA = {
  ambitos: [
    { id: 'negocio', label: 'Rilo', sistema: true },
    { id: 'personal', label: 'Personal', sistema: false },
  ],
};

const NOW = new Date('2026-08-31T14:05:00.000Z');

const MANUAL_EGRESO = {
  tipo: 'egreso',
  monto: 60,
  concepto: 'Compra de tortas (personal)',
  ambito: 'negocio',
  origenTipo: 'caja_manual_egreso',
  origenGrupo: 'manual',
  fecha: '2026-08-31T14:05:00.000Z',
};

describe('isManualCashMovement', () => {
  it('acepta egresos cargados a mano', () => {
    assert.equal(isManualCashMovement(MANUAL_EGRESO), true);
  });

  it('rechaza egresos generados por una compra', () => {
    assert.equal(
      isManualCashMovement({
        ...MANUAL_EGRESO,
        origenTipo: 'compra',
        origenGrupo: 'compra',
        compraId: 'abc',
      }),
      false
    );
  });
});

describe('resolveCashUpdateAmbito', () => {
  it('cambia de Rilo (negocio) a personal', () => {
    assert.equal(resolveCashUpdateAmbito('personal', 'negocio', RILO_CAJA), 'personal');
  });

  it('acepta el label Personal', () => {
    assert.equal(resolveCashUpdateAmbito('Personal', 'negocio', RILO_CAJA), 'personal');
  });

  it('rechaza una caja que no existe', () => {
    assert.throws(
      () => resolveCashUpdateAmbito('inventada', 'negocio', RILO_CAJA),
      (err: unknown) => err instanceof CashDomainError && err.code === 'INVALID_CASH_SCOPE'
    );
  });
});

describe('buildCashMovementUpdate', () => {
  it('en un movimiento manual persiste el cambio de caja a personal', () => {
    const patch = buildCashMovementUpdate(
      MANUAL_EGRESO,
      {
        tipo: 'egreso',
        monto: 60,
        concepto: 'Compra de tortas (personal)',
        medio: 'efectivo',
        ambito: 'personal',
        fecha: '2026-08-31T14:05:00.000Z',
      },
      RILO_CAJA,
      NOW
    );

    assert.equal(patch.ambito, 'personal');
    assert.equal(patch.monto, 60);
    assert.equal(patch.concepto, 'Compra de tortas (personal)');
    assert.equal(patch.origenGrupo, 'manual');
  });

  it('en un movimiento de compra solo cambia la caja, sin pisar el origen', () => {
    const patch = buildCashMovementUpdate(
      {
        ...MANUAL_EGRESO,
        origenTipo: 'compra',
        origenGrupo: 'compra',
        compraId: 'compra-1',
      },
      {
        tipo: 'egreso',
        monto: 60,
        concepto: 'Compra de tortas (personal)',
        ambito: 'personal',
      },
      RILO_CAJA,
      NOW
    );

    assert.deepEqual(patch, { ambito: 'personal', updatedAt: NOW.toISOString() });
  });
});
