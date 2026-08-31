import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  balanceFromSummary,
  dayTotalsFromMovements,
  getCashMovements,
  summarizeCashMovements,
} from './cash-query.ts';
import { registerCashMovement } from './cash-service.ts';
import type { CashMovementRecord, CashRepository } from './cash-repository.ts';
import type { RegisterCashMovementCommand } from './cash-types.ts';

const RILO_CAJA = {
  ambitos: [
    { id: 'negocio', label: 'Negocio', sistema: true },
    { id: 'personal', label: 'Personal', sistema: false },
  ],
};

function memoryRepo(seed: CashMovementRecord[] = []): CashRepository {
  const docs = new Map<string, CashMovementRecord>(seed.map((row) => [row.id, { ...row }]));
  const idem = new Map<string, string>();
  const caja = { ...RILO_CAJA };
  let n = seed.length;
  return {
    async loadCajaConfig() {
      return caja;
    },
    async insertMovement(_businessId, data) {
      n += 1;
      const id = `mov-${n}`;
      docs.set(id, { id, ...data });
      return id;
    },
    async getMovement(_businessId, movementId) {
      return docs.get(movementId) ?? null;
    },
    async insertMovementIdempotent(_businessId, key, data) {
      const existing = idem.get(key);
      if (existing) return { movementId: existing, reused: true };
      n += 1;
      const id = `mov-${n}`;
      docs.set(id, { id, ...data });
      idem.set(key, id);
      return { movementId: id, reused: false };
    },
    async listAllMovements() {
      return [...docs.values()];
    },
    async listMovementsPaged(_businessId, opts) {
      const items = [...docs.values()].slice(0, opts.limit);
      return { items, hasMore: false, nextCursor: null };
    },
  };
}

describe('CashQueryService (estructura ya interpretada, no frases)', () => {
  const movements: CashMovementRecord[] = [
    {
      id: '1',
      tipo: 'ingreso',
      monto: 1000,
      ambito: 'negocio',
      fecha: '2026-08-29T15:00:00.000Z',
    },
    {
      id: '2',
      tipo: 'egreso',
      monto: 370,
      ambito: 'negocio',
      fecha: '2026-08-29T16:00:00.000Z',
    },
    {
      id: '3',
      tipo: 'egreso',
      monto: 80,
      ambito: 'personal',
      fecha: '2026-08-28T12:00:00.000Z',
    },
  ];

  it('query_cash sin ámbito → saldo de todas las cajas del tenant', () => {
    const summary = summarizeCashMovements(movements, RILO_CAJA, { month: 8, year: 2026 });
    const balance = balanceFromSummary(summary, RILO_CAJA);
    assert.equal(balance.saldo, 1000 - 370 - 80);
    assert.equal(balance.byAmbito.find((row) => row.id === 'negocio')?.saldo, 630);
    assert.equal(balance.byAmbito.find((row) => row.id === 'personal')?.saldo, -80);
  });

  it('query_cash ámbito personal → saldo de esa caja configurada', () => {
    const summary = summarizeCashMovements(movements, RILO_CAJA, { month: 8, year: 2026 });
    const balance = balanceFromSummary(summary, RILO_CAJA, 'personal');
    assert.equal(balance.scope, 'personal');
    assert.equal(balance.saldo, -80);
  });

  it('query_cash del día → totales del ERP, no de la IA', () => {
    const day = dayTotalsFromMovements(movements, RILO_CAJA, '2026-08-29');
    assert.equal(day.ingresos, 1000);
    assert.equal(day.egresos, 370);
    assert.equal(day.neto, 630);
    assert.equal(day.count, 2);
  });

  it('últimos movimientos: el query recibe limit, no una frase', async () => {
    const repo = memoryRepo(movements);
    const items = await getCashMovements('negocio-rilo', { limit: 2 }, { repo });
    assert.ok(Array.isArray(items));
    assert.equal(items.length, 2);
  });
});

describe('Idempotencia en el domain write', () => {
  it('la misma key no crea dos movimientos', async () => {
    const repo = memoryRepo();
    const command: RegisterCashMovementCommand = {
      businessId: 'negocio-rilo',
      type: 'egreso',
      amount: 430,
      concept: 'garrafa',
      scope: 'negocio',
      date: '2026-08-29',
      source: 'whatsapp',
      actor: { type: 'whatsapp_user', phone: '+5989' },
      idempotencyKey: 'wa:wamid.ABC',
    };
    const first = await registerCashMovement(command, { repo, now: new Date('2026-08-29T18:00:00.000Z') });
    const second = await registerCashMovement(command, { repo, now: new Date('2026-08-29T18:01:00.000Z') });
    assert.equal(first.movementId, second.movementId);
    assert.equal(second.reused, true);
    const all = await repo.listAllMovements('negocio-rilo');
    assert.equal(all.length, 1);
  });
});
