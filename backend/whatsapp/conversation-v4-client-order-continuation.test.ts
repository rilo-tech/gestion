import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { presentToolAmbiguity } from './agent/agent-presenter.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  adjustPendingWritesForOrder,
  analyzePendingWrites,
  buildOrderAlreadyCompleteReply,
  buildOrderPartialSatisfiedReply,
  clientCandidateTitleForOperations,
  clientNotFoundMessage,
  compoundOrderPlanSummary,
  evaluateOrderForActions,
  filterEligibleOrderRecords,
  isOrderEligibleForOperations,
  noEligibleClientsMessage,
  resolveOrdersForOperation,
} from './v4-order-operation.ts';
import { resolveFindOrderHints, type FindOrderDeps } from './resolve-order-reference.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899111111',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const pendingWrites = [
  { tool: 'update_order_status', arguments: { status: 'entregado' } },
  { tool: 'collect_order_full_balance', arguments: {} },
];
const ops = analyzePendingWrites(pendingWrites);

describe('Ambiguity shows options immediately', () => {
  it('presents numbered client list with operation title', () => {
    const reply = presentToolAmbiguity('client', {
      status: 'ambiguous',
      errorCode: 'ENTITY_AMBIGUOUS',
      title: clientCandidateTitleForOperations(ops),
      candidates: [
        { id: 'c1', name: 'Vicky A', telefono: '099111111' },
        { id: 'c2', name: 'Vicky B' },
      ],
    });
    assert.ok(reply);
    assert.match(reply!, /👥 Clientes con pedidos para entregar/);
    assert.match(reply!, /1\. 👤 Vicky A/);
    assert.match(reply!, /Indicame qué ítem querés usar|qué querés hacer/);
  });
});

describe('TEST A — single eligible client auto-resolved', () => {
  it('auto-resolves single client with eligible orders', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({
        status: 'ambiguous',
        query: 'Viky',
        candidates: [
          { id: 'a', name: 'Vicky A', score: 1 },
          { id: 'b', name: 'Vicky B', score: 0.9 },
          { id: 'c', name: 'Victoria Ferreira', score: 0.8 },
        ],
      }),
      listByClientId: async (clientId) => {
        if (clientId === 'a') {
          return [{ id: 'o1', data: { estado: 'pendiente', saldo: 1800, numeroPedido: 120, clienteNombre: 'Vicky A' } }];
        }
        if (clientId === 'b') {
          return [{ id: 'o2', data: { estado: 'entregado', saldo: 0, numeroPedido: 100, clienteNombre: 'Vicky B' } }];
        }
        return [];
      },
      countEligibleOrdersForClient: async (clientId) => {
        const rows = await deps.listByClientId(clientId, 10);
        return filterEligibleOrderRecords(rows, ops).length;
      },
    };
    const result = await resolveFindOrderHints(
      {
        clientQuery: 'Viky',
        operationContext: { pendingWrites },
      },
      deps,
      undefined
    );
    assert.equal(result.status, 'resolved');
    assert.equal(result.entity?.id, 'o1');
    assert.equal(result.operationOutcome, 'eligible');
  });
});

describe('find_client delegates to order resolution with operation context', () => {
  it('filters clients when agent uses find_client + writes', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({
        status: 'ambiguous',
        query: 'Viky',
        candidates: [
          { id: 'a', name: 'vicky Barrios', score: 1 },
          { id: 'b', name: 'Vicky', score: 0.95 },
          { id: 'c', name: 'Victoria Ferreira', score: 0.8 },
        ],
      }),
      listByClientId: async (clientId) => {
        if (clientId === 'b') {
          return [{ id: 'o120', data: { estado: 'pendiente', saldo: 1500, numeroPedido: 120, clienteNombre: 'Vicky' } }];
        }
        return [{ id: 'o100', data: { estado: 'entregado', saldo: 0, numeroPedido: 100 } }];
      },
      countEligibleOrdersForClient: async (clientId) => {
        const rows = await deps.listByClientId(clientId, 10);
        return filterEligibleOrderRecords(rows, ops).length;
      },
    };
    const result = await resolveFindOrderHints(
      { clientQuery: 'Viky', operationContext: { pendingWrites } },
      deps,
      undefined
    );
    assert.equal(result.status, 'resolved');
    assert.equal(result.entity?.id, 'o120');
  });
});

describe('TEST B — only clients with eligible orders shown', () => {
  it('filters ambiguous clients to those with eligible orders', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({
        status: 'ambiguous',
        query: 'Viky',
        candidates: [
          { id: 'a', name: 'Vicky A', score: 1 },
          { id: 'b', name: 'Vicky B', score: 0.9 },
        ],
      }),
      listByClientId: async (clientId) => {
        if (clientId === 'a') {
          return [{ id: 'o1', data: { estado: 'pendiente', saldo: 1800, numeroPedido: 120 } }];
        }
        return [{ id: 'o2', data: { estado: 'pendiente', saldo: 800, numeroPedido: 135 } }];
      },
      countEligibleOrdersForClient: async (clientId) => {
        const rows = await deps.listByClientId(clientId, 10);
        return filterEligibleOrderRecords(rows, ops).length;
      },
    };
    const result = await resolveFindOrderHints(
      { clientQuery: 'Viky', operationContext: { pendingWrites } },
      deps,
      undefined
    );
    assert.equal(result.status, 'ambiguous');
    assert.equal((result.candidates as Array<{ id: string }>).length, 2);
    assert.match(result.title ?? '', /Clientes con pedidos/);
  });
});

describe('TEST C — single eligible order auto-resolved', () => {
  it('resolves unique client to single eligible order', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({
        status: 'resolved',
        entity: { id: 'vicky', name: 'Vicky' },
        query: 'Viky',
      }),
      listByClientId: async () => [
        { id: 'o1', data: { estado: 'pendiente', saldo: 1500, numeroPedido: 120, clienteNombre: 'Vicky' } },
        { id: 'o2', data: { estado: 'entregado', saldo: 0, numeroPedido: 100, clienteNombre: 'Vicky' } },
      ],
    };
    const result = await resolveFindOrderHints(
      { clientQuery: 'Viky', operationContext: { pendingWrites } },
      deps,
      undefined
    );
    assert.equal(result.status, 'resolved');
    assert.equal(result.entity?.id, 'o1');
  });
});

describe('TEST D — delivered order preserves collect action', () => {
  it('marks status satisfied and collect applicable', () => {
    const evaluation = evaluateOrderForActions(
      { estado: 'entregado', saldo: 1500, total: 1500 },
      ops
    );
    assert.ok(evaluation.alreadySatisfiedActions.includes('update_order_status'));
    assert.ok(evaluation.applicableActions.includes('collect_order_full_balance'));
  });

  it('builds partial satisfied confirmation copy', () => {
    const order = {
      id: 'o1',
      data: { estado: 'entregado', saldo: 1500, numeroPedido: 120, clienteNombre: 'Vicky' },
    };
    const adjusted = adjustPendingWritesForOrder(pendingWrites, order);
    assert.equal(adjusted.length, 1);
    assert.equal(adjusted[0]?.tool, 'collect_order_full_balance');
    const reply = buildOrderPartialSatisfiedReply(order, pendingWrites);
    assert.match(reply, /Ya está entregado/);
    assert.match(reply, /Saldo pendiente/);
    assert.match(reply, /Confirmo/);
  });
});

describe('TEST E — delivered and paid informs user', () => {
  it('detects already complete order', () => {
    const resolution = resolveOrdersForOperation(
      [{ id: 'o1', data: { estado: 'entregado', saldo: 0, numeroPedido: 120, clienteNombre: 'Vicky' } }],
      ops
    );
    assert.equal(resolution.kind, 'already_complete');
    const reply = buildOrderAlreadyCompleteReply(resolution.order, ops);
    assert.match(reply, /entregado y saldado/);
  });
});

describe('TEST F — no client found', () => {
  it('returns client not found message', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({ status: 'not_found', query: 'Nadie' }),
      listByClientId: async () => [],
    };
    const result = await resolveFindOrderHints(
      { clientQuery: 'Nadie', operationContext: { pendingWrites } },
      deps,
      undefined
    );
    assert.equal(result.errorCode, 'ENTITY_NOT_FOUND');
    assert.match(result.message ?? '', /No encontré ese cliente/);
    assert.match(result.message ?? '', /número de pedido/);
  });

  it('hides clients without eligible orders', async () => {
    const deps: FindOrderDeps = {
      getById: async () => null,
      findByReference: async () => [],
      findClient: async () => ({
        status: 'ambiguous',
        query: 'Viky',
        candidates: [
          { id: 'a', name: 'Vicky A', score: 1 },
          { id: 'b', name: 'Vicky B', score: 0.9 },
        ],
      }),
      listByClientId: async () => [
        { id: 'o1', data: { estado: 'entregado', saldo: 0, numeroPedido: 100 } },
      ],
      countEligibleOrdersForClient: async () => 0,
    };
    const result = await resolveFindOrderHints(
      { clientQuery: 'Viky', operationContext: { pendingWrites } },
      deps,
      undefined
    );
    assert.equal(result.errorCode, 'ENTITY_NOT_FOUND');
    assert.match(result.message ?? '', /No encontré un pedido para entregar/);
  });
});

describe('Order eligibility predicates', () => {
  it('eligible for pending non-delivered order with balance', () => {
    assert.equal(
      isOrderEligibleForOperations({ estado: 'pendiente', saldo: 1800, total: 1800 }, ops),
      true
    );
  });

  it('not eligible when delivered and saldado', () => {
    assert.equal(
      isOrderEligibleForOperations({ estado: 'entregado', saldo: 0, total: 1800 }, ops),
      false
    );
  });

  it('eligible when delivered but unpaid for collect', () => {
    assert.equal(
      isOrderEligibleForOperations({ estado: 'entregado', saldo: 1500, total: 1500 }, ops),
      true
    );
  });

  it('adjustPendingWrites keeps both actions when applicable', () => {
    const adjusted = adjustPendingWritesForOrder(pendingWrites, {
      id: 'o1',
      data: { estado: 'pendiente', saldo: 1800, total: 1800, clienteNombre: 'Vicky' },
    });
    assert.equal(adjusted.length, 2);
    assert.equal(adjusted[0]?.tool, 'update_order_status');
    assert.equal(adjusted[1]?.tool, 'collect_order_full_balance');
  });
});

describe('Compound plan summary', () => {
  it('preserves update status and collect full balance', () => {
    const summary = compoundOrderPlanSummary(
      {
        id: 'o1',
        data: { estado: 'pendiente', saldo: 1800, total: 1800, numeroPedido: 250, clienteNombre: 'Vicky' },
      },
      pendingWrites
    );
    assert.match(summary.title, /Pedido #00250 · Vicky/);
    assert.match(summary.lines.join('\n'), /entregado/i);
    assert.match(summary.lines.join('\n'), /Saldo total/);
  });
});

describe('TEST G — numeric selection does not repeat list', () => {
  it('list_orders resume with clientId does not re-ambiguous', async () => {
    let agentCalls = 0;
    const state = buildCandidateSelectionState({
      entityType: 'client',
      options: [
        { index: 1, entityId: 'a', label: '👤 Pizzería Acapella' },
        { index: 2, entityId: 'b', label: '👤 Acapella Eventos' },
      ],
      resume: {
        originalUserText: 'mostrame los pedidos de Acapella',
        blockedTool: 'list_orders',
        blockedArgs: { clientQuery: 'Acapella' },
      },
    });
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '1', messageId: 'pick-1' },
        text: '1',
        state: {
          businessId: tenant.businessId,
          phone: tenant.phone,
          updatedAt: new Date().toISOString(),
          ...state,
        } as ConversationState,
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run');
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    assert.doesNotMatch(result.reply, /Clientes encontrados/);
  });
});

describe('Messaging helpers', () => {
  it('clientNotFoundMessage asks for order number', () => {
    assert.match(clientNotFoundMessage(), /número de pedido/);
  });

  it('noEligibleClientsMessage explains missing eligible orders', () => {
    const message = noEligibleClientsMessage('Viky', ops);
    assert.match(message, /No encontré un pedido para entregar/);
  });
});
