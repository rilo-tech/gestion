import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTurnInterpretation } from './turn-interpretation.ts';
import { resolveSemanticTurn, semanticCommandToLegacyEntities } from './semantic-command.ts';
import { mapLinguisticIntent, isUnwiredCapability } from './capability-registry.ts';
import { fallbackQuestion } from './clarify.ts';

function run(raw: Record<string, unknown>, message: string, last?: { intent: string; slots: Record<string, unknown> }) {
  const interpretation = normalizeTurnInterpretation(raw, message);
  const resolved = resolveSemanticTurn(
    interpretation,
    last
      ? { lastQuery: { intent: last.intent, slots: last.slots } }
      : undefined
  );
  return {
    interpretation,
    resolved,
    entities: semanticCommandToLegacyEntities(resolved.command),
    planIntent: resolved.command.operations[0]?.intent,
  };
}

describe('Interpretación general (JSON estructural, sin frases en el prompt)', () => {
  it('create_order no se confunde con query_orders', () => {
    const created = run(
      {
        intent: 'create_order',
        conversationAction: 'new_task',
        client: { raw: 'María' },
        items: [{ rawText: '2 remeras', quantity: 2 }],
      },
      'haceme un pedido para María de 2 remeras'
    );
    const listed = run(
      {
        intent: 'query_orders',
        conversationAction: 'new_task',
        query: { entity: 'orders', metric: 'list', filters: { clientHint: 'María' } },
      },
      'qué encargos tiene María?'
    );
    assert.equal(created.planIntent, 'create_order');
    assert.equal(listed.planIntent, 'query_status');
    assert.equal(listed.resolved.command.operations[0]?.filters?.listOrders, true);
    assert.equal(listed.entities.clientName, 'María');
    assert.notEqual(listed.planIntent, 'create_order');
  });

  it('follow-up de consulta hereda cliente y suma filtro', () => {
    const { resolved, entities } = run(
      {
        intent: 'query_status',
        conversationAction: 'continue_current',
        query: { entity: 'orders', metric: 'list' },
        filters: { status: 'pendiente' },
      },
      'solo los pendientes',
      { intent: 'query_status', slots: { clientName: 'Acapella', metric: 'list', entity: 'orders' } }
    );
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Acapella');
    assert.equal(resolved.command.operations[0]?.filters?.status, 'pendiente');
    assert.equal(entities.queryStatusFilter, 'pendiente');
  });

  it('pago seña vs estado no colapsan', () => {
    const pay = run(
      {
        intent: 'register_payment',
        conversationAction: 'new_task',
        payment: { kind: 'deposit', amount: 500 },
        client: { raw: 'Carla' },
      },
      'dejó 500 de seña'
    );
    const status = run(
      {
        intent: 'update_order_status',
        conversationAction: 'new_task',
        requestedStatus: 'listo',
        targetReference: { type: 'focused_order' },
      },
      'ponelo listo'
    );
    assert.equal(pay.planIntent, 'register_payment');
    assert.equal(pay.resolved.command.operations[0]?.payment?.kind, 'senia');
    assert.equal(status.planIntent, 'update_order_status');
    assert.equal(status.resolved.command.operations[0]?.requestedStatus, 'listo');
  });

  it('how_to no es create_order', () => {
    const { planIntent } = run(
      { intent: 'how_to', conversationAction: 'new_task', helpTopic: 'productos' },
      'cómo registro varios productos juntos?'
    );
    assert.equal(planIntent, 'how_to');
  });

  it('capability unwired no se degrada a create_order', () => {
    const mapped = mapLinguisticIntent('create_product');
    assert.equal(mapped.unwired, true);
    assert.equal(mapped.intent, 'unknown');
    assert.equal(isUnwiredCapability('create_product'), true);
    const { interpretation, planIntent } = run(
      { intent: 'create_product', conversationAction: 'new_task' },
      'dame de alta una remera premium'
    );
    assert.equal(planIntent, 'unknown');
    assert.equal(interpretation.capabilityUnwired, true);
    assert.equal(interpretation.requestedCapability, 'create_product');
  });

  it('caja: expense vs query', () => {
    const cash = run(
      {
        intent: 'register_cash',
        conversationAction: 'new_task',
        cash: { type: 'egreso', amount: 520, concept: 'internet', scope: 'negocio' },
      },
      'pagamos 520 del internet con la caja del negocio'
    );
    const query = run(
      { intent: 'query_cash', conversationAction: 'new_task' },
      'cuánto tengo en caja?'
    );
    assert.equal(cash.planIntent, 'register_cash');
    assert.equal(cash.resolved.command.operations[0]?.cash?.amount, 520);
    assert.equal(query.planIntent, 'query_cash');
  });

  it('multi-op status + cobro saldo', () => {
    const { resolved } = run(
      {
        intent: 'update_order_status',
        conversationAction: 'new_task',
        requestedStatus: 'entregado',
        payment: { fullBalance: true },
        targetReference: { type: 'focused_order' },
        operations: [{ intent: 'register_payment', payment: { fullBalance: true } }],
      },
      'marcalo entregado y cobrá el saldo'
    );
    assert.equal(resolved.command.operations[0]?.intent, 'update_order_status');
    assert.ok(resolved.command.operations.some((op) => op.intent === 'register_payment'));
  });

  it('fallback genérico ya no ofrece el trío pedido/cobro/anotado', () => {
    const text = fallbackQuestion('mostrame los pedidos de acapella');
    assert.doesNotMatch(text, /pedido nuevo, un cobro, o algo ya anotado/i);
  });
});
