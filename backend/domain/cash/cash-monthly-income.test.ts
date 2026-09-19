import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  listTrailingCalendarMonths,
  summarizeCashMonthlyIncome,
} from './cash-monthly-income.ts';
import { presentCashIncomeSummary } from '../../whatsapp/agent/agent-presenter.ts';

describe('cash monthly income summary', () => {
  it('lists trailing calendar months oldest to newest', () => {
    const months = listTrailingCalendarMonths(3, new Date(2026, 8, 8)); // Sep 2026
    assert.deepEqual(months, [
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it('aggregates ingresos by month and averages months with income', () => {
    const caja = {
      ambitos: [
        { id: 'negocio', label: 'Rilo', sistema: true },
        { id: 'personal', label: 'Personal', sistema: false },
      ],
    };
    const summary = summarizeCashMonthlyIncome(
      [
        { tipo: 'ingreso', monto: 1000, ambito: 'negocio', fecha: '2026-07-10T12:00:00.000Z' },
        { tipo: 'ingreso', monto: 500, ambito: 'negocio', fecha: '2026-07-20T12:00:00.000Z' },
        { tipo: 'egreso', monto: 200, ambito: 'negocio', fecha: '2026-07-15T12:00:00.000Z' },
        { tipo: 'ingreso', monto: 800, ambito: 'negocio', fecha: '2026-09-01T12:00:00.000Z' },
        { tipo: 'ingreso', monto: 999, ambito: 'personal', fecha: '2026-09-02T12:00:00.000Z' },
      ],
      caja,
      { months: 3, ambitoId: 'negocio', reference: new Date(2026, 8, 8) }
    );
    assert.equal(summary.monthsRequested, 3);
    assert.equal(summary.monthsWithIncome, 2);
    assert.equal(summary.totalIngresos, 2300);
    assert.equal(summary.promedioMensualIngresos, 1150);
    assert.equal(summary.cashAccountName, 'Rilo');
    assert.deepEqual(
      summary.months.map((row) => ({ label: row.label, ingreso: row.ingreso })),
      [
        { label: 'jul 2026', ingreso: 1500 },
        { label: 'ago 2026', ingreso: 0 },
        { label: 'sep 2026', ingreso: 800 },
      ]
    );
  });

  it('presenter shows months total and average without orders', () => {
    const reply = presentCashIncomeSummary({
      status: 'resolved',
      cashAccountName: 'Rilo',
      monthsRequested: 3,
      monthsWithIncome: 2,
      totalIngresos: 2300,
      promedioMensualIngresos: 1150,
      months: [
        { label: 'jul 2026', ingreso: 1500 },
        { label: 'ago 2026', ingreso: 0 },
        { label: 'sep 2026', ingreso: 800 },
      ],
    });
    assert.match(reply, /Ingresos de caja · Rilo/);
    assert.match(reply, /Promedio mensual/);
    assert.match(reply, /1\.150|1150/);
    assert.doesNotMatch(reply, /Pedidos/);
    assert.doesNotMatch(reply, /#00/);
  });
});
