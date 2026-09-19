import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeOrderReference,
  orderRecordMatchesReference,
} from '../utils/order-number.ts';
import { catalogNameEquals } from './lookups.ts';
import {
  classifyFindOrderHint,
  resolveFindOrderHints,
  type FindOrderDeps,
  type OrderLookupRecord,
} from './resolve-order-reference.ts';
import { MockConversationAgent } from './agent/conversation-agent.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { READ_TOOL_HANDLERS } from './agent/tools/read-tools.ts';
import { presentOrderLookupFromToolOutput } from './agent/agent-presenter.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-test',
  phone: '+59899123456',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const STORED_CLIENT = { id: 'client-b', name: 'Cliente B' };

const ORDER_00239: OrderLookupRecord = {
  id: 'ord-doc-00239',
  data: {
    numeroPedido: 239,
    numeroPedidoLabel: '00239',
    clienteId: STORED_CLIENT.id,
    clienteNombre: STORED_CLIENT.name,
    estado: 'pendiente',
    total: 1500,
    saldo: 400,
    items: [{ nombre: 'Remera', cantidad: 2 }],
    descripcion: 'detalle de prueba',
  },
};

const ORDER_00231: OrderLookupRecord = {
  id: 'ord-doc-00231',
  data: {
    numeroPedido: 231,
    numeroPedidoLabel: '00231',
    clienteId: STORED_CLIENT.id,
    clienteNombre: STORED_CLIENT.name,
    estado: 'listo',
    total: 800,
    saldo: 0,
    items: [{ nombre: 'Buzo', cantidad: 1 }],
  },
};

function memoryDeps(orders: OrderLookupRecord[] = [ORDER_00239]): FindOrderDeps {
  return {
    getById: async (id) => orders.find((row) => row.id === id) ?? null,
    findByReference: async (ref) =>
      orders.filter((row) => orderRecordMatchesReference(row.data, ref)),
    findClient: async (query) => {
      if (!catalogNameEquals(query, STORED_CLIENT.name)) {
        return { status: 'not_found', query };
      }
      return {
        status: 'resolved',
        entity: { id: STORED_CLIENT.id, name: STORED_CLIENT.name },
        query,
      };
    },
    listByClientId: async (clientId) =>
      orders
        .filter((row) => String(row.data.clienteId) === clientId)
        .sort(
          (a, b) =>
            Number(b.data.numeroPedido) - Number(a.data.numeroPedido)
        ),
  };
}

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({
      businessId: tenant.businessId,
      phone: tenant.phone,
      updatedAt: new Date().toISOString(),
      ...patch,
    }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
  tryOnboarding: async () => ({ kind: 'skip' as const }),
};

describe('normalizeOrderReference', () => {
  it('maps spoken and padded identifiers to the ERP label', () => {
    for (const raw of ['239', '00239', '#239', '#00239']) {
      const ref = normalizeOrderReference(raw);
      assert.ok(ref, raw);
      assert.equal(ref!.numeric, 239);
      assert.equal(ref!.digits, '239');
      assert.equal(ref!.label, '00239');
    }
  });

  it('does not treat a client name as an order number', () => {
    assert.equal(normalizeOrderReference('Cliente B'), null);
  });
});

describe('orderRecordMatchesReference', () => {
  it('resolves ERP orderNumber 00239 from orderReference 239', () => {
    const ref = normalizeOrderReference('239')!;
    assert.equal(orderRecordMatchesReference(ORDER_00239.data, ref), true);
    assert.equal(
      orderRecordMatchesReference({ numeroPedido: '00239', numeroPedidoLabel: '00239' }, ref),
      true
    );
    assert.equal(orderRecordMatchesReference({ numeroPedido: 1, numeroPedidoLabel: '00001' }, ref), false);
  });
});

describe('classifyFindOrderHint', () => {
  it('treats a visible number as order reference, not document id', () => {
    assert.equal(classifyFindOrderHint({ orderId: '239' }).kind, 'order_reference');
    assert.equal(classifyFindOrderHint({ orderNumber: '239' }).kind, 'order_reference');
    assert.equal(classifyFindOrderHint({ query: '239' }).kind, 'order_reference');
    assert.equal(classifyFindOrderHint({ query: '#00239' }).kind, 'order_reference');
    assert.equal(classifyFindOrderHint({ orderId: 'abcDEFghij0123456789' }).kind, 'document_id');
    assert.equal(classifyFindOrderHint({ query: 'Cliente B' }).kind, 'client_query');
    assert.equal(classifyFindOrderHint({ clientQuery: 'Cliente B' }).kind, 'client_query');
  });
});

describe('catalog name matching', () => {
  it('resolves stored name against folded clientQuery without hardcoded names', () => {
    const stored = 'Cliente B';
    assert.equal(catalogNameEquals('cliente b', stored), true);
    assert.equal(catalogNameEquals('CLIENTE B', stored), true);
    assert.equal(catalogNameEquals('Cliente  B', stored), true);
    assert.equal(catalogNameEquals('Cliente C', stored), false);
  });
});

describe('resolveFindOrderHints', () => {
  it('finds the ERP order for every accepted reference form', async () => {
    const deps = memoryDeps();
    for (const raw of ['239', '00239', '#239', '#00239']) {
      const result = await resolveFindOrderHints({ orderNumber: raw }, deps);
      assert.equal(result.status, 'resolved', raw);
      assert.equal(result.entity?.data.numeroPedidoLabel, '00239');
      assert.equal(result.classified.kind, 'order_reference');
    }
  });

  it('resolves the single relevant order of a client query', async () => {
    const result = await resolveFindOrderHints({ query: 'cliente b' }, memoryDeps());
    assert.equal(result.status, 'resolved');
    assert.equal(result.clientName, STORED_CLIENT.name);
    assert.equal(result.entity?.id, ORDER_00239.id);
  });

  it('returns numbered order candidates when the client has several', async () => {
    const result = await resolveFindOrderHints(
      { clientQuery: 'Cliente B' },
      memoryDeps([ORDER_00239, ORDER_00231])
    );
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.entityType, 'order');
    assert.equal((result.candidates as OrderLookupRecord[]).length, 2);
  });

  it('does not look up document id 239', async () => {
    const result = await resolveFindOrderHints({ orderId: '239' }, memoryDeps());
    assert.equal(result.status, 'resolved');
    assert.equal(result.classified.kind, 'order_reference');
    assert.notEqual(result.entity?.id, '239');
    assert.equal(result.entity?.id, 'ord-doc-00239');
  });
});

describe('V4 follow-up order reference', () => {
  it('"239" without candidate_selection goes to the agent', async () => {
    let agentCalls = 0;
    let agentText = '';
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '239', messageId: 'ord-239' },
        text: '239',
        state: {
          businessId: tenant.businessId,
          phone: tenant.phone,
          updatedAt: new Date().toISOString(),
          lastQuery: {
            intent: 'query_order',
            slots: { clientName: 'Cliente B', entity: 'order', metric: 'details' },
          },
        },
      },
      {
        ...noopPersist,
        createAgent: () => ({
          runTurn: async (input) => {
            agentCalls += 1;
            agentText = input.text;
            return { reply: 'detalle', executed: false, intent: 'agent_v4' };
          },
        }),
      }
    );
    assert.equal(agentCalls, 1);
    assert.equal(agentText, '239');
    assert.equal(result.intent, 'agent_v4');
  });

  it('turn 1 client query + turn 2 orderReference 239 returns ERP detail', async () => {
    const original = READ_TOOL_HANDLERS.find_order;
    READ_TOOL_HANDLERS.find_order = async (args) => {
      const result = await resolveFindOrderHints(
        {
          orderId: String(args.orderId ?? ''),
          orderNumber: String(args.orderNumber ?? ''),
          query: String(args.query ?? ''),
          clientQuery: String(args.clientQuery ?? ''),
          clientId: String(args.clientId ?? ''),
        },
        memoryDeps()
      );
      if (result.status === 'resolved' && result.entity) {
        const data = result.entity.data;
        return {
          status: 'resolved',
          classified: result.classified.kind,
          orderReferenceRaw:
            result.classified.kind === 'order_reference' ? result.classified.raw : undefined,
          orderReferenceNormalized:
            result.classified.kind === 'order_reference' ? result.classified.ref.label : undefined,
          entity: {
            id: result.entity.id,
            number: String(data.numeroPedidoLabel),
            clientName: String(data.clienteNombre),
            statusLabel: 'Pendiente',
            total: Number(data.total),
            balance: Number(data.saldo),
            products: '2 × Remera',
            notes: String(data.descripcion ?? ''),
          },
        };
      }
      return { status: result.status, message: result.message };
    };

    try {
      const turn1 = new MockConversationAgent([
        () => [{ id: '1', name: 'find_order', arguments: { query: 'Cliente B' } }],
      ]);
      const first = await turn1.runTurn({
        tenant,
        state: {
          businessId: tenant.businessId,
          phone: tenant.phone,
          updatedAt: new Date().toISOString(),
        },
        text: 'buscame el pedido de Cliente B',
      });
      assert.equal(first.toolCalls?.[0]?.name, 'find_order');
      assert.match(String(first.reply), /00239/);
      assert.match(String(first.reply), /Cliente B/);

      const turn2 = new MockConversationAgent([
        () => [{ id: '1', name: 'find_order', arguments: { orderNumber: '239' } }],
      ]);
      const second = await turn2.runTurn({
        tenant,
        state: {
          businessId: tenant.businessId,
          phone: tenant.phone,
          updatedAt: new Date().toISOString(),
          lastQuery: first.statePatch?.lastQuery ?? {
            intent: 'query_order',
            slots: { clientName: 'Cliente B', entity: 'order', metric: 'details' },
          },
        },
        text: '239',
      });
      assert.equal(second.toolCalls?.[0]?.arguments.orderNumber, '239');
      const output = second.toolResults?.[0]?.output;
      assert.equal(output?.orderReferenceRaw, '239');
      assert.equal(output?.orderReferenceNormalized, '00239');
      assert.equal(output?.entity?.number, '00239');
      assert.match(String(second.reply), /00239/);
      assert.match(String(second.reply), /Cliente B/);
    } finally {
      READ_TOOL_HANDLERS.find_order = original;
    }
  });

  it('presenter shows ERP detail for a resolved order', () => {
    const reply = presentOrderLookupFromToolOutput({
      status: 'resolved',
      entity: {
        number: '00239',
        clientName: 'Cliente B',
        statusLabel: 'Pendiente',
        products: '2 × Remera',
        items: [{ name: 'Remera', quantity: 2 }],
        total: 1500,
        balance: 400,
      },
    });
    assert.match(String(reply), /00239/);
    assert.match(String(reply), /Cliente B/);
    assert.match(String(reply), /Remera/);
  });
});
