import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isUnvaluedHoursMovement,
  movementToFirestore,
  normalizeCollaboratorFecha,
} from './collaborators.ts';

describe('normalizeCollaboratorFecha', () => {
  it('converts AR DD/MM and DD/MM/YYYY into ISO so ERP period filters can see the row', () => {
    assert.equal(normalizeCollaboratorFecha('03/09', '2026-09-04'), '2026-09-03');
    assert.equal(normalizeCollaboratorFecha('03/09/2026'), '2026-09-03');
    assert.equal(normalizeCollaboratorFecha('3/9/26'), '2026-09-03');
    assert.equal(normalizeCollaboratorFecha('2026-09-03'), '2026-09-03');
  });
});

describe('isUnvaluedHoursMovement', () => {
  it('treats hours without rate and amount as unvalued', () => {
    assert.equal(
      isUnvaluedHoursMovement({
        tipo: 'horas',
        horas: 10,
        valorHora: undefined,
        monto: undefined,
      }),
      true
    );
  });

  it('treats legacy monto 0 as unvalued', () => {
    assert.equal(
      isUnvaluedHoursMovement({
        tipo: 'horas',
        horas: 10,
        valorHora: undefined,
        monto: 0,
      }),
      true
    );
  });

  it('treats valued hours with rate and amount as valued', () => {
    assert.equal(
      isUnvaluedHoursMovement({
        tipo: 'horas',
        horas: 10,
        valorHora: 100,
        monto: 1000,
      }),
      false
    );
  });

  it('does not treat explicit zero rate as unvalued', () => {
    assert.equal(
      isUnvaluedHoursMovement({
        tipo: 'horas',
        horas: 10,
        valorHora: 0,
        monto: 0,
      }),
      false
    );
  });

  it('movementToFirestore persists valorHora 0 and monto 0', () => {
    const doc = movementToFirestore({
      colaboradorId: 'c1',
      tipo: 'horas',
      fecha: '2026-08-31',
      horas: 10,
      valorHora: 0,
      monto: 0,
    });
    assert.equal(doc.valorHora, 0);
    assert.equal(doc.monto, 0);
  });
});

describe('parseMovementInput unvalued hours (mock-free contract)', () => {
  it('valuationMode unvalued is represented in movement body shape', () => {
    const body = {
      colaboradorId: 'c1',
      tipo: 'horas',
      fecha: '2026-08-31',
      horas: 10,
      valuationMode: 'unvalued',
    };
    assert.equal(body.valuationMode, 'unvalued');
    assert.equal('monto' in body, false);
  });
});
