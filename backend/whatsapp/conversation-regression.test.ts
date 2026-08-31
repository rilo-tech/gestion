import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWithRules } from './ai-command-parser.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';
import { formatOperationSummary, looksLikeCollectFullBalance } from './lookups.ts';
import {
  applyOrderLock,
  isExplicitOrderSwitch,
  plannedCollection,
  shouldUseLockedOrder,
  type LockedOrderEntity,
} from './order-lock.ts';
import {
  filterOrdersByQuery,
  parseOrderQueryFilter,
} from './order-query-filter.ts';

const LOCKED_220: LockedOrderEntity = {
  kind: 'order',
  id: 'ord-00220',
  label: '00220',
  clientName: 'Cardozo moto repuesto',
  resolved: true,
  active: true,
};

const OTHER_231 = {
  id: 'ord-00231',
  label: '00231',
  clientName: 'Cardozo moto repuesto',
  estado: 'entregado',
  saldo: 0,
};

const OPEN_220 = {
  id: 'ord-00220',
  label: '00220',
  clientName: 'Cardozo moto repuesto',
  estado: 'pendiente',
  saldo: 5190,
};

function entitiesOf(text: string, locked = LOCKED_220): WhatsappCommandEntities {
  const parsed = parseWithRules(text, { focusOrder: locked });
  const base = 'entities' in parsed ? parsed.entities ?? {} : {};
  return applyOrderLock({ ...base, sourceText: text }, locked, text);
}

function statusTurn(text: string, locked = LOCKED_220, saldo = 5190) {
  const parsed = parseWithRules(text, { focusOrder: locked });
  const entities = entitiesOf(text, locked);
  const money = plannedCollection({
    saldo,
    payFullBalance: entities.payFullBalance,
    paid: entities.paid,
    amount: entities.amount,
  });
  const summary = formatOperationSummary('update_order_status', {
    ...entities,
    targetOrderId: entities.targetOrderId,
    targetOrderLabel: entities.targetOrderLabel || locked.label,
    clientName: entities.clientName || locked.clientName,
    orderStatus: entities.orderStatus,
    orderStatusLabel: 'Entregado',
    targetOrderEstadoLabel: 'Pendiente',
    targetOrderSaldo: saldo,
    paid: entities.paid,
    payFullBalance: entities.payFullBalance,
    sourceText: text,
  });
  return { parsed, entities, money, summary };
}

describe('TEST 1 — múltiples cambios sobre la misma entidad', () => {
  it('cambialo a entregado y cobra todo el saldo sobre #00220', () => {
    const text = 'cambialo a entregado y cobra todo el saldo';
    const { parsed, entities, money, summary } = statusTurn(text);

    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.targetOrderId, 'ord-00220');
    assert.equal(entities.targetOrderLabel, '00220');
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(entities.payFullBalance, true);
    assert.equal(money.collect, 5190);
    assert.equal(money.remaining, 0);
    assert.match(summary, /#00220/);
    assert.match(summary, /entregado/i);
    assert.match(summary, /5\.?190|5190/);
    assert.match(summary, /queda \$?0/);
    assert.doesNotMatch(summary, /No cobro nada/);
    assert.equal((summary.match(/SÍ/g) ?? []).length, 1);
    assert.equal(shouldUseLockedOrder(text, entities, LOCKED_220), true);
  });
});

describe('TEST 2 — preservar entidad activa', () => {
  it('no sustituye #00220 por #00231 ni reabre búsqueda global', () => {
    const text = 'ponelo en estado entregado y saldalo todo por $5190';
    const { parsed, entities, money } = statusTurn(text);

    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.targetOrderId, 'ord-00220');
    assert.notEqual(entities.targetOrderId, OTHER_231.id);
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(shouldUseLockedOrder(text, entities, LOCKED_220), true);
    assert.equal(
      isExplicitOrderSwitch(text, { ...entities, orderNumber: '231' }, LOCKED_220),
      true
    );
    assert.equal(isExplicitOrderSwitch(text, entities, LOCKED_220), false);
    assert.equal(money.collect, 5190);
    assert.equal(money.remaining, 0);
  });
});

describe('TEST 3 — filtros negativos', () => {
  const phrases = [
    'mostrame el pedido de Cardozo que NO esté en estado entregado',
    'que no esté entregado',
    'sin entregar',
    'que todavía no entregué',
    'falta entregar',
    'no entregado aún',
  ];

  for (const phrase of phrases) {
    it(`«${phrase}» produce status != entregado`, () => {
      const filter = parseOrderQueryFilter(phrase);
      assert.equal(filter.statusNotEquals, 'entregado', phrase);
      assert.equal(filter.allowClosedFallback, false, phrase);
      const hits = filterOrdersByQuery([OPEN_220, OTHER_231], filter);
      assert.equal(hits.length, 1, phrase);
      assert.equal(hits[0]?.id, 'ord-00220');
      assert.equal(
        hits.some((item) => item.estado === 'entregado'),
        false
      );
    });
  }
});

describe('TEST 4 — combinación de los tres casos', () => {
  it('ese, ponelo entregado y cobrame todo lo que falta usa #00220', () => {
    const search = 'buscame el pedido de Cardozo que todavía no entregué';
    const searchFilter = parseOrderQueryFilter(search);
    assert.equal(searchFilter.statusNotEquals, 'entregado');
    const listed = filterOrdersByQuery([OPEN_220, OTHER_231], searchFilter);
    assert.equal(listed[0]?.id, 'ord-00220');

    const text = 'ese, ponelo entregado y cobrame todo lo que falta';
    assert.equal(looksLikeCollectFullBalance(text), true);
    const { parsed, entities, money, summary } = statusTurn(text);
    assert.equal(parsed.intent, 'update_order_status');
    assert.equal(entities.targetOrderId, 'ord-00220');
    assert.equal(entities.orderStatus, 'entregado');
    assert.equal(entities.payFullBalance, true);
    assert.equal(money.collect, 5190);
    assert.equal(money.remaining, 0);
    assert.equal(shouldUseLockedOrder(text, entities, LOCKED_220), true);
    assert.match(summary, /#00220/);
    assert.match(summary, /SÍ/);
    assert.doesNotMatch(summary, /00231/);
  });
});
